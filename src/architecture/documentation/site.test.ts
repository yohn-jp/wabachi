import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { buildArchitectureSite, type ArchitectureSiteRequest } from "./site.js";
import type { DocumentationModel } from "./model.js";
import type { ReactFlowProjection } from "../projection/react-flow.js";

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

function reactFlow(documentId = "architecture-document"): ReactFlowProjection {
  return {
    canonVersion: 1,
    documentId: documentId as ReactFlowProjection["documentId"],
    nodes: [],
    edges: [],
    views: [
      {
        key: "structure",
        kind: "structural",
        title: "Architecture structure",
        layout: { algorithm: "layered", direction: "RIGHT", nodeWidth: 180, nodeHeight: 80 },
        nodes: [],
        edges: [],
        losses: [],
      },
    ],
    losses: [],
  };
}

function request(outputRoot: string, projection = reactFlow()): ArchitectureSiteRequest {
  return { outputRoot, documentation: documentation(), reactFlow: projection };
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("assembles deterministic documentation and local React Flow diagrams", async () => {
  const parent = await temporaryDirectory("wabachi-site-success-");
  const outputRoot = path.join(parent, "site");
  const unrelated = path.join(outputRoot, "keep-me.txt");
  await mkdir(outputRoot);
  await writeFile(unrelated, "preserve", "utf8");

  const result = await buildArchitectureSite(request(outputRoot));

  assert.equal(result.status, "ok");
  assert.equal(result.complete, true);
  assert.deepEqual(result.losses, []);
  assert.match(await readFile(path.join(outputRoot, "index.html"), "utf8"), /React Flow diagrams/u);
  assert.match(await readFile(path.join(outputRoot, "diagrams/index.html"), "utf8"), /data-view-key="structure"/u);
  assert.match(await readFile(path.join(outputRoot, "diagrams/wabachi-react-flow.css"), "utf8"), /wabachi-react-flow/u);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputRoot, "projection-losses.json"), "utf8")), {
    canonVersion: 1,
    documentId: "architecture-document",
    losses: [],
  });
  assert.equal(await readFile(unrelated, "utf8"), "preserve");
});

test("fails closed before writing when the renderer rejects a projection", async () => {
  const parent = await temporaryDirectory("wabachi-site-render-failure-");
  const outputRoot = path.join(parent, "site");
  const projection = reactFlow();
  const invalidProjection = { ...projection, views: [projection.views[0], projection.views[0]] };

  await assert.rejects(() => buildArchitectureSite(request(outputRoot, invalidProjection)), /duplicate view key/u);
  await assert.rejects(() => access(outputRoot), /ENOENT/u);
});

test("fails closed for generation mismatch and unsafe overwrite", async () => {
  const parent = await temporaryDirectory("wabachi-site-safety-");
  const mismatchRoot = path.join(parent, "mismatch");
  await assert.rejects(
    () => buildArchitectureSite(request(mismatchRoot, reactFlow("different-document"))),
    /same Canon generation/u,
  );

  const existingRoot = path.join(parent, "existing");
  await mkdir(existingRoot);
  await writeFile(path.join(existingRoot, "index.html"), "existing", "utf8");
  await assert.rejects(() => buildArchitectureSite(request(existingRoot)), /overwrite/u);
  assert.equal(await readFile(path.join(existingRoot, "index.html"), "utf8"), "existing");
});
