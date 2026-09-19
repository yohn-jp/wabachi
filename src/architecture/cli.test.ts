import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createArchitectureDocument } from "./canon/document.js";
import { serializeCanonicalArchitectureDocument } from "./canon/codec.js";
import { runArchitectureCli } from "./cli.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wabachi-architecture-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function canonicalFile(directory: string): Promise<string> {
  const file = path.join(directory, "architecture.json");
  const document = createArchitectureDocument({ documentId: "architecture-document", root: { id: "architecture" } });
  await writeFile(file, serializeCanonicalArchitectureDocument(document), "utf8");
  return file;
}

function captureOutput(): { readonly logs: string[]; readonly errors: string[]; restore: () => void } {
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  console.error = (...values: unknown[]) => errors.push(values.map(String).join(" "));
  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("validate accepts only an explicit Canon file and emits JSON diagnostics", async () => {
  const directory = await temporaryDirectory();
  const file = await canonicalFile(directory);
  const output = captureOutput();
  try {
    assert.equal(await runArchitectureCli(["validate", file, "--json"]), 0);
    assert.deepEqual(JSON.parse(output.logs[0] ?? "{}"), {
      ok: true,
      command: "architecture validate",
      file,
    });
    assert.equal(await runArchitectureCli(["validate", "--json"]), 1);
    const failure = JSON.parse(output.logs[1] ?? "{}") as { diagnostics?: Array<{ code?: string }> };
    assert.equal(failure.diagnostics?.[0]?.code, "invalid-arguments");
  } finally {
    output.restore();
  }
});

test("invalid Canon returns a bounded non-zero JSON diagnostic", async () => {
  const directory = await temporaryDirectory();
  const file = path.join(directory, "invalid.json");
  await writeFile(file, "x".repeat(10_000), "utf8");
  const output = captureOutput();
  try {
    assert.equal(await runArchitectureCli(["validate", file, "--json"]), 1);
    const result = JSON.parse(output.logs[0] ?? "{}") as {
      diagnostics?: Array<{ code?: string; message?: string }>;
    };
    assert.equal(result.diagnostics?.[0]?.code, "invalid-canon");
    assert.ok((result.diagnostics?.[0]?.message?.length ?? 0) <= 240);
  } finally {
    output.restore();
  }
});

test("render uses the override as one executable identity and fixed export arguments", async () => {
  const directory = await temporaryDirectory();
  const file = await canonicalFile(directory);
  const outputRoot = path.join(directory, "site");
  const invocationLog = path.join(directory, "invocations.jsonl");
  const executable = path.join(directory, "structurizr test");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  console.log("test-structurizr-1");
} else {
  const output = args[args.indexOf("-output") + 1];
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "index.html"), "diagram");
}
`,
    "utf8",
  );
  await chmod(executable, 0o755);

  const output = captureOutput();
  try {
    assert.equal(
      await runArchitectureCli(["render", file, "--out", outputRoot, "--structurizr-command", executable, "--json"]),
      0,
    );
    const result = JSON.parse(output.logs[0] ?? "{}") as { ok?: boolean; outputRoot?: string };
    assert.equal(result.ok, true);
    assert.equal(result.outputRoot, outputRoot);
    assert.equal(await readFile(path.join(outputRoot, "diagrams", "index.html"), "utf8"), "diagram");

    const invocations = (await readFile(invocationLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.deepEqual(invocations, [
      ["version"],
      [
        "export",
        "-format",
        "static",
        "-workspace",
        path.join(outputRoot, "workspace.dsl"),
        "-output",
        path.join(outputRoot, "diagrams"),
      ],
    ]);
  } finally {
    output.restore();
  }
});

test("render export failure and raw argument strings return non-zero", async () => {
  const directory = await temporaryDirectory();
  const file = await canonicalFile(directory);
  const output = captureOutput();
  try {
    assert.equal(
      await runArchitectureCli([
        "render",
        file,
        "--out",
        path.join(directory, "missing-command-site"),
        "--structurizr-command",
        `${path.join(directory, "missing command")} --version`,
        "--json",
      ]),
      1,
    );
    const result = JSON.parse(output.logs[0] ?? "{}") as {
      diagnostics?: Array<{ code?: string }>;
    };
    assert.equal(result.diagnostics?.[0]?.code, "export-failed");
  } finally {
    output.restore();
  }
});
