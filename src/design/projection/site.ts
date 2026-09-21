import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArchitectureSite, type ArchitectureSiteArtifacts } from "../../architecture/documentation/site.js";
import type { ReactFlowProjectionOptions } from "../../architecture/projection/react-flow.js";
import type { DesignIntentLifecycleRecord, DesignIntentCanonView } from "../contracts.js";
import { projectDesignIntentDocumentation } from "./document.js";
import { projectDesignIntentGraphDelta, type DesignIntentGraphDelta } from "./graph-delta.js";
import { designIntentReport, renderDesignIntentComparisonHtml, type DesignIntentComparisonHtmlInput } from "./html.js";

export const DESIGN_INTENT_SITE_LAYOUT = Object.freeze({
  indexHtml: "index.html",
  reportJson: "report.json",
  currentDirectory: "current",
  proposedDirectory: "proposed",
});

export interface DesignIntentSiteRequest {
  /** An absolute, caller-owned directory for all site artifacts. */
  readonly outputRoot: string;
  readonly view: DesignIntentCanonView;
  readonly lifecycle?: DesignIntentLifecycleRecord;
  readonly reactFlow?: ReactFlowProjectionOptions;
}

export interface DesignIntentSiteArtifacts {
  readonly root: string;
  readonly indexHtml: string;
  readonly reportJson: string;
  readonly current: ArchitectureSiteArtifacts;
  readonly proposed?: ArchitectureSiteArtifacts;
}

export interface DesignIntentSiteResult {
  readonly status: "ok";
  readonly complete: true;
  readonly outputRoot: string;
  readonly current: DesignIntentSiteArtifacts["current"];
  readonly proposed?: DesignIntentSiteArtifacts["proposed"];
  readonly report: string;
  readonly delta: DesignIntentGraphDelta;
  readonly artifacts: DesignIntentSiteArtifacts;
}

export type DesignIntentSiteErrorCode = "invalid-input" | "unsafe-path" | "unsafe-overwrite";

export class DesignIntentSiteError extends Error {
  readonly code: DesignIntentSiteErrorCode;

