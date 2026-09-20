import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, test } from "node:test";
import { createIsolatedWorkspace, resolveRepository } from "./repository.js";

const execFileAsync = promisify(execFile);

const tmpDirs: string[] = [];

after(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/**
 * A text-only fixture repo does not reproduce the pipe corruption fixed
 * here. The failure requires non-UTF-8 binary content in the archived tree
 * (e.g. an image asset), which corrupts when piped through `execFile`'s
 * default text-mode stdout handling. This mirrors a real repository that
 * tracks a binary asset alongside source files.
 */
async function createFixtureRepoWithBinaryAsset(): Promise<{
  repoDir: string;
  commitSha: string;
  binaryContent: Buffer;
}> {
  const repoDir = await newTmpDir("wabachi-binary-fixture-repo-");
  const git = (args: string[]) => execFileAsync("git", args, { cwd: repoDir });

  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);

  for (let d = 0; d < 20; d += 1) {
    const dir = path.join(repoDir, `module-${d}`);
    await mkdir(dir, { recursive: true });
    for (let f = 0; f < 5; f += 1) {
      await writeFile(path.join(dir, `file-${f}.ts`), "export const x = 1;\n".repeat(30), "utf8");
    }
  }

  const binaryContent = randomBytes(75_000);
  await writeFile(path.join(repoDir, "asset.bin"), binaryContent);

  await git(["add", "."]);
  await git(["commit", "-q", "-m", "fixture with binary asset"]);
  const { stdout } = await git(["rev-parse", "HEAD"]);
  return { repoDir, commitSha: stdout.trim(), binaryContent };
}

test("createIsolatedWorkspace materializes a repository containing binary content without corrupting the archive stream", async () => {
  const { repoDir, commitSha, binaryContent } = await createFixtureRepoWithBinaryAsset();
  const resolution = await resolveRepository(repoDir, commitSha, path.join(repoDir, ".unused-bare"));
  const workspaceRoot = await newTmpDir("wabachi-workspace-");

  await createIsolatedWorkspace(resolution, workspaceRoot);

  const entries = await readdir(workspaceRoot);
  assert.ok(entries.includes("module-0"));
  assert.ok(entries.includes("module-19"));
  assert.ok(entries.includes("asset.bin"));

  const extractedBinary = await readFile(path.join(workspaceRoot, "asset.bin"));
  assert.ok(extractedBinary.equals(binaryContent));
});
