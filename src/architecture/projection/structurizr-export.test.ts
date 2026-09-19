import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runStructurizrStaticExport } from "./structurizr-export.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeMockStructurizr(directory: string, body: string): Promise<string> {
  const script = path.join(directory, "structurizr-mock.mjs");
  await writeFile(script, body, "utf8");
  return script;
}

const nodeLauncher = (script: string) => ({ executable: process.execPath, args: [script] });

test("records the exact vNext static-export argv, tool version, and output without shell expansion", async () => {
  const directory = await temporaryDirectory("wabachi-structurizr-success-");
  const marker = path.join(directory, "shell-marker");
  const workspacePath = path.join(directory, "generated workspace.dsl;touch", "workspace.dsl");
  const outputDirectory = `${path.join(directory, "static site")};touch ${marker}`;
  const script = await writeMockStructurizr(
    directory,
    [
      "const args = process.argv.slice(2);",
      "if (args[0] === 'version') { console.log('Structurizr CLI vNext mock 1.2.3'); process.exit(0); }",
      "if (args[0] === 'export') { console.log(JSON.stringify(args)); console.error('static export complete'); process.exit(0); }",
      "process.exit(9);",
    ].join("\n"),
  );

  const result = await runStructurizrStaticExport({
    launcher: nodeLauncher(script),
    workspacePath,
    outputDirectory,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.tool.id, "structurizr");
  assert.equal(result.tool.version, "Structurizr CLI vNext mock 1.2.3");
  assert.deepEqual(result.invocations.export, {
    executable: process.execPath,
    args: [script, "export", "-format", "static", "-workspace", workspacePath, "-output", outputDirectory],
    shell: false,
  });
  assert.deepEqual(JSON.parse(result.output.stdout) as string[], result.invocations.export.args.slice(1));
  assert.equal(result.output.stderr, "static export complete\n");
  assert.equal(result.versionOutput.stdout, "Structurizr CLI vNext mock 1.2.3\n");
  assert.equal(result.diagnostic, null);
  await assert.rejects(() => rm(marker));
});

test("returns an explicit unavailable result when the Structurizr executable is absent", async () => {
  const directory = await temporaryDirectory("wabachi-structurizr-unavailable-");
  const missingExecutable = path.join(directory, "does-not-exist");
  const result = await runStructurizrStaticExport({
    launcher: { executable: missingExecutable },
    workspacePath: path.join(directory, "workspace.dsl"),
    outputDirectory: path.join(directory, "static"),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.diagnostic.code, "unavailable");
  assert.equal(result.diagnostic.phase, "version");
  assert.equal(result.tool.version, null);
  assert.equal(result.output.stdout, "");
  assert.equal(result.output.stderr, "");
});

test("returns an explicit spawn-failed result for a launcher that cannot execute", async () => {
  const directory = await temporaryDirectory("wabachi-structurizr-spawn-failure-");
  const nonExecutable = path.join(directory, "not-executable");
  await writeFile(nonExecutable, "not an executable\n", "utf8");
  await chmod(nonExecutable, 0o644);

  const result = await runStructurizrStaticExport({
    launcher: { executable: nonExecutable },
    workspacePath: path.join(directory, "workspace.dsl"),
    outputDirectory: path.join(directory, "static"),
  });

  assert.equal(result.status, "spawn-failed");
  assert.equal(result.diagnostic.code, "spawn-failed");
  assert.equal(result.diagnostic.phase, "version");
  assert.match(result.diagnostic.message, /could not be started/u);
});

test("retains exporter stderr and exit status when static export fails", async () => {
  const directory = await temporaryDirectory("wabachi-structurizr-export-failure-");
  const script = await writeMockStructurizr(
    directory,
    [
      "const args = process.argv.slice(2);",
      "if (args[0] === 'version') { console.log('Structurizr CLI vNext mock 1.2.3'); process.exit(0); }",
      "console.log('partial export output');",
      "console.error('invalid workspace');",
      "process.exit(7);",
    ].join("\n"),
  );

  const result = await runStructurizrStaticExport({
    launcher: nodeLauncher(script),
    workspacePath: path.join(directory, "workspace.dsl"),
    outputDirectory: path.join(directory, "static"),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.diagnostic.code, "non-zero-exit");
  assert.equal(result.diagnostic.phase, "export");
  assert.equal(result.exitCode, 7);
  assert.equal(result.tool.version, "Structurizr CLI vNext mock 1.2.3");
  assert.equal(result.output.stdout, "partial export output\n");
  assert.equal(result.output.stderr, "invalid workspace\n");
});

test("rejects missing bounded inputs without starting a process", async () => {
  const directory = await temporaryDirectory("wabachi-structurizr-invalid-input-");
  const result = await runStructurizrStaticExport({
    launcher: { executable: "" },
    workspacePath: path.join(directory, "workspace.dsl"),
    outputDirectory: "",
  });

  assert.equal(result.status, "invalid-input");
  assert.equal(result.diagnostic.code, "invalid-input");
  assert.equal(result.diagnostic.phase, "input");
  assert.deepEqual(result.invocations.version.args, ["version"]);
  assert.deepEqual(result.invocations.export.args, [
    "export",
    "-format",
    "static",
    "-workspace",
    path.join(directory, "workspace.dsl"),
    "-output",
    "",
  ]);
});
