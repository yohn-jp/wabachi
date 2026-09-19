import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { buildArchitectureSite, type ArchitectureSiteRequest } from "./site.js";
import type { DocumentationModel } from "./model.js";
import type { StructurizrStaticExportResult } from "../projection/structurizr-export.js";
import type { StructurizrProjection } from "../projection/structurizr.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function documentation(documentId = "architecture-document"): DocumentationModel {
  return {
    canonVersion: 1,
    documentId: documentId as DocumentationModel["documentId"],
    root: { canonId: "architecture" },
    navigation: [{ section: "structure", groupKeys: ["elements"] }],
    sections: [
      {
        key: "structure",
        groups: [
          {
            key: "elements",
            entries: [{ key: "orders", anchors: [{ canonId: "orders" }], data: { id: "orders", kind: "service" } }],
          },
        ],
      },
    ],
  } as unknown as DocumentationModel;
}

function structurizr(documentId = "architecture-document"): StructurizrProjection {
  return {
    canonVersion: 1,
    documentId: documentId as StructurizrProjection["documentId"],
    dsl: 'workspace "architecture-document" {}\n',
    identityMappings: [],
    viewMappings: [],
    losses: [
      {
        code: "unsupported-boundary",
        path: "boundaries[0]",
        canonIds: ["boundary"],
        message: "boundary is not represented",
      },
    ],
  };
}

function successfulExport(): StructurizrStaticExportResult {
  return {
    tool: { id: "structurizr", executable: "mock", launcherArgs: [], version: "mock-1" },
    workspacePath: "",
    outputDirectory: "",
    invocations: {
      version: { executable: "mock", args: ["--version"], shell: false },
      export: { executable: "mock", args: ["export"], shell: false },
    },
    versionOutput: { stdout: "mock-1\n", stderr: "" },
    output: { stdout: "", stderr: "" },
    status: "ok",
    exitCode: 0,
    signal: null,
    diagnostic: null,
  };
}

function request(
  outputRoot: string,
  exportAdapter: NonNullable<ArchitectureSiteRequest["exportAdapter"]>,
): ArchitectureSiteRequest {
  return {
    outputRoot,
    documentation: documentation(),
    structurizr: structurizr(),
    launcher: { executable: "mock-structurizr" },
    exportAdapter,
  };
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("assembles deterministic documentation, DSL, loss report, and separate diagram output", async () => {
  const parent = await temporaryDirectory("wabachi-site-success-");
  const outputRoot = path.join(parent, "site");
  const unrelated = path.join(outputRoot, "keep-me.txt");
  await mkdir(outputRoot);
  await writeFile(unrelated, "preserve", "utf8");

  const result = await buildArchitectureSite(
    request(outputRoot, async ({ workspacePath, outputDirectory }) => {
      assert.equal(workspacePath, path.join(outputRoot, "workspace.dsl"));
      assert.equal(outputDirectory, path.join(outputRoot, "diagrams"));
      await writeFile(path.join(outputDirectory, "index.html"), "diagram artifact", "utf8");
      const exportResult = successfulExport();
      return { ...exportResult, workspacePath, outputDirectory };
    }),
  );

  assert.equal(result.status, "ok");
  assert.equal(result.complete, true);
  assert.deepEqual(result.losses, structurizr().losses);
  assert.match(await readFile(path.join(outputRoot, "index.html"), "utf8"), /architecture-site/);
  assert.match(await readFile(path.join(outputRoot, "index.html"), "utf8"), /diagrams\/index\.html/);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputRoot, "projection-losses.json"), "utf8")), {
    canonVersion: 1,
    documentId: "architecture-document",
    losses: structurizr().losses,
  });
  assert.equal(await readFile(path.join(outputRoot, "workspace.dsl"), "utf8"), structurizr().dsl);
  assert.equal(await readFile(path.join(outputRoot, "diagrams/index.html"), "utf8"), "diagram artifact");
  assert.equal(await readFile(unrelated, "utf8"), "preserve");
});

test("keeps exporter failure visible and does not report a complete site", async () => {
  const parent = await temporaryDirectory("wabachi-site-failure-");
  const outputRoot = path.join(parent, "site");
  const result = await buildArchitectureSite(
    request(outputRoot, async ({ workspacePath, outputDirectory }) => {
      const failed = successfulExport();
      return {
        ...failed,
        workspacePath,
        outputDirectory,
        status: "failed",
        exitCode: 9,
        output: { stdout: "partial", stderr: "export failed" },
        diagnostic: { code: "non-zero-exit", phase: "export", message: "mock failed" },
      };
    }),
  );

  assert.equal(result.status, "export-failed");
  assert.equal(result.complete, false);
  assert.equal(result.export.status, "failed");
  assert.equal(result.export.diagnostic.code, "non-zero-exit");
  await access(path.join(outputRoot, "workspace.dsl"));
  assert.match(await readFile(path.join(outputRoot, "projection-losses.json"), "utf8"), /unsupported-boundary/);
});

test("fails closed for generation mismatch and unsafe overwrite", async () => {
  const parent = await temporaryDirectory("wabachi-site-safety-");
  const mismatchRoot = path.join(parent, "mismatch");
  await assert.rejects(
    () =>
      buildArchitectureSite({
        ...request(mismatchRoot, async () => successfulExport()),
        structurizr: structurizr("different-document"),
      }),
    /same Canon generation/u,
  );

  const existingRoot = path.join(parent, "existing");
  await mkdir(existingRoot);
  await writeFile(path.join(existingRoot, "index.html"), "existing", "utf8");
  await assert.rejects(
    () => buildArchitectureSite(request(existingRoot, async () => successfulExport())),
    /overwrite/u,
  );
  assert.equal(await readFile(path.join(existingRoot, "index.html"), "utf8"), "existing");
});
