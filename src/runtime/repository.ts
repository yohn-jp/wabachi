import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { ResolvedRepository } from "./provider.js";

const execFileAsync = promisify(execFile);

function isRemoteUrl(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(source) || /^[^/]+@[^:]+:/u.test(source);
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
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
    await execFileAsync("git", ["init", "--bare", "-q", bareRepoDir]);
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
    const gitArchive = execFile(
      "git",
      ["archive", resolution.resolved.commitSha],
      { cwd: resolution.archiveDir, maxBuffer: 1024 * 1024 * 1024 },
      (error) => {
        if (error) reject(error);
      },
    );
    const tar = execFile("tar", ["-x", "-C", workspaceRoot], (error) => {
      if (error) reject(error);
      else resolve();
    });
    if (!gitArchive.stdout || !tar.stdin) {
      reject(new Error("failed to pipe git archive into tar"));
      return;
    }
    gitArchive.stdout.pipe(tar.stdin);
  });
}
