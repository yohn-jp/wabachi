import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_GIT_STDERR_LENGTH = 1024;

/** The conventional repository-resident paths owned by Design Intent storage. */
export const DESIGN_CANON_RELATIVE_PATH = ".wabachi/architecture.json";
export const DESIGN_CHANGES_RELATIVE_PATH = ".wabachi/changes";
export const DESIGN_CHANGE_FILE_NAME = "change.json";
export const DESIGN_LIFECYCLE_FILE_NAME = "lifecycle.json";
export const DESIGN_REVIEWS_FILE_NAME = "reviews.json";
export const DESIGN_IMPLEMENTATIONS_FILE_NAME = "implementations.json";
export const DESIGN_CERTIFICATION_FILE_NAME = "certification.json";

export interface DesignRepositoryPaths {
  readonly repositoryRoot: string;
  readonly canon: string;
  readonly changes: string;
  readonly change: string;
  readonly lifecycle: string;
  readonly reviews: string;
  readonly implementations: string;
  readonly certification: string;
  readonly relative: {
    readonly canon: string;
    readonly changes: string;
    readonly change: string;
    readonly lifecycle: string;
    readonly reviews: string;
    readonly implementations: string;
    readonly certification: string;
  };
}

export interface DesignRepositoryPathsOptions {
  readonly repositoryRoot?: string;
  readonly cwd?: string;
  readonly changeId: string;
}

function boundedText(value: unknown): string {
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_GIT_STDERR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_GIT_STDERR_LENGTH - 1)}…`;
}

function processError(error: unknown): {
  readonly code?: number | string | null;
  readonly signal?: string | null;
  readonly stderr?: string | Buffer;
  readonly cmd?: string;
} {
  if (error === null || typeof error !== "object") return {};
  return error as {
    readonly code?: number | string | null;
    readonly signal?: string | null;
    readonly stderr?: string | Buffer;
    readonly cmd?: string;
  };
}

function formatGitFailure(error: unknown, args: readonly string[]): string {
  const failure = processError(error);
  const status =
    typeof failure.code === "number"
      ? `exit ${failure.code}`
      : failure.signal
        ? `signal ${failure.signal}`
        : failure.code === undefined || failure.code === null
          ? "failed to start"
          : `error ${failure.code}`;
  const detail = boundedText(failure.stderr ?? (error instanceof Error ? error.message : error));
  return `git repository root resolution failed: git ${args.join(" ")} (${status})${detail ? ` stderr: ${detail}` : ""}`;
}

/** Normalizes a ChangeId without accepting a spelling that is not canonical. */
export function normalizeChangeId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new TypeError("change id must contain only lowercase ASCII letters, digits, and hyphens");
  }
  return value;
}

/**
 * Normalizes a declaration path without consulting the filesystem.
 * Filesystem-boundary checks are deliberately performed by
 * assertRepositoryPathBoundary instead of being hidden in this function.
 */
export function normalizeStoragePath(value: string): string {
  if (typeof value !== "string") throw new TypeError("repository path must be a string");
  const normalized = value.normalize("NFC").replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:($|\/)/u.test(normalized) ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)
  ) {
    throw new TypeError("repository path must be relative to the repository root");
  }

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new TypeError("repository path cannot escape the repository root");
    segments.push(segment);
  }
  if (segments.length === 0) throw new TypeError("repository path must identify a repository-relative path");
  return segments.join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

/**
 * Ensures an existing component between the repository root and a target is
 * not a symlink. Missing final components are allowed for callers that will
 * create an artifact later; an existing symlink is always rejected.
 */
export async function assertRepositoryPathBoundary(repositoryRoot: string, relativePath: string): Promise<string> {
  const root = path.resolve(repositoryRoot);
  const normalized = normalizeStoragePath(relativePath);
  const target = path.resolve(root, ...normalized.split("/"));
  if (!isInside(root, target)) throw new TypeError("repository path must remain inside the repository root");

  let current = root;
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`repository path contains a symlink: ${normalized}`);
      }
    } catch (error) {
      const code = processError(error).code;
      if (code === "ENOENT") return target;
      throw error;
    }
  }
  return target;
}

/** Resolves the repository's physical root using Git, without invoking a shell. */
export async function resolveRepositoryRoot(cwd = process.cwd()): Promise<string> {
  const directory = path.resolve(cwd);
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
    const reported = String(result.stdout).trim();
    if (reported.length === 0) throw new Error("Git returned an empty repository root");
    return await realpath(reported);
  } catch (error) {
    if (error instanceof Error && error.message === "Git returned an empty repository root") throw error;
    throw new Error(formatGitFailure(error, ["rev-parse", "--show-toplevel"]), { cause: error });
  }
}

function createPaths(repositoryRoot: string, changeId: string): DesignRepositoryPaths {
  const normalizedId = normalizeChangeId(changeId);
  const relative = {
    canon: DESIGN_CANON_RELATIVE_PATH,
    changes: DESIGN_CHANGES_RELATIVE_PATH,
    change: `${DESIGN_CHANGES_RELATIVE_PATH}/${normalizedId}/${DESIGN_CHANGE_FILE_NAME}`,
    lifecycle: `${DESIGN_CHANGES_RELATIVE_PATH}/${normalizedId}/${DESIGN_LIFECYCLE_FILE_NAME}`,
    reviews: `${DESIGN_CHANGES_RELATIVE_PATH}/${normalizedId}/${DESIGN_REVIEWS_FILE_NAME}`,
    implementations: `${DESIGN_CHANGES_RELATIVE_PATH}/${normalizedId}/${DESIGN_IMPLEMENTATIONS_FILE_NAME}`,
    certification: `${DESIGN_CHANGES_RELATIVE_PATH}/${normalizedId}/${DESIGN_CERTIFICATION_FILE_NAME}`,
  } as const;

  const root = path.resolve(repositoryRoot);
  return Object.freeze({
    repositoryRoot: root,
    canon: path.join(root, ...relative.canon.split("/")),
    changes: path.join(root, ...relative.changes.split("/")),
    change: path.join(root, ...relative.change.split("/")),
    lifecycle: path.join(root, ...relative.lifecycle.split("/")),
    reviews: path.join(root, ...relative.reviews.split("/")),
    implementations: path.join(root, ...relative.implementations.split("/")),
    certification: path.join(root, ...relative.certification.split("/")),
    relative: Object.freeze(relative),
  });
}

/** Creates deterministic absolute paths after validating only the declaration inputs. */
export function createDesignRepositoryPaths(repositoryRoot: string, changeId: string): DesignRepositoryPaths {
  return createPaths(repositoryRoot, changeId);
}

/** Resolves Git root and validates every existing storage-path ancestor. */
export async function resolveDesignRepositoryPaths(
  options: DesignRepositoryPathsOptions | string,
  changeId?: string,
): Promise<DesignRepositoryPaths> {
  const input: DesignRepositoryPathsOptions =
    typeof options === "string" ? { repositoryRoot: options, changeId: changeId ?? "" } : options;
  const root =
    input.repositoryRoot === undefined ? await resolveRepositoryRoot(input.cwd) : await realpath(input.repositoryRoot);
  const paths = createPaths(root, input.changeId);
  await Promise.all(Object.values(paths.relative).map((entry) => assertRepositoryPathBoundary(root, entry)));
  return paths;
}

/** Backwards-readable alias for callers that refer to the storage path set as design paths. */
export const resolveDesignPaths = resolveDesignRepositoryPaths;
