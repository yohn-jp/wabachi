import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../canon/document.js";
import { projectArchitectureDocumentToReactFlow } from "./react-flow.js";

function commerceDocument(reverse = false) {
  const ordered = <T>(values: readonly T[]): readonly T[] => (reverse ? [...values].reverse() : values);

  return createArchitectureDocument({
    documentId: "commerce",
    root: { id: "architecture" },
    elements: ordered([
      { id: "orders", kind: "service" as const, displayName: "Orders" },
      { id: "orders-component", kind: "component" as const, parentId: "orders" },
      { id: "payments", kind: "service" as const, displayName: "Payments" },
    ]),
    relationships: ordered([{ source: "orders", target: "payments", kind: "calls" as const }]),
    flows: [{ id: "checkout", steps: [] }],
    views: ordered([
      {
        key: "structure",
        kind: "structural" as const,
        scope: {
          include: [
            { kind: "element" as const, id: "orders" },
            { kind: "element" as const, id: "orders-component" },
            { kind: "element" as const, id: "payments" },
          ],
        },
        root: { kind: "element" as const, id: "orders" },
        title: "Commerce structure",
        presentation: { layout: "auto", direction: "lr" },
      },
      {
        key: "checkout-flow",
        kind: "dynamic" as const,
        scope: { include: [{ kind: "flow" as const, id: "checkout" }] },
      },
    ]),
  });
}

test("projects structural views into deterministic React Flow nodes, edges, and ELK layout", async () => {
  const first = await projectArchitectureDocumentToReactFlow(commerceDocument());
  const second = await projectArchitectureDocumentToReactFlow(commerceDocument(true));

  assert.deepEqual(first, second);
  const structure = first.views.find((view) => view.key === "structure");
  assert.ok(structure);
  assert.equal(structure.nodes.length, 3);
  assert.equal(structure.edges.length, 1);
  assert.deepEqual(
    structure.nodes.map(({ data, parentId }) => ({ id: data.canonId, parentId: parentId === undefined })),
    [
      { id: "orders", parentId: true },
      { id: "orders-component", parentId: false },
      { id: "payments", parentId: true },
    ],
  );

  const child = structure.nodes.find(({ data }) => data.canonId === "orders-component");
  const parent = structure.nodes.find(({ data }) => data.canonId === "orders");
  assert.equal(child?.parentId, parent?.id);
  assert.equal(child?.extent, "parent");

  const [edge] = structure.edges;
  assert.equal(edge.data.canonSourceId, "orders");
  assert.equal(edge.data.canonTargetId, "payments");
  assert.equal(edge.source, parent?.id);
  assert.equal(edge.target, structure.nodes.find(({ data }) => data.canonId === "payments")?.id);
  assert.ok(edge.data.sections.length > 0);
  assert.equal(structure.layout.direction, "RIGHT");
  assert.equal(structure.losses.length, 0);
  assert.ok(structure.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y)));
});

test("reports unsupported view semantics and containment loss explicitly", async () => {
  const document = createArchitectureDocument({
    documentId: "losses",
    root: { id: "architecture" },
    elements: [
      { id: "service", kind: "service" },
      { id: "component", kind: "component", parentId: "service" },
    ],
    flows: [{ id: "flow", steps: [] }],
    views: [
      {
        key: "partial",
        kind: "structural",
        scope: {
          include: [
            { kind: "element", id: "component" },
            { kind: "flow", id: "flow" },
          ],
        },
        presentation: { layout: "manual", direction: "diagonal", grouping: "domain" },
      },
      {
        key: "dynamic",
        kind: "dynamic",
        scope: { include: [{ kind: "flow", id: "flow" }] },
      },
    ],
  });

  const projection = await projectArchitectureDocumentToReactFlow(document);
  assert.deepEqual(
    projection.losses.map(({ code, path }) => ({ code, path })),
    [
      { code: "unsupported-containment", path: "elements[0].parentId" },
      { code: "unsupported-view-kind", path: "views[0]" },
      { code: "unsupported-presentation", path: "views[1].presentation.direction" },
      { code: "unsupported-presentation", path: "views[1].presentation.grouping" },
      { code: "unsupported-presentation", path: "views[1].presentation.layout" },
      { code: "unsupported-view-reference", path: "views[1].scope.include[1]" },
    ],
  );
  assert.deepEqual(projection.views.find((view) => view.key === "dynamic")?.nodes, []);
});

test("does not project an Architecture Canon that fails complete-document validation", async () => {
  const invalid = createArchitectureDocument({
    documentId: "invalid",
    root: { id: "architecture" },
    elements: [{ id: "service", kind: "service" }],
    repositoryMappings: [{ canonId: "missing", paths: ["src/missing.ts"] }],
  });

  await assert.rejects(
    projectArchitectureDocumentToReactFlow(invalid),
    /cannot project invalid Architecture Canon: invalid-repository-mapping at repositoryMappings\[0\]/,
  );
});
