import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseCanonicalArchitectureDocument } from "./canon/codec.js";
import { projectArchitectureDocument } from "./documentation/project.js";
import { buildArchitectureSite } from "./documentation/site.js";
import { projectArchitectureDocumentToReactFlow } from "./projection/react-flow.js";
import { projectArchitectureDocumentToStructurizr } from "./projection/structurizr.js";

const canonPath = path.resolve("architecture/wabachi.json");

test("Wabachi's checked-in architecture Canon dogfoods the production React Flow site", async () => {
  const document = parseCanonicalArchitectureDocument(await readFile(canonPath, "utf8"));
  const documentation = projectArchitectureDocument(document);
  const reactFlow = await projectArchitectureDocumentToReactFlow(document);
  const structurizr = projectArchitectureDocumentToStructurizr(document);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-architecture-dogfood-"));

  try {
    assert.equal(document.canonVersion, 1);
    assert.equal(document.root.id, "wabachi");
    assert.ok(document.elements.some((element) => element.id === "architecture-documentation"));
    assert.ok(document.flows.some((flow) => flow.id === "architecture-render-flow"));
    assert.deepEqual(
      document.views.map((view) => view.kind),
      ["structural", "dynamic", "dynamic", "deployment"],
    );
    assert.equal(
      document.repositoryMappings.some((mapping) => mapping.canonId === "canon-service"),
      true,
    );
    assert.equal(document.decisions.decisions.length, 3);
    assert.equal(document.decisions.references.length, 4);
    assert.equal(document.decisions.referenceAttachments.length, 3);

    assert.equal(documentation.documentId, document.documentId);
    assert.equal(reactFlow.documentId, document.documentId);
    assert.ok(reactFlow.views.some((view) => view.nodes.length > 0));
    assert.equal(structurizr.documentId, document.documentId);
    assert.match(structurizr.dsl, /workspace "wabachi-architecture-v1"/u);

    const result = await buildArchitectureSite({ outputRoot, documentation, reactFlow });
    assert.equal(result.complete, true);
    assert.match(await readFile(path.join(outputRoot, "diagrams/index.html"), "utf8"), /react-flow-view/u);
    assert.match(
      await readFile(path.join(outputRoot, "diagrams/wabachi-react-flow.css"), "utf8"),
      /wabachi-react-flow/u,
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
