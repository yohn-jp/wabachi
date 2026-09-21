import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, test } from "node:test";
import {
  assertRepositoryPathBoundary,
  createDesignRepositoryPaths,
  normalizeChangeId,
  normalizeStoragePath,
  resolveDesignRepositoryPaths,
  resolveRepositoryRoot,
} from "./paths.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wabachi-design-paths-"));
  temporaryDirectories.push(directory);
  return directory;
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("normalizes only rooted declaration paths and canonical ChangeIds", () => {
  assert.equal(normalizeChangeId("change-205"), "change-205");
  assert.equal(
    normalizeStoragePath(".wabachi\\changes/change-205/./change.json"),
    ".wabachi/changes/change-205/change.json",
  );

  for (const value of ["Change-205", "change/205", "change_205", "../change", "/tmp/change", "C:/change"]) {
    assert.throws(() => normalizeChangeId(value), /lowercase ASCII/u);
  }
  for (const value of ["", "../change.json", "/tmp/change.json", "C:/change.json"]) {
    assert.throws(() => normalizeStoragePath(value), /repository path/u);
  }
});

test("constructs deterministic conventional Canon and Design Change paths", () => {
  const root = path.join("/tmp", "repository");
  const paths = createDesignRepositoryPaths(root, "change-205");
  assert.equal(paths.canon, path.join(root, ".wabachi", "architecture.json"));
  assert.equal(paths.change, path.join(root, ".wabachi", "changes", "change-205", "change.json"));
  assert.equal(paths.lifecycle, path.join(root, ".wabachi", "changes", "change-205", "lifecycle.json"));
  assert.equal(paths.relative.change, ".wabachi/changes/change-205/change.json");
});

test("resolves the Git repository root and rejects symlinked storage ancestors", async () => {
  const root = await temporaryDirectory();
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  const nested = path.join(root, "nested");
  await mkdir(nested);
  const resolved = await resolveRepositoryRoot(nested);
  assert.equal(resolved, root);

  const outside = await temporaryDirectory();
  await mkdir(path.join(outside, "changes"), { recursive: true });
  await mkdir(path.join(root, ".wabachi"));
  await symlink(path.join(outside, "changes"), path.join(root, ".wabachi", "changes"));
  await assert.rejects(resolveDesignRepositoryPaths({ repositoryRoot: root, changeId: "change-205" }), /symlink/u);
});

test("filesystem boundary checking stays separate from path declaration normalization", async () => {
  const root = await temporaryDirectory();
  const target = await assertRepositoryPathBoundary(root, ".wabachi/changes/change-205/change.json");
  assert.equal(target, path.join(root, ".wabachi", "changes", "change-205", "change.json"));
  await assert.rejects(assertRepositoryPathBoundary(root, "../outside"), /repository path/u);
});
