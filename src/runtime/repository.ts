import { execFile, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { ResolvedRepository } from "./provider.js";

const execFileAsync = promisify(execFile);

const MAX_EXTERNAL_PROCESS_STDERR_LENGTH = 1024;

interface ProcessErrorLike {
  readonly code?: number | string | null;
  readonly signal?: string | null;
  readonly stderr?: string | Buffer;
  readonly cmd?: string;
}

function processErrorLike(error: unknown): ProcessErrorLike | undefined {
  if (error === null || typeof error !== "object") return undefined;
  return error as ProcessErrorLike;
}

export function isExternalProcessError(error: unknown): boolean {
  const processError = processErrorLike(error);
  return (
    processError !== undefined &&
    (processError.stderr !== undefined ||
      processError.cmd !== undefined ||
      processError.signal !== undefined ||
      typeof processError.code === "number")
  );
}

function boundedText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_EXTERNAL_PROCESS_STDERR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EXTERNAL_PROCESS_STDERR_LENGTH - 1)}…`;
}

function processStatus(processError: ProcessErrorLike | undefined): string {
  if (typeof processError?.code === "number") return `exit ${processError.code}`;
  if (processError?.signal) return `signal ${processError.signal}`;
  if (processError?.code !== undefined && processError.code !== null) return `error ${processError.code}`;
  return "failed to start";
}

function processCommand(processError: ProcessErrorLike | undefined, fallbackCommand?: string): string {
  return processError?.cmd ?? fallbackCommand ?? "external process";
}

/** Formats process failures for both runtime exceptions and provider records. */
export function formatExternalProcessError(error: unknown, stage: string, fallbackCommand?: string): string {
  const processError = processErrorLike(error);
  const stderr = processError?.stderr === undefined ? "" : String(processError.stderr);
  const detail = boundedText(stderr || (error instanceof Error ? error.message : String(error)));
  const suffix = detail.length === 0 ? "" : ` stderr: ${detail}`;
  return `${stage} failed: ${processCommand(processError, fallbackCommand)} (${processStatus(processError)})${suffix}`;
}

function captureStderr(stream: NodeJS.ReadableStream): () => string {
  let value = "";
  let truncated = false;
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    if (value.length >= MAX_EXTERNAL_PROCESS_STDERR_LENGTH) {
      truncated = true;
      return;
    }
    const next = `${value}${chunk}`;
    if (next.length > MAX_EXTERNAL_PROCESS_STDERR_LENGTH) {
      value = next.slice(0, MAX_EXTERNAL_PROCESS_STDERR_LENGTH);
      truncated = true;
    } else {
      value = next;
    }
  });
  return () => (truncated ? boundedText(`${value}…`) : boundedText(value));
}

function isRemoteUrl(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(source) || /^[^/]+@[^:]+:/u.test(source);
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch (error) {
    throw new Error(formatExternalProcessError(error, "git", ["git", ...args].join(" ")), { cause: error });
  }
}

export interface RepositoryResolution {
  readonly resolved: ResolvedRepository;
  /** Local directory `git archive` can read the resolved commit from. */
  readonly archiveDir: string;
}

/**
 * Resolves a local repository path or a Git URL, plus an optional revision,
 * to an immutable commit SHA. For a local path this only reads the
 * repository (no mutation of its working tree, index, or HEAD). For a
 * remote URL it fetches the requested revision into a bare repository
 * under `bareRepoDir`.
 */
export async function resolveRepository(
  source: string,
  revision: string | undefined,
  bareRepoDir: string,
): Promise<RepositoryResolution> {
  if (isRemoteUrl(source)) {
    await mkdir(bareRepoDir, { recursive: true });
    await git(["init", "--bare", "-q", bareRepoDir], bareRepoDir);
    await git(["fetch", "-q", "--depth", "1", source, revision ?? "HEAD"], bareRepoDir);
    const commitSha = await git(["rev-parse", "FETCH_HEAD"], bareRepoDir);
    return { resolved: { source, commitSha }, archiveDir: bareRepoDir };
  }

  const commitSha = await git(["rev-parse", revision ?? "HEAD"], source);
  return { resolved: { source, commitSha }, archiveDir: source };
}

/**
 * Materializes the resolved commit into an isolated analysis workspace via
 * `git archive | tar -x`, so the source repository's working tree, index,
 * and HEAD are never touched.
 */
export async function createIsolatedWorkspace(resolution: RepositoryResolution, workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const gitCommand = ["git", "archive", resolution.resolved.commitSha];
    const tarCommand = ["tar", "-x", "-C", workspaceRoot];
    const gitArchive = spawn(gitCommand[0] as string, gitCommand.slice(1), {
      cwd: resolution.archiveDir,
    });
    const tar = spawn(tarCommand[0] as string, tarCommand.slice(1));

    const gitArchiveStderr = captureStderr(gitArchive.stderr);
    const tarStderr = captureStderr(tar.stderr);
    let gitArchiveExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
    let tarExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
    let pipeError: unknown;
    let settled = false;

    const stopOtherProcess = (process: typeof gitArchive | typeof tar): void => {
      if (!process.killed) process.kill();
    };
    const rejectWithProcessError = (
      error: unknown,
      stage: string,
      command: readonly string[],
      sibling: typeof gitArchive | typeof tar,
    ): void => {
      if (settled) return;
      settled = true;
      stopOtherProcess(sibling);
      reject(new Error(formatExternalProcessError(error, stage, command.join(" ")), { cause: error }));
    };
    const finish = (): void => {
      if (settled || gitArchiveExit === undefined || tarExit === undefined) return;

      // A malformed/empty stream caused by git archive failing should retain
      // git's actionable stderr instead of replacing it with tar's secondary
      // "not an archive" diagnostic. A tar failure takes precedence when the
      // archive side was terminated by the pipe closing (SIGPIPE).
      if (gitArchiveExit.code !== null && gitArchiveExit.code !== 0) {
        settled = true;
        reject(
          new Error(
            formatExternalProcessError(
              { code: gitArchiveExit.code, signal: gitArchiveExit.signal, stderr: gitArchiveStderr() },
              "git archive",
              gitCommand.join(" "),
            ),
          ),
        );
        return;
      }
      if (tarExit.code !== 0 || tarExit.signal !== null) {
        settled = true;
        reject(
          new Error(
            formatExternalProcessError(
              { code: tarExit.code, signal: tarExit.signal, stderr: tarStderr() },
              "tar extraction",
              tarCommand.join(" "),
            ),
          ),
        );
        return;
      }
      if (gitArchiveExit.signal !== null) {
        settled = true;
        reject(
          new Error(
            formatExternalProcessError(
              { code: gitArchiveExit.code, signal: gitArchiveExit.signal, stderr: gitArchiveStderr() },
              "git archive",
              gitCommand.join(" "),
            ),
          ),
        );
        return;
      }
      if (pipeError !== undefined) {
        settled = true;
        reject(new Error(`archive pipe failed: ${boundedText(String(pipeError))}`, { cause: pipeError }));
        return;
      }
      settled = true;
      resolve();
    };

    gitArchive.once("error", (error) => {
      rejectWithProcessError(error, "git archive", gitCommand, tar);
    });
    tar.once("error", (error) => {
      rejectWithProcessError(error, "tar extraction", tarCommand, gitArchive);
    });
    gitArchive.once("close", (code, signal) => {
      gitArchiveExit = { code, signal };
      finish();
    });
    tar.once("close", (code, signal) => {
      tarExit = { code, signal };
      finish();
    });
    gitArchive.stdout.once("error", (error) => {
      pipeError ??= error;
    });
    tar.stdin.once("error", (error) => {
      pipeError ??= error;
    });

    gitArchive.stdout.pipe(tar.stdin);
  });
}
