import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseCanonicalArchitectureDocument } from "./canon/codec.js";
import { projectArchitectureDocument } from "./documentation/project.js";
import { projectArchitectureDocumentToStructurizr } from "./projection/structurizr.js";

const canonPath = path.resolve("architecture/wabachi.json");

test("Wabachi's checked-in architecture Canon dogfoods both production projections", async () => {
  const document = parseCanonicalArchitectureDocument(await readFile(canonPath, "utf8"));
  const documentation = projectArchitectureDocument(document);
  const structurizr = projectArchitectureDocumentToStructurizr(document);

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
  assert.equal(structurizr.documentId, document.documentId);
  assert.match(structurizr.dsl, /workspace "wabachi-architecture-v1"/u);
  assert.match(structurizr.dsl, /dynamic/u);
  assert.match(structurizr.dsl, /deployment/u);
});
