import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderDocumentationHtml } from "./html.js";
import { renderReactFlowStatic, type ReactFlowStaticRenderResult } from "./react-flow.js";
import type { DocumentationModel } from "./model.js";
import type { ReactFlowProjection, ReactFlowProjectionLoss } from "../projection/react-flow.js";

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}

export const ARCHITECTURE_SITE_LAYOUT = Object.freeze({
  indexHtml: "index.html",
  projectionLosses: "projection-losses.json",
  diagramsDirectory: "diagrams",
  diagramsIndexHtml: "diagrams/index.html",
  diagramsStylesheet: "diagrams/wabachi-react-flow.css",
});

export interface ArchitectureSiteRequest {
  /** An absolute, caller-owned directory for all site artifacts. */
  readonly outputRoot: string;
  readonly documentation: DocumentationModel;
  readonly reactFlow: ReactFlowProjection;
}

export interface ArchitectureSiteArtifacts {
  readonly root: string;
  readonly indexHtml: string;
  readonly projectionLosses: string;
  readonly diagramsDirectory: string;
  readonly diagramsIndexHtml: string;
  readonly diagramsStylesheet: string;
}

export interface ArchitectureSiteResult {
  readonly status: "ok";
  readonly complete: true;
  readonly outputRoot: string;
  readonly canonVersion: DocumentationModel["canonVersion"];
  readonly documentId: DocumentationModel["documentId"];
  readonly losses: readonly ReactFlowProjectionLoss[];
  readonly artifacts: ArchitectureSiteArtifacts;
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
    projectionLosses: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.projectionLosses),
    diagramsDirectory: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.diagramsDirectory),
    diagramsIndexHtml: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.diagramsIndexHtml),
    diagramsStylesheet: assertInsideRoot(outputRoot, ARCHITECTURE_SITE_LAYOUT.diagramsStylesheet),
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

  for (const target of [
    artifacts.indexHtml,
    artifacts.projectionLosses,
    artifacts.diagramsIndexHtml,
    artifacts.diagramsStylesheet,
  ]) {
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

function assertCompatibleGeneration(documentation: DocumentationModel, reactFlow: ReactFlowProjection): void {
  if (documentation.canonVersion !== reactFlow.canonVersion || documentation.documentId !== reactFlow.documentId) {
    throw new ArchitectureSiteError(
      "generation-mismatch",
      "documentation and React Flow projections must originate from the same Canon generation",
    );
  }
}

function siteNavigation(lossCount: number): string {
  return `<aside id="architecture-site-navigation">
<h2>Wabachi architecture site</h2>
<nav aria-label="architecture-site"><ul>
<li><a href="index.html">Documentation</a></li>
<li><a href="diagrams/index.html">React Flow diagrams</a></li>
<li><a href="projection-losses.json">Projection losses (${String(lossCount)})</a></li>
</ul></nav>
</aside>`;
}

function composeIndex(documentation: DocumentationModel, losses: readonly ReactFlowProjectionLoss[]): string {
  const rendered = renderDocumentationHtml(documentation);
  const closingBody = "</body>";
  const insertionPoint = rendered.lastIndexOf(closingBody);
  if (insertionPoint < 0) {
    throw new ArchitectureSiteError("invalid-input", "documentation renderer did not return a complete HTML document");
  }

  return `${rendered.slice(0, insertionPoint)}${siteNavigation(losses.length)}\n${rendered.slice(insertionPoint)}`;
}

function composeDiagrams(documentId: string, rendered: ReactFlowStaticRenderResult): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(documentId)} React Flow diagrams</title>
<link rel="stylesheet" href="wabachi-react-flow.css">
</head>
<body>
${rendered.markup}
</body>
</html>`;
}

function projectionLossReport(projection: ReactFlowProjection): string {
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

/** Assemble documentation and the first-party React Flow projection at one filesystem edge. */
export async function buildArchitectureSite(request: ArchitectureSiteRequest): Promise<ArchitectureSiteResult> {
  if (!path.isAbsolute(request.outputRoot) || request.outputRoot.length === 0) {
    throw new ArchitectureSiteError("invalid-input", "site output root must be a non-empty absolute path");
  }

  assertCompatibleGeneration(request.documentation, request.reactFlow);
  const rendered = renderReactFlowStatic(request.reactFlow);
  const outputRoot = path.resolve(request.outputRoot);
  const artifacts = artifactPaths(outputRoot);
  await prepareOutput(artifacts);

  await writeFile(artifacts.indexHtml, composeIndex(request.documentation, request.reactFlow.losses), {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(artifacts.projectionLosses, projectionLossReport(request.reactFlow), {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(artifacts.diagramsIndexHtml, composeDiagrams(request.reactFlow.documentId, rendered), {
    encoding: "utf8",
    flag: "wx",
  });
  for (const asset of rendered.assets) {
    await writeFile(assertInsideRoot(artifacts.diagramsDirectory, asset.path), asset.content, {
      encoding: "utf8",
      flag: "wx",
    });
  }

  return Object.freeze({
    status: "ok" as const,
    complete: true as const,
    outputRoot,
    canonVersion: request.documentation.canonVersion,
    documentId: request.documentation.documentId,
    losses: request.reactFlow.losses,
    artifacts,
  });
}

export const assembleArchitectureSite = buildArchitectureSite;
