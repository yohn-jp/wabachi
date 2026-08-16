import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "./cli.js";

test("--help exits 0 and prints usage", async () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line: string) => lines.push(line);
  try {
    const exitCode = await runCli(["--help"]);
    assert.equal(exitCode, 0);
    assert.match(lines.join("\n"), /Usage:/);
  } finally {
    console.log = originalLog;
  }
});

test("no arguments exits 1", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const exitCode = await runCli([]);
    assert.equal(exitCode, 1);
  } finally {
    console.log = originalLog;
  }
});

test("unknown command exits 1", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const exitCode = await runCli(["bogus"]);
    assert.equal(exitCode, 1);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test("run without a repository argument exits 1", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const exitCode = await runCli(["run"]);
    assert.equal(exitCode, 1);
  } finally {
    console.error = originalError;
  }
});

test("run resolves the given repository and writes a manifest", async () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line: string) => lines.push(line);

  const runRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-cli-run-"));
  try {
    const exitCode = await runCli(["run", ".", "--out", runRoot]);
    assert.equal(exitCode, 0);

    const manifestPath = lines.at(-1);
    assert.ok(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.match(manifest.repository.commitSha, /^[0-9a-f]{40}$/u);
  } finally {
    console.log = originalLog;
    await rm(runRoot, { recursive: true, force: true });
  }
});
