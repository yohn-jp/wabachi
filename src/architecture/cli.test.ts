import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runWabachiCli } from "../cli.js";
import { createArchitectureDocument } from "./canon/document.js";
import { parseCanonicalArchitectureDocument, serializeCanonicalArchitectureDocument } from "./canon/codec.js";

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

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("architecture example is parsed by the existing domain parser and remains the emitted asset", async () => {
  const expected = `${(await readFile(new URL("../../docs/examples/minimal-canon.json", import.meta.url), "utf8")).trim()}\n`;
  const result = await runWabachiCli(["architecture", "example"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");

  const document = parseCanonicalArchitectureDocument(result.stdout);
  assert.equal(document.documentId, "minimal-architecture-canon");
  assert.equal(document.root.id, "architecture");
  assert.deepEqual(document.elements, []);
});

test("architecture validate keeps the document summary and projects structured JSON", async () => {
  const directory = await temporaryDirectory();
  const file = path.join(directory, "architecture.json");
  const document = createArchitectureDocument({
    documentId: "architecture-document",
    root: { id: "architecture" },
    elements: [
      { id: "orders", kind: "service" },
      { id: "payments", kind: "service" },
    ],
    interfaces: [{ id: "orders-api", owner: "orders", protocol: "https" }],
    relationships: [{ source: "orders", target: "payments", kind: "calls" }],
    flows: [{ id: "checkout", steps: [{ interfaceId: "orders-api", operation: "create" }] }],
    views: [
      {
        key: "checkout-flow",
        kind: "dynamic",
        scope: { include: [{ kind: "flow", id: "checkout" }] },
        root: { kind: "element", id: "orders" },
      },
    ],
  });
  await writeFile(file, serializeCanonicalArchitectureDocument(document), "utf8");

  const result = await runWabachiCli(["architecture", "validate", file, "--json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    command: "architecture validate",
    file,
    elements: 2,
    interfaces: 1,
    relationships: 1,
    flows: 1,
    views: 1,
  });

  const text = await runWabachiCli(["architecture", "validate", file]);
  assert.equal(
    text.stdout,
    `valid Architecture Canon: ${file}\nArchitecture Canon summary: elements=2, interfaces=1, relationships=1, flows=1, views=1\n`,
  );
});

test("architecture validates and renders the conventional Canon without changing the working directory contract", async () => {
  const directory = await temporaryDirectory();
  await mkdir(path.join(directory, ".wabachi"));
  await writeFile(
    path.join(directory, ".wabachi", "architecture.json"),
    await readFile(await canonicalFile(directory), "utf8"),
    "utf8",
  );
  const outputRoot = path.join(directory, "site");
  const originalDirectory = process.cwd();
  process.chdir(directory);
  try {
    const validate = await runWabachiCli(["architecture", "validate", "--json"]);
    assert.equal(validate.exitCode, 0);
    assert.equal(JSON.parse(validate.stdout).file, ".wabachi/architecture.json");

    const render = await runWabachiCli(["architecture", "render", "--out", outputRoot, "--json"]);
    assert.equal(render.exitCode, 0);
    assert.deepEqual(JSON.parse(render.stdout), {
      ok: true,
      command: "architecture render",
      file: ".wabachi/architecture.json",
      outputRoot,
      projectionLosses: 0,
    });
    assert.match(await readFile(path.join(outputRoot, "diagrams", "index.html"), "utf8"), /React Flow/u);
    assert.match(
      await readFile(path.join(outputRoot, "diagrams", "wabachi-react-flow.css"), "utf8"),
      /wabachi-react-flow/u,
    );
  } finally {
    process.chdir(originalDirectory);
  }
});

test("architecture domain failures remain distinct from Canon usage failures", async () => {
  const directory = await temporaryDirectory();
  const missing = path.join(directory, "missing-architecture.json");
  const result = await runWabachiCli([
    "architecture",
    "render",
    missing,
    "--out",
    path.join(directory, "site"),
    "--json",
  ]);
  assert.equal(result.failureKind, "domain");
  assert.equal(result.exitCode, 1);
  const failure = JSON.parse(result.stdout) as { diagnostics?: Array<{ code?: string; message?: string }> };
  assert.equal(failure.diagnostics?.[0]?.code, "invalid-canon");
  assert.equal(failure.diagnostics?.[0]?.message, `architecture document not found: ${missing}`);
  assert.doesNotMatch(failure.diagnostics?.[0]?.message ?? "", /ENOENT/u);

  const invalid = path.join(directory, "invalid.json");
  await writeFile(invalid, "x".repeat(10_000), "utf8");
  const invalidResult = await runWabachiCli(["architecture", "validate", invalid, "--json"]);
  assert.equal(invalidResult.failureKind, "domain");
  const invalidFailure = JSON.parse(invalidResult.stdout) as {
    diagnostics?: Array<{ code?: string; message?: string }>;
  };
  assert.equal(invalidFailure.diagnostics?.[0]?.code, "invalid-canon");
  assert.ok((invalidFailure.diagnostics?.[0]?.message?.length ?? 0) <= 240);
});
