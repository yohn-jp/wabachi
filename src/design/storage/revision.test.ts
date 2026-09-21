import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, test } from "node:test";
import {
  assertRevisionFresh,
  checkRevisionFreshness,
  computeGitSubjectDigest,
  GitProcessError,
  NonAncestorRevisionError,
} from "./revision.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wabachi-design-revision-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRepository(): Promise<{ readonly root: string; readonly revision: string }> {
  const root = await temporaryDirectory();
  const git = (args: string[]) => execFileAsync("git", args, { cwd: root });
  await git(["init", "-q"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await mkdir(path.join(root, ".wabachi", "changes", "change-205"), { recursive: true });
  await writeFile(path.join(root, "src", "main.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, "test", "main.test.ts"), "test();\n");
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(path.join(root, ".wabachi", "changes", "change-205", "change.json"), '{"value":1}\n');
  await writeFile(path.join(root, ".wabachi", "changes", "change-205", "lifecycle.json"), '{"state":"draft"}\n');
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "initial"]);
  const revision = (await git(["rev-parse", "HEAD"])).stdout.trim();
  return { root, revision };
}

async function commit(root: string, message: string): Promise<string> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: root });
  await git(["add", "."]);
  await git(["commit", "-q", "-m", message]);
  return (await git(["rev-parse", "HEAD"])).stdout.trim();
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("tree subject includes source, test, lockfile, mode, and semantic change entries", async () => {
  const { root, revision } = await createRepository();
  const initial = await computeGitSubjectDigest({ repositoryRoot: root, revision });

  await writeFile(path.join(root, "src", "main.ts"), "export const value = 2;\n");
  const sourceRevision = await commit(root, "source");
  assert.notEqual(await computeGitSubjectDigest({ repositoryRoot: root, revision: sourceRevision }), initial);

  await writeFile(path.join(root, "test", "main.test.ts"), "test(2);\n");
  const testRevision = await commit(root, "test");
  assert.notEqual(await computeGitSubjectDigest({ repositoryRoot: root, revision: testRevision }), initial);

  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nsettings: {}\n");
  const lockRevision = await commit(root, "lockfile");
  assert.notEqual(await computeGitSubjectDigest({ repositoryRoot: root, revision: lockRevision }), initial);

  await writeFile(path.join(root, ".wabachi", "changes", "change-205", "change.json"), '{"value":2}\n');
  const changeRevision = await commit(root, "change");
  const changeSubject = await computeGitSubjectDigest({ repositoryRoot: root, revision: changeRevision });
  assert.notEqual(changeSubject, initial);

  await chmod(path.join(root, "src", "main.ts"), 0o755);
  const modeRevision = await commit(root, "mode");
  assert.notEqual(await computeGitSubjectDigest({ repositoryRoot: root, revision: modeRevision }), changeSubject);
});

test("excludes only the active lifecycle record from the subject", async () => {
  const { root, revision } = await createRepository();
  const initial = await computeGitSubjectDigest({
    repositoryRoot: root,
    revision,
    activeRecordPath: ".wabachi/changes/change-205/lifecycle.json",
  });
  await writeFile(path.join(root, ".wabachi", "changes", "change-205", "lifecycle.json"), '{"state":"approved"}\n');
  const lifecycleRevision = await commit(root, "lifecycle");
  assert.equal(
    await computeGitSubjectDigest({
      repositoryRoot: root,
      revision: lifecycleRevision,
      activeRecordPath: ".wabachi/changes/change-205/lifecycle.json",
    }),
    initial,
  );

  await writeFile(path.join(root, ".wabachi", "changes", "change-205", "change.json"), '{"value":9}\n');
  const changeRevision = await commit(root, "semantic change");
  assert.notEqual(
    await computeGitSubjectDigest({
      repositoryRoot: root,
      revision: changeRevision,
      activeRecordPath: ".wabachi/changes/change-205/lifecycle.json",
    }),
    initial,
  );
});

test("distinguishes fresh, non-ancestor, and Git process failures", async () => {
  const { root, revision } = await createRepository();
  const fresh = await checkRevisionFreshness({ repositoryRoot: root, expectedRevision: revision });
  assert.equal(fresh.status, "fresh");

  await writeFile(path.join(root, "src", "main.ts"), "export const value = 5;\n");
  const newer = await commit(root, "newer");
  const stale = await checkRevisionFreshness({
    repositoryRoot: root,
    expectedRevision: newer,
    actualRevision: revision,
  });
  assert.equal(stale.status, "non-ancestor");
  await assert.rejects(
    assertRevisionFresh({ repositoryRoot: root, expectedRevision: newer, actualRevision: revision }),
    (error: unknown) => error instanceof NonAncestorRevisionError,
  );
  await assert.rejects(
    checkRevisionFreshness({ repositoryRoot: root, expectedRevision: "does-not-exist" }),
    (error: unknown) => error instanceof GitProcessError && error.message.length < 1400,
  );
});