  constructor(code: DesignIntentSiteErrorCode, message: string) {
    super(message);
    this.name = "DesignIntentSiteError";
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

async function assertSafeExistingAncestors(outputRoot: string): Promise<void> {
  const parent = path.dirname(outputRoot);
  let current = parent;
  while (true) {
    const kind = await entryKind(current);
    if (kind === "symlink")
      throw new DesignIntentSiteError("unsafe-path", `site ancestor is a symbolic link: ${current}`);
    if (kind === "file" || kind === "other") {
      throw new DesignIntentSiteError("unsafe-path", `site ancestor is not a directory: ${current}`);
    }
    if (kind === "directory") break;
    const next = path.dirname(current);
    if (next === current) {
      throw new DesignIntentSiteError("unsafe-path", `site output parent does not exist: ${parent}`);
    }
    current = next;
  }
}

async function prepareRoot(outputRoot: string): Promise<string> {
  if (!path.isAbsolute(outputRoot) || outputRoot.length === 0) {
    throw new DesignIntentSiteError("invalid-input", "site output root must be a non-empty absolute path");
  }
  const resolved = path.resolve(outputRoot);
  await assertSafeExistingAncestors(resolved);
  const existing = await entryKind(resolved);
  if (existing === "symlink") {
    throw new DesignIntentSiteError("unsafe-path", `site output root must not be a symbolic link: ${resolved}`);
  }
  if (existing !== "missing") {
    throw new DesignIntentSiteError("unsafe-overwrite", `refusing to overwrite existing site output: ${resolved}`);
  }
  return mkdtemp(path.join(path.dirname(resolved), `.${path.basename(resolved)}-staging-`));
}

async function writeSiteRoot(
  stagingRoot: string,
  input: DesignIntentComparisonHtmlInput,
): Promise<{ readonly indexHtml: string; readonly reportJson: string }> {
  const indexHtml = path.join(stagingRoot, DESIGN_INTENT_SITE_LAYOUT.indexHtml);
  const reportJson = path.join(stagingRoot, DESIGN_INTENT_SITE_LAYOUT.reportJson);
  await writeFile(indexHtml, renderDesignIntentComparisonHtml(input), { encoding: "utf8", flag: "wx" });
  await writeFile(reportJson, designIntentReport(input), { encoding: "utf8", flag: "wx" });
  return { indexHtml, reportJson };
}

/**
 * Build the complete offline Design Intent comparison site. All rendering is
 * performed in an isolated staging directory and published only after every
 * current/proposed artifact and report has been written successfully.
 */
export async function buildDesignIntentSite(request: DesignIntentSiteRequest): Promise<DesignIntentSiteResult> {
  const outputRoot = path.resolve(request.outputRoot);
  const stagingRoot = await prepareRoot(request.outputRoot);
  try {
    const documentation = projectDesignIntentDocumentation(request.view, request.lifecycle);
    const delta = await projectDesignIntentGraphDelta(request.view, request.reactFlow);
    const currentDocumentation = documentation;
    const proposedDocumentation = documentation.designIntent?.proposed;
    const currentRoot = path.join(stagingRoot, DESIGN_INTENT_SITE_LAYOUT.currentDirectory);
    const proposedRoot = path.join(stagingRoot, DESIGN_INTENT_SITE_LAYOUT.proposedDirectory);
    await mkdir(currentRoot);
    const currentResult = await buildArchitectureSite({
      outputRoot: currentRoot,
      documentation: currentDocumentation,
      reactFlow: delta.current,
    });
    const current = currentResult.artifacts;

    let proposed: ArchitectureSiteArtifacts | undefined;
    if (delta.proposed !== undefined && proposedDocumentation !== undefined) {
      await mkdir(proposedRoot);
      const proposedResult = await buildArchitectureSite({
        outputRoot: proposedRoot,
        documentation: proposedDocumentation,
        reactFlow: delta.proposed,
      });
      proposed = proposedResult.artifacts;
    }

    await writeSiteRoot(stagingRoot, {
      current: currentDocumentation,
      ...(proposedDocumentation === undefined ? {} : { proposed: proposedDocumentation }),
      delta,
      lifecycle: request.lifecycle,
      codeIntent: request.view.codeIntent,
      currentHref: "current/index.html",
      ...(proposed === undefined ? {} : { proposedHref: "proposed/index.html" }),
      reportHref: "report.json",
    });

    const existingAtPublish = await entryKind(outputRoot);
    if (existingAtPublish === "symlink") {
      throw new DesignIntentSiteError("unsafe-path", `site output root became a symbolic link: ${outputRoot}`);
    }
    if (existingAtPublish !== "missing") {
      throw new DesignIntentSiteError("unsafe-overwrite", `site output appeared during generation: ${outputRoot}`);
    }
    await rename(stagingRoot, outputRoot);
    const artifacts: DesignIntentSiteArtifacts = Object.freeze({
      root: outputRoot,
      indexHtml: path.join(outputRoot, DESIGN_INTENT_SITE_LAYOUT.indexHtml),
      reportJson: path.join(outputRoot, DESIGN_INTENT_SITE_LAYOUT.reportJson),
      current: { ...current, root: path.join(outputRoot, DESIGN_INTENT_SITE_LAYOUT.currentDirectory) },
      ...(proposed === undefined
        ? {}
        : {
            proposed: {
              ...proposed,
              root: path.join(outputRoot, DESIGN_INTENT_SITE_LAYOUT.proposedDirectory),
            },
          }),
    });
    return Object.freeze({
      status: "ok" as const,
      complete: true as const,
      outputRoot,
      current: artifacts.current,
      ...(artifacts.proposed === undefined ? {} : { proposed: artifacts.proposed }),
      report: path.join(outputRoot, DESIGN_INTENT_SITE_LAYOUT.reportJson),
      delta,
      artifacts,
    });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export const assembleDesignIntentSite = buildDesignIntentSite;
