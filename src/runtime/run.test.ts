import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { createFixtureProvider } from "./fixtureProvider.js";
import type { Provider, ProviderContext, ProviderExecutionResult } from "./provider.js";
import { run } from "./run.js";

const execFileAsync = promisify(execFile);

let fixtureRepoDir: string;
let firstCommitSha: string;
let secondCommitSha: string;
const tmpRoots: string[] = [];

before(async () => {
  fixtureRepoDir = await mkdtemp(path.join(os.tmpdir(), "wabachi-fixture-repo-"));
  const git = (args: string[]) => execFileAsync("git", args, { cwd: fixtureRepoDir });

  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);

  await writeFile(path.join(fixtureRepoDir, "a.txt"), "first\n", "utf8");
  await git(["add", "a.txt"]);
  await git(["commit", "-q", "-m", "first"]);
  firstCommitSha = (await git(["rev-parse", "HEAD"])).stdout.trim();

  await writeFile(path.join(fixtureRepoDir, "b.txt"), "second\n", "utf8");
  await git(["add", "b.txt"]);
  await git(["commit", "-q", "-m", "second"]);
  secondCommitSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
});

after(async () => {
  await rm(fixtureRepoDir, { recursive: true, force: true });
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newRunRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wabachi-run-"));
  tmpRoots.push(dir);
  return dir;
}

test("pins the run to the requested revision, not HEAD", async () => {
  const runRoot = await newRunRoot();
  const { manifest } = await run({
    source: fixtureRepoDir,
    revision: firstCommitSha,
    runRoot,
    providers: [createFixtureProvider()],
  });

  assert.equal(manifest.repository.commitSha, firstCommitSha);
  assert.notEqual(manifest.repository.commitSha, secondCommitSha);

  const workspaceEntries = manifest.providers[0]?.result.artifacts;
  assert.ok(workspaceEntries);
  const artifactContent = JSON.parse(await readFile(path.join(runRoot, "raw", "fixture", "entries.json"), "utf8")) as {
    entries: string[];
  };
  assert.deepEqual(artifactContent.entries.sort(), ["a.txt"]);
});

test("defaults to resolving HEAD when no revision is given", async () => {
  const runRoot = await newRunRoot();
  const { manifest } = await run({
    source: fixtureRepoDir,
    runRoot,
    providers: [],
  });

  assert.equal(manifest.repository.commitSha, secondCommitSha);
});

test("does not mutate the input repository", async () => {
  const runRoot = await newRunRoot();
  const beforeStatus = await execFileAsync("git", ["status", "--porcelain"], { cwd: fixtureRepoDir });
  const beforeHead = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: fixtureRepoDir });

  await run({ source: fixtureRepoDir, runRoot, providers: [createFixtureProvider()] });

  const afterStatus = await execFileAsync("git", ["status", "--porcelain"], { cwd: fixtureRepoDir });
  const afterHead = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: fixtureRepoDir });

  assert.equal(afterStatus.stdout, beforeStatus.stdout);
  assert.equal(afterHead.stdout, beforeHead.stdout);
});

test("records an unavailable provider without affecting other providers", async () => {
  const runRoot = await newRunRoot();
  const { manifest } = await run({
    source: fixtureRepoDir,
    runRoot,
    providers: [
      createFixtureProvider({ id: "unavailable-one", available: false }),
      createFixtureProvider({ id: "ok-one" }),
    ],
  });

  const unavailableEntry = manifest.providers.find((entry) => entry.identity.id === "unavailable-one");
  const okEntry = manifest.providers.find((entry) => entry.identity.id === "ok-one");

  assert.equal(unavailableEntry?.result.status, "unavailable");
  assert.equal(okEntry?.result.status, "ok");
});

test("records a failed provider without affecting other providers' evidence", async () => {
  const runRoot = await newRunRoot();
  const failingProvider: Provider = {
    identity: { id: "failing-one", version: "0.0.1", determinism: "deterministic" },
    async isAvailable(): Promise<boolean> {
      return true;
    },
    async execute(_context: ProviderContext): Promise<ProviderExecutionResult> {
      throw new Error("boom");
    },
  };

  const { manifest } = await run({
    source: fixtureRepoDir,
    runRoot,
    providers: [failingProvider, createFixtureProvider({ id: "ok-two" })],
  });

  const failedEntry = manifest.providers.find((entry) => entry.identity.id === "failing-one");
  const okEntry = manifest.providers.find((entry) => entry.identity.id === "ok-two");

  assert.equal(failedEntry?.result.status, "failed");
  assert.equal(failedEntry?.result.error, "boom");
  assert.equal(okEntry?.result.status, "ok");

  const okArtifact = await readFile(path.join(runRoot, "raw", "ok-two", "entries.json"), "utf8");
  assert.ok(JSON.parse(okArtifact));
});

test("isolates each provider's raw artifacts under its own directory", async () => {
  const runRoot = await newRunRoot();
  await run({
    source: fixtureRepoDir,
    runRoot,
    providers: [createFixtureProvider({ id: "provider-a" }), createFixtureProvider({ id: "provider-b" })],
  });

  const artifactA = await readFile(path.join(runRoot, "raw", "provider-a", "entries.json"), "utf8");
  const artifactB = await readFile(path.join(runRoot, "raw", "provider-b", "entries.json"), "utf8");
  assert.ok(JSON.parse(artifactA));
  assert.ok(JSON.parse(artifactB));
});

test("persists a machine-readable manifest sufficient to reproduce the invocation", async () => {
  const runRoot = await newRunRoot();
  const { manifestPath, manifest } = await run({
    source: fixtureRepoDir,
    revision: firstCommitSha,
    runRoot,
    providers: [createFixtureProvider()],
  });

  const persisted = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(persisted.repository.commitSha, firstCommitSha);
  assert.equal(persisted.repository.source, fixtureRepoDir);
  assert.equal(persisted.providers[0].identity.id, "fixture");
  assert.ok(manifest.startedAt);
  assert.ok(manifest.finishedAt);
});
