import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { GraftWiringGraph } from "./graftWiring.js";
import { createGraftProvider } from "./graftProvider.js";
import type { Observation } from "./observation.js";
import type { ProviderContext } from "./provider.js";

const tmpDirs: string[] = [];

async function newTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Wiring graph used by the mock `graft` CLI below. It exercises both an
 * overlap case (a `calls` edge, which maps onto the common observation
 * envelope the same way TypeScript/SCIP evidence would) and a provider-only
 * case (the `contains` structural edge and a Graft-specific `wires-into`
 * relation, neither of which have a safe common predicate and so must stay
 * available only as raw provider-native evidence).
 */
const MOCK_WIRING: GraftWiringGraph = {
  meta: { version: 1, nodeCount: 3, edgeCount: 3, languages: ["typescript"] },
  nodes: [
    {
      id: "src/math.ts",
      name: "math.ts",
      kind: "file",
      path: "src/math.ts",
      span: "L1-L8",
      signature: null,
      exported: true,
      origin: "ast",
    },
    {
      id: "src/math.ts#add",
      name: "add",
      kind: "function",
      path: "src/math.ts",
      span: "L1-L3",
      signature: "function add(a: number, b: number): number",
      exported: true,
      origin: "ast",
    },
    {
      id: "src/math.ts#double",
      name: "double",
      kind: "function",
      path: "src/math.ts",
      span: "L5-L7",
      signature: "function double(x: number): number",
      exported: true,
      origin: "ast",
    },
  ],
  edges: [
    { source: "src/math.ts", target: "src/math.ts#add", relation: "contains", confidence: "extracted" },
    { source: "src/math.ts", target: "src/math.ts#double", relation: "contains", confidence: "extracted" },
    { source: "src/math.ts#double", target: "src/math.ts#add", relation: "calls", confidence: "extracted" },
    { source: "src/math.ts#double", target: "src/math.ts#add", relation: "wires-into", confidence: "extracted" },
  ],
};

/** Writes a fake `graft` executable that mimics the subset of the CLI this provider drives. */
async function writeMockGraftBinary(dir: string): Promise<string> {
  const binPath = path.join(dir, "graft");
  await writeFile(
    binPath,
    [
      "#!/usr/bin/env node",
      `const wiring = ${JSON.stringify(MOCK_WIRING)};`,
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') { console.log('graft-mock/1.2.3'); process.exit(0); }",
      "if (args[0] === 'build') {",
      "  const dirIndex = args.indexOf('--dir');",
      "  const outDir = args[dirIndex + 1];",
      "  fs.mkdirSync(path.join(outDir, '.graph'), { recursive: true });",
      "  fs.writeFileSync(path.join(outDir, '.graph', 'wiring.json'), JSON.stringify(wiring, null, 2));",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
    ].join("\n"),
    "utf8",
  );
  await chmod(binPath, 0o755);
  return binPath;
}

test("reports unavailable when the graft binary cannot be found", async () => {
  const missingDir = await newTmpDir("wabachi-graft-missing-");
  const provider = createGraftProvider({ binary: path.join(missingDir, "does-not-exist") });
  const context: ProviderContext = {
    workspaceRoot: missingDir,
    artifactRoot: missingDir,
    repository: { source: missingDir, commitSha: "deadbeef" },
  };
  const available = await provider.isAvailable(context);
  assert.equal(available, false);
});

test("executes graft build, retains raw wiring.json, and adapts mappable edges into observations", async () => {
  const binDir = await newTmpDir("wabachi-graft-bin-");
  const binary = await writeMockGraftBinary(binDir);
  const workspaceRoot = await newTmpDir("wabachi-graft-workspace-");
  const artifactRoot = await newTmpDir("wabachi-graft-artifacts-");

  const provider = createGraftProvider({ binary });
  const context: ProviderContext = {
    workspaceRoot,
    artifactRoot,
    repository: { source: workspaceRoot, commitSha: "deadbeef" },
  };

  assert.equal(await provider.isAvailable(context), true);
  const result = await provider.execute(context);

  assert.equal(result.status, "ok");
  assert.equal(provider.identity.version, "graft-mock/1.2.3");
  assert.equal(provider.identity.determinism, "deterministic");

  assert.deepEqual(
    [...result.artifacts].sort(),
    ["graft/.graph/wiring.json", "invocation.json", "observations.json"].sort(),
  );

  const rawWiring = JSON.parse(
    await readFile(path.join(artifactRoot, "graft", ".graph", "wiring.json"), "utf8"),
  ) as GraftWiringGraph;
  assert.deepEqual(rawWiring, MOCK_WIRING);

  const invocation = JSON.parse(await readFile(path.join(artifactRoot, "invocation.json"), "utf8")) as {
    version: string;
    deep: boolean;
  };
  assert.equal(invocation.version, "graft-mock/1.2.3");
  assert.equal(invocation.deep, false);

  const observations = JSON.parse(
    await readFile(path.join(artifactRoot, "observations.json"), "utf8"),
  ) as Observation[];

  const callsObservation = observations.find((observation) => observation.predicate === "calls");
  assert.ok(callsObservation, "expected the overlap-capable `calls` edge to be normalized");
  assert.equal(callsObservation?.subject.id, "src/math.ts#double");
  assert.equal((callsObservation?.object as { id: string }).id, "src/math.ts#add");
  assert.equal(callsObservation?.determinism, "deterministic");
  assert.equal(callsObservation?.provider.id, "graft");
  assert.equal(callsObservation?.repository.commitSha, "deadbeef");

  const containsObservation = observations.find(
    (observation) => (observation.providerNative as { edge: { relation: string } }).edge.relation === "contains",
  );
  assert.equal(
    containsObservation,
    undefined,
    "provider-only `contains` structure must not be forced into the common envelope",
  );

  const wiresIntoObservation = observations.find(
    (observation) => (observation.providerNative as { edge: { relation: string } }).edge.relation === "wires-into",
  );
  assert.equal(
    wiresIntoObservation,
    undefined,
    "unmapped Graft-specific relation must not be forced into the common envelope",
  );

  assert.equal(
    rawWiring.edges.some((edge) => edge.relation === "contains"),
    true,
    "provider-native evidence for unmapped edges must remain in raw wiring.json",
  );
  assert.equal(
    rawWiring.edges.some((edge) => edge.relation === "wires-into"),
    true,
    "provider-native evidence for unmapped edges must remain in raw wiring.json",
  );
});

test("marks the provider failed, without touching other artifacts, when graft build exits non-zero", async () => {
  const binDir = await newTmpDir("wabachi-graft-failing-bin-");
  const binPath = path.join(binDir, "graft");
  await writeFile(
    binPath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') { console.log('graft-mock/1.2.3'); process.exit(0); }",
      "process.exit(1);",
    ].join("\n"),
    "utf8",
  );
  await chmod(binPath, 0o755);

  const workspaceRoot = await newTmpDir("wabachi-graft-workspace-failing-");
  const artifactRoot = await newTmpDir("wabachi-graft-artifacts-failing-");
  const provider = createGraftProvider({ binary: binPath });
  const context: ProviderContext = {
    workspaceRoot,
    artifactRoot,
    repository: { source: workspaceRoot, commitSha: "deadbeef" },
  };

  assert.equal(await provider.isAvailable(context), true);
  await assert.rejects(() => provider.execute(context));
});
