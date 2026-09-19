import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderDocumentationHtml } from "./html.js";
import type { DocumentationModel } from "./model.js";
import {
  runStructurizrStaticExport,
  type StructurizrLauncher,
  type StructurizrStaticExportRequest,
  type StructurizrStaticExportResult,
} from "../projection/structurizr-export.js";
import type { ProjectionLoss, StructurizrProjection } from "../projection/structurizr.js";

export const ARCHITECTURE_SITE_LAYOUT = Object.freeze({
  indexHtml: "index.html",
  workspaceDsl: "workspace.dsl",
  projectionLosses: "projection-losses.json",
  diagramsDirectory: "diagrams",
});

export type StructurizrStaticExportAdapter = (
  request: StructurizrStaticExportRequest,
) => Promise<StructurizrStaticExportResult>;

export interface ArchitectureSiteRequest {
  /** An absolute, caller-owned directory for all site artifacts. */
  readonly outputRoot: string;
  readonly documentation: DocumentationModel;
  readonly structurizr: StructurizrProjection;
  readonly launcher: StructurizrLauncher;
  readonly exportAdapter?: StructurizrStaticExportAdapter;
}

export interface ArchitectureSiteArtifacts {
  readonly root: string;
  readonly indexHtml: string;
  readonly workspaceDsl: string;
  readonly projectionLosses: string;
  readonly diagramsDirectory: string;
}

export interface ArchitectureSiteResult {
  readonly status: "ok" | "export-failed";
  readonly complete: boolean;
  readonly outputRoot: string;
  readonly canonVersion: DocumentationModel["canonVersion"];
  readonly documentId: DocumentationModel["documentId"];
  readonly losses: readonly ProjectionLoss[];
  readonly artifacts: ArchitectureSiteArtifacts;
  readonly export: StructurizrStaticExportResult;
}

export type ArchitectureSiteErrorCode = "invalid-input" | "generation-mismatch" | "unsafe-path" | "unsafe-overwrite";

export class ArchitectureSiteError extends Error {
  readonly code: ArchitectureSiteErrorCode;

  constructor(code: ArchitectureSiteErrorCode, message: string) {
    super(message);
    this.name = "ArchitectureSiteError";
    this.code = code;
  }
}

type EntryKind = "missing" | "directory" | "file" | "symlink" | "other";

async function entryKind(entryPath: string): Promise<EntryKind> {
  try {
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
    throw error;
  }
}

function assertInsideRoot(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!candidate.startsWith(prefix)) {
    throw new ArchitectureSiteError("unsafe-path", `site artifact path escapes output root: ${relativePath}`);
  }
  return candidate;
}

function artifactPaths(outputRoot: string): ArchitectureSiteArtifacts {
  return Object.freeze({
    root: outputRoot,
    indexHtml: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.indexHtml),
    workspaceDsl: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.workspaceDsl),
    projectionLosses: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.projectionLosses),
    diagramsDirectory: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.diagramsDirectory),
  });
}

async function prepareOutput(artifacts: ArchitectureSiteArtifacts): Promise<void> {
  const rootKind = await entryKind(artifacts.root);
  if (rootKind === "symlink") {
    throw new ArchitectureSiteError("unsafe-path", "site output root must not be a symbolic link");
  }
  if (rootKind === "file" || rootKind === "other") {
    throw new ArchitectureSiteError("invalid-input", "site output root must be a directory");
  }

  if (rootKind === "missing") await mkdir(artifacts.root, { recursive: true });

  const verifiedRootKind = await entryKind(artifacts.root);
  if (verifiedRootKind !== "directory") {
    throw new ArchitectureSiteError("unsafe-path", "site output root is not a stable directory");
  }

  for (const target of [artifacts.indexHtml, artifacts.workspaceDsl, artifacts.projectionLosses]) {
    const kind = await entryKind(target);
    if (kind !== "missing") {
      throw new ArchitectureSiteError("unsafe-overwrite", `refusing to overwrite existing site artifact: ${target}`);
    }
  }

  const diagramsKind = await entryKind(artifacts.diagramsDirectory);
  if (diagramsKind !== "missing") {
    throw new ArchitectureSiteError(
      "unsafe-overwrite",
      `refusing to reuse existing diagrams directory: ${artifacts.diagramsDirectory}`,
    );
  }

  await mkdir(artifacts.diagramsDirectory);
}

function assertCompatibleGeneration(documentation: DocumentationModel, structurizr: StructurizrProjection): void {
  if (documentation.canonVersion !== structurizr.canonVersion || documentation.documentId !== structurizr.documentId) {
    throw new ArchitectureSiteError(
      "generation-mismatch",
      "documentation and Structurizr projections must originate from the same Canon generation",
    );
  }
}

function siteNavigation(lossCount: number): string {
  return `<aside id="architecture-site-navigation">
<h2>Wabachi architecture site</h2>
<nav aria-label="architecture-site"><ul>
<li><a href="index.html">Documentation</a></li>
<li><a href="diagrams/index.html">Structurizr diagrams</a></li>
<li><a href="projection-losses.json">Projection losses (${String(lossCount)})</a></li>
</ul></nav>
</aside>`;
}

function composeIndex(documentation: DocumentationModel, losses: readonly ProjectionLoss[]): string {
  const rendered = renderDocumentationHtml(documentation);
  const closingBody = "</body>";
  const insertionPoint = rendered.lastIndexOf(closingBody);
  if (insertionPoint < 0) {
    throw new ArchitectureSiteError("invalid-input", "documentation renderer did not return a complete HTML document");
  }

  return `${rendered.slice(0, insertionPoint)}${siteNavigation(losses.length)}\n${rendered.slice(insertionPoint)}`;
}

function projectionLossReport(projection: StructurizrProjection): string {
  return `${JSON.stringify(
    {
      canonVersion: projection.canonVersion,
      documentId: projection.documentId,
      losses: projection.losses,
    },
    null,
    2,
  )}\n`;
}

/** Assemble the independent documentation and Structurizr projections at one filesystem edge. */
export async function buildArchitectureSite(request: ArchitectureSiteRequest): Promise<ArchitectureSiteResult> {
  if (!path.isAbsolute(request.outputRoot) || request.outputRoot.length === 0) {
    throw new ArchitectureSiteError("invalid-input", "site output root must be a non-empty absolute path");
  }

  assertCompatibleGeneration(request.documentation, request.structurizr);
  const outputRoot = path.resolve(request.outputRoot);
  const artifacts = artifactPaths(outputRoot);
  await prepareOutput(artifacts);

  await writeFile(artifacts.indexHtml, composeIndex(request.documentation, request.structurizr.losses), {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(artifacts.workspaceDsl, request.structurizr.dsl, { encoding: "utf8", flag: "wx" });
  await writeFile(artifacts.projectionLosses, projectionLossReport(request.structurizr), {
    encoding: "utf8",
    flag: "wx",
  });

  const exportRequest: StructurizrStaticExportRequest = {
    launcher: request.launcher,
    workspacePath: artifacts.workspaceDsl,
    outputDirectory: artifacts.diagramsDirectory,
  };
  const exportResult = await (request.exportAdapter ?? runStructurizrStaticExport)(exportRequest);
  const complete = exportResult.status === "ok";

  return Object.freeze({
    status: complete ? "ok" : "export-failed",
    complete,
    outputRoot,
    canonVersion: request.documentation.canonVersion,
    documentId: request.documentation.documentId,
    losses: request.structurizr.losses,
    artifacts,
    export: exportResult,
  });
}

export const assembleArchitectureSite = buildArchitectureSite;
