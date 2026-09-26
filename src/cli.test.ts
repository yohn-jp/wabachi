import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runWabachiCli } from "./cli.js";

test("CLI Canon owns root help, progressive route help, discovery, and version", async () => {
  const root = await runWabachiCli(["--help"]);
  assert.equal(root.exitCode, 0);
  assert.match(root.stdout, /Usage: wabachi/u);
  assert.match(root.stdout, /architecture\t/u);
  assert.match(root.stdout, /design\t/u);
  assert.equal(root.stderr, "");

  const help = await runWabachiCli(["architecture", "--help=json"]);
  assert.equal(help.exitCode, 0);
  const discovery = JSON.parse(help.stdout) as { name: string; commands: Array<{ id: string; route: string[] }> };
  assert.equal(discovery.name, "wabachi");
  assert.deepEqual(
    discovery.commands.map(({ id }) => id),
    ["architecture.example", "architecture.render", "architecture.validate"],
  );
  assert.ok(discovery.commands.every(({ route }) => route[0] === "architecture"));

  const version = await runWabachiCli(["--version"]);
  assert.deepEqual(version, { exitCode: 0, stdout: "0.4.0\n", stderr: "" });
});

test("CLI Canon classifies malformed argv and missing required command inputs", async () => {
  const unknownOption = await runWabachiCli(["architecture", "render", "canon.json", "--out", "site", "--bad"]);
  assert.equal(unknownOption.failureKind, "usage");
  assert.equal(unknownOption.exitCode, 2);
  assert.match(unknownOption.stderr, /unknown option/u);

  const missingRepository = await runWabachiCli(["run"]);
  assert.equal(missingRepository.failureKind, "usage");
  assert.equal(missingRepository.exitCode, 2);
  assert.match(missingRepository.stderr, /repository/u);
});

test("Skill content is reached through the Canon route and keeps its domain size bound", async () => {
  const index = await runWabachiCli(["skill"]);
  assert.equal(index.exitCode, 0);
  assert.match(index.stdout, /Wabachi skill scenarios/u);
  assert.ok(Buffer.byteLength(index.stdout, "utf8") <= 4097);

  const scenario = await runWabachiCli(["skill", "architecture-documentation", "--json"]);
  assert.equal(scenario.exitCode, 0);
  const projection = JSON.parse(scenario.stdout) as {
    id: string;
    title: string;
    workflow: Array<{ commandId: string }>;
  };
  assert.equal(projection.id, "architecture-documentation");
  assert.match(projection.title, /Architecture Documentation/u);
  assert.deepEqual(
    projection.workflow.map((step) => step.commandId),
    ["architecture", "architecture.validate", "architecture.render"],
  );

  const missing = await runWabachiCli(["skill", "not-a-scenario"]);
  assert.equal(missing.failureKind, "domain");
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /unknown skill scenario/u);

  const missingMachine = await runWabachiCli(["skill", "not-a-scenario", "--json"]);
  assert.equal(missingMachine.failureKind, "domain");
  assert.equal(missingMachine.exitCode, 1);
  assert.equal(JSON.parse(missingMachine.stdout).diagnostics[0].code, "unknown-scenario");
});

test("run and matrix keep their analysis behavior behind typed Canon bindings", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-canon-run-"));
  const matrixSource = await mkdtemp(path.join(os.tmpdir(), "wabachi-canon-matrix-source-"));
  const matrixRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-canon-matrix-output-"));
  try {
    const run = await runWabachiCli(["run", ".", "--out", runRoot]);
    assert.equal(run.exitCode, 0);
    const manifestPath = run.stdout.trim();
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      repository: { commitSha: string };
    };
    assert.match(manifest.repository.commitSha, /^[0-9a-f]{40}$/u);

    const matrix = await runWabachiCli(["matrix", matrixSource, "--revision", "0".repeat(40), "--out", matrixRoot]);
    assert.equal(matrix.failureKind, "domain");
    assert.equal(matrix.exitCode, 1);
    assert.match(matrix.stderr, /git failed: git rev-parse/u);
  } finally {
    await Promise.all([
      rm(runRoot, { recursive: true, force: true }),
      rm(matrixSource, { recursive: true, force: true }),
      rm(matrixRoot, { recursive: true, force: true }),
    ]);
  }
});
