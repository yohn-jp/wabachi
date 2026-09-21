import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { digestJson, type Digest } from "../digest.js";
import { createDesignRepositoryPaths, normalizeStoragePath } from "./paths.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_STDERR_LENGTH = 1024;
const MAX_GIT_OUTPUT_LENGTH = 64 * 1024 * 1024;

interface ProcessErrorLike {
  readonly code?: number | string | null;
  readonly signal?: string | null;
  readonly stderr?: string | Buffer;
  readonly cmd?: string;
}

function processErrorLike(error: unknown): ProcessErrorLike {
  if (error === null || typeof error !== "object") return {};
  return error as ProcessErrorLike;
}

function boundedText(value: unknown): string {
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_GIT_STDERR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_GIT_STDERR_LENGTH - 1)}…`;
}

function processStatus(error: ProcessErrorLike): string {
  if (typeof error.code === "number") return `exit ${error.code}`;
  if (error.signal) return `signal ${error.signal}`;
  if (error.code !== undefined && error.code !== null) return `error ${error.code}`;
  return "failed to start";
}

/** A bounded failure from a Git subprocess, distinct from repository staleness. */
export class GitProcessError extends Error {
  readonly kind = "git-process-failure" as const;
  readonly args: readonly string[];
  readonly exitCode: number | undefined;
  readonly signal: string | null | undefined;
  readonly stderr: string;

  constructor(args: readonly string[], cause: unknown) {
    const details = processErrorLike(cause);
    const stderr = boundedText(details.stderr ?? (cause instanceof Error ? cause.message : cause));
    const command = details.cmd ?? ["git", ...args].join(" ");
    super(`git command failed: ${command} (${processStatus(details)})${stderr ? ` stderr: ${stderr}` : ""}`, {
      cause,
    });
    this.name = "GitProcessError";
    this.args = Object.freeze([...args]);
    this.exitCode = typeof details.code === "number" ? details.code : undefined;
    this.signal = details.signal;
    this.stderr = stderr;
  }
}

/** Git's merge-base exit status 1 means non-ancestor, not subprocess failure. */
export class NonAncestorRevisionError extends Error {
  readonly kind = "non-ancestor" as const;
  readonly expectedRevision: string;
  readonly actualRevision: string;

  constructor(expectedRevision: string, actualRevision: string) {
    super(`repository revision is not an ancestor: ${expectedRevision} -> ${actualRevision}`);
    this.name = "NonAncestorRevisionError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

async function runGit(args: readonly string[], repositoryRoot: string): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_LENGTH,
    });
    return String(result.stdout);
  } catch (error) {
    throw new GitProcessError(args, error);
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

interface GitTreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly objectId: string;
  readonly path: string;
}

function parseGitTree(stdout: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of stdout.split("\0")) {
    if (record.length === 0) continue;
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error("git ls-tree returned a malformed tree entry");
    const metadata = record.slice(0, separator).split(" ");
    if (metadata.length !== 3 || metadata.some((value) => value.length === 0)) {
      throw new Error("git ls-tree returned a malformed tree entry");
    }
    const [mode, type, objectId] = metadata;
    entries.push({ mode, type, objectId, path: record.slice(separator + 1) });
  }
  entries.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.mode, right.mode) ||
      compareStrings(left.type, right.type) ||
      compareStrings(left.objectId, right.objectId),
  );
  return entries;
}

function pathRelativeToRoot(repositoryRoot: string, value: string): string {
  if (!path.isAbsolute(value)) return normalizeStoragePath(value);
  const root = path.resolve(repositoryRoot);
  const candidate = path.resolve(value);
  const relative = path.relative(root, candidate);
  if (relative.length === 0 || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError("excluded repository path must remain inside the repository root");
  }
  return normalizeStoragePath(relative);
}

export interface GitSubjectDigestOptions {
  readonly repositoryRoot: string;
  readonly revision?: string;
  readonly changeId?: string;
  /** Relative or absolute path of the lifecycle record being updated. */
  readonly activeRecordPath?: string;
  /** Alias for activeRecordPath used by callers describing the tree exclusion. */
  readonly excludedPath?: string;
}

function resolveSubjectOptions(
  input: GitSubjectDigestOptions | string,
  second?: string,
  third?: string,
): GitSubjectDigestOptions {
  if (typeof input !== "string") return input;
  const looksLikeRevision = (value: string | undefined): boolean =>
    value === "HEAD" || value === "WORKTREE" || /^[0-9a-f]{7,64}$/iu.test(value ?? "");
  if (third === undefined) {
    return looksLikeRevision(second)
      ? { repositoryRoot: input, revision: second }
      : { repositoryRoot: input, activeRecordPath: second };
  }
  return looksLikeRevision(second)
    ? { repositoryRoot: input, revision: second, activeRecordPath: third }
    : { repositoryRoot: input, activeRecordPath: second, revision: third };
}

/**
 * Computes a deterministic subject for one Git tree. The tree records mode,
 * object type, object ID, and repository-relative path. Only the active
 * lifecycle record may be omitted; all source, test, lockfile, and semantic
 * change artifacts remain part of the subject.
 */
export async function computeGitSubjectDigest(
  input: GitSubjectDigestOptions | string,
  second?: string,
  third?: string,
): Promise<Digest> {
  const options = resolveSubjectOptions(input, second, third);
  const activeRecordPath = options.activeRecordPath ?? options.excludedPath;
  const excluded =
    activeRecordPath === undefined
      ? options.changeId === undefined
        ? undefined
        : createDesignRepositoryPaths(options.repositoryRoot, options.changeId).relative.lifecycle
      : pathRelativeToRoot(options.repositoryRoot, activeRecordPath);
  const output = await runGit(
    ["ls-tree", "-r", "-z", "--full-tree", options.revision ?? "HEAD"],
    options.repositoryRoot,
  );
  const entries = parseGitTree(output).filter((entry) => entry.path !== excluded);
  return digestJson(
    entries.map(({ mode, type, objectId, path: entryPath }) => ({ mode, type, objectId, path: entryPath })),
  );
}

export const computeRepositorySubjectDigest = computeGitSubjectDigest;
export const gitSubjectDigest = computeGitSubjectDigest;

export interface RevisionFreshnessOptions {
  readonly repositoryRoot: string;
  readonly expectedRevision: string;
  readonly actualRevision?: string;
}

export interface FreshRevision {
  readonly status: "fresh";
  readonly expectedRevision: string;
  readonly actualRevision: string;
}

export interface StaleRevision {
  readonly status: "non-ancestor";
  readonly expectedRevision: string;
  readonly actualRevision: string;
}

export type RevisionFreshness = FreshRevision | StaleRevision;

/** Checks ancestry while preserving the distinction between stale and failed Git execution. */
export async function checkRevisionFreshness(options: RevisionFreshnessOptions): Promise<RevisionFreshness> {
  const actualRevision = options.actualRevision ?? (await runGit(["rev-parse", "HEAD"], options.repositoryRoot)).trim();
  try {
    await runGit(["merge-base", "--is-ancestor", options.expectedRevision, actualRevision], options.repositoryRoot);
    return { status: "fresh", expectedRevision: options.expectedRevision, actualRevision };
  } catch (error) {
    if (error instanceof GitProcessError && error.exitCode === 1) {
      return { status: "non-ancestor", expectedRevision: options.expectedRevision, actualRevision };
    }
    throw error;
  }
}

/** Throws only for non-ancestor revisions; Git execution failures remain GitProcessError. */
export async function assertRevisionFresh(options: RevisionFreshnessOptions): Promise<FreshRevision> {
  const result = await checkRevisionFreshness(options);
  if (result.status === "non-ancestor") {
    throw new NonAncestorRevisionError(result.expectedRevision, result.actualRevision);
  }
  return result;
}

export const checkRepositoryRevisionFreshness = checkRevisionFreshness;
export const assertRepositoryRevisionFresh = assertRevisionFresh;
