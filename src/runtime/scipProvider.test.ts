import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { ProviderContext } from "./provider.js";
import type { ScipObservation } from "./scipProvider.js";
import { createScipTypescriptProvider } from "./scipProvider.js";

const fixtureDir = path.join(import.meta.dirname, "fixtures", "scip-sample");
const tmpRoots: string[] = [];

after(async () => {
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newContext(): Promise<ProviderContext> {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-scip-test-"));
  tmpRoots.push(runRoot);

  const workspaceRoot = path.join(runRoot, "workspace");
  await cp(fixtureDir, workspaceRoot, { recursive: true });

  const artifactRoot = path.join(runRoot, "artifacts");
  await mkdir(artifactRoot, { recursive: true });

  return { workspaceRoot, artifactRoot, repository: { source: fixtureDir, commitSha: "0".repeat(40) } };
}

test("is available when scip-typescript is installed", async () => {
  const context = await newContext();
  const provider = createScipTypescriptProvider();
  assert.equal(await provider.isAvailable(context), true);
});

test("retains the raw SCIP index and emits the observation envelope", async () => {
  const context = await newContext();
  const provider = createScipTypescriptProvider();

  const result = await provider.execute(context);

  assert.equal(result.status, "ok");
  assert.deepEqual([...result.artifacts].sort(), ["index.scip", "observations.json"]);

  const rawIndex = await readFile(path.join(context.artifactRoot, "index.scip"));
  assert.ok(rawIndex.byteLength > 0);

  const observations = JSON.parse(
    await readFile(path.join(context.artifactRoot, "observations.json"), "utf8"),
  ) as ScipObservation[];
  assert.ok(observations.length > 0);
});

test("emits define/reference observations with SCIP-native symbols and source locations", async () => {
  const context = await newContext();
  const provider = createScipTypescriptProvider();
  await provider.execute(context);

  const observations = JSON.parse(
    await readFile(path.join(context.artifactRoot, "observations.json"), "utf8"),
  ) as ScipObservation[];

  const definesDescribe = observations.find((o) => o.predicate === "defines" && o.subject.id.includes("describe("));
  assert.ok(definesDescribe, "expected a defines observation for describe()");
  assert.equal(definesDescribe?.source.path, "greeter.ts");
  assert.equal(definesDescribe?.determinism, "deterministic");
  assert.equal(definesDescribe?.provider.id, "scip-typescript");

  const referencesGreet = observations.find(
    (o) => o.predicate === "references" && o.subject.id.includes("Greeter#greet"),
  );
  assert.ok(referencesGreet, "expected a references observation for Greeter#greet()");
});

test("emits an implements relationship for a class implementing an interface", async () => {
  const context = await newContext();
  const provider = createScipTypescriptProvider();
  await provider.execute(context);

  const observations = JSON.parse(
    await readFile(path.join(context.artifactRoot, "observations.json"), "utf8"),
  ) as ScipObservation[];

  const implementsGreeter = observations.find(
    (o) =>
      o.predicate === "implements" &&
      o.subject.id.includes("FriendlyGreeter") &&
      "id" in o.object &&
      o.object.id.endsWith("Greeter#"),
  );
  assert.ok(implementsGreeter, "expected FriendlyGreeter to implement Greeter");
});

test("is deterministic for a pinned workspace and toolchain", async () => {
  const context = await newContext();
  const provider = createScipTypescriptProvider();

  await provider.execute(context);
  const firstIndex = await readFile(path.join(context.artifactRoot, "index.scip"));
  const firstObservations = await readFile(path.join(context.artifactRoot, "observations.json"), "utf8");

  await provider.execute(context);
  const secondIndex = await readFile(path.join(context.artifactRoot, "index.scip"));
  const secondObservations = await readFile(path.join(context.artifactRoot, "observations.json"), "utf8");

  assert.equal(Buffer.compare(firstIndex, secondIndex), 0);
  assert.equal(firstObservations, secondObservations);
});
