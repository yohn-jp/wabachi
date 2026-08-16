import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { buildProviderMatrixFromArtifact } from "./matrix.js";
import { OBSERVATION_SCHEMA_VERSION, type Observation } from "./observation.js";
import type { Provider, ProviderContext, ProviderExecutionResult } from "./provider.js";
import { runProviderMatrix } from "./workflow.js";

const execFileAsync = promisify(execFile);

test("runs providers once and persists the complete downstream workflow", async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "wabachi-workflow-repo-"));
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-workflow-run-"));
  let executions = 0;
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: repository });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repository });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repository });
    await writeFile(path.join(repository, "main.ts"), "export const value = 1;\n", "utf8");
    await execFileAsync("git", ["add", "main.ts"], { cwd: repository });
    await execFileAsync("git", ["commit", "-q", "-m", "fixture"], { cwd: repository });
    const revision = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repository })).stdout.trim();

    const provider: Provider = {
      identity: { id: "workflow-fixture", version: "1.0.0", determinism: "deterministic" },
      async isAvailable(): Promise<boolean> {
        return true;
      },
      async execute(context: ProviderContext): Promise<ProviderExecutionResult> {
        executions += 1;
        const observation: Observation = {
          schemaVersion: OBSERVATION_SCHEMA_VERSION,
          subject: { id: "workflow-fixture:value", kind: "variable" },
          predicate: "defines",
          object: { value: "main.ts" },
          provider: { id: "workflow-fixture", version: "1.0.0", determinism: "deterministic" },
          repository: context.repository,
          source: { path: "main.ts", span: "1:1-1:24" },
          determinism: "deterministic",
          providerNative: { source: "fixture" },
        };
        await writeFile(
          path.join(context.artifactRoot, "observations.json"),
          JSON.stringify([observation]) + "\n",
          "utf8",
        );
        return {
          status: "ok",
          artifacts: ["observations.json"],
          observationArtifacts: ["observations.json"],
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
        };
      },
    };

    const result = await runProviderMatrix({ source: repository, revision, runRoot, providers: [provider] });
    assert.equal(executions, 1);
    assert.equal(result.manifest.repository.commitSha, revision);
    assert.match(await readFile(result.correlationPath, "utf8"), /workflow-fixture/u);
    assert.match(await readFile(result.matrixPaths.reportPath, "utf8"), /Provider Matrix/u);
    const fromPersistedFacts = await buildProviderMatrixFromArtifact(result.normalizedFactsPath, {
      providers: [provider.identity],
    });
    assert.deepEqual(fromPersistedFacts, result.matrix);
    assert.equal(executions, 1, "matrix generation must not rerun providers");
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("rejects a symbolic revision before provider execution", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-workflow-sha-"));
  try {
    await assert.rejects(
      runProviderMatrix({ source: ".", revision: "main", runRoot, providers: [] }),
      /explicit 40-character commit SHA/u,
    );
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
});
