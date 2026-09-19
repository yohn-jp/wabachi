import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../canon/document.js";
import { projectArchitectureDocumentToStructurizr } from "./structurizr.js";

function completeDocument(reverse = false) {
  const ordered = <T>(values: readonly T[]): readonly T[] => (reverse ? [...values].reverse() : values);

  const document = createArchitectureDocument({
    documentId: "commerce",
    root: { id: "architecture" },
    elements: ordered([
      {
        id: "customer",
        kind: "actor" as const,
        displayName: "Customer",
        technology: "Browser",
        tags: ordered(["external", "person"]),
        properties: reverse ? { region: "global", channel: "web" } : { channel: "web", region: "global" },
      },
      { id: "orders", kind: "service" as const },
      { id: "orders-component", kind: "component" as const, parentId: "orders" },
      { id: "payments", kind: "service" as const },
    ]),
    interfaces: [{ id: "orders-api", owner: "orders", protocol: "https", technology: "JSON" }],
    relationships: [{ source: "orders", target: "payments", kind: "calls" as const }],
    responsibilities: {
      responsibilities: [{ id: "orders-owner", target: { kind: "object" as const, id: "orders" }, concern: "orders" }],
    },
    authority: {
      authority: [{ concern: "orders", owner: "orders" }],
      ownership: [{ resource: "payments", owner: "payments" }],
    },
    boundaries: [{ id: "commerce-boundary", kind: "semantic", memberIds: ["orders", "payments"] }],
    constraints: [{ kind: "must-not-depend-on" as const, source: "payments", target: "orders" }],
    flows: [
      {
        id: "checkout",
        steps: [{ interfaceId: "orders-api", operation: "submit", information: "order" }],
      },
    ],
    deployment: {
      runtimeEnvironments: [{ id: "production", displayName: "Production" }],
      deploymentNodes: [{ id: "orders-node", environmentId: "production" }],
      deploymentInstances: [{ id: "orders-instance", nodeId: "orders-node" }],
      infrastructureReferences: [{ id: "cluster", reference: "cluster/production" }],
      mappings: [{ softwareElementId: "orders", deploymentInstanceId: "orders-instance" }],
    },
    repositoryMappings: [{ canonId: "orders", paths: ["src/orders.ts"] }],
    decisions: {
      decisions: [
        {
          id: "orders-decision",
          title: "Use orders service",
          status: "accepted",
          type: "architecture",
          rationale: "The service owns order processing.",
          targetIds: ["orders"],
          referenceIds: ["design"],
        },
      ],
      references: [{ id: "design", label: "Design", uri: "https://example.test/design" }],
      referenceAttachments: [{ targetId: "orders", referenceIds: ["design"] }],
    },
    views: [
      {
        key: "structure",
        kind: "structural",
        scope: { include: [{ kind: "element", id: "orders" }] },
        title: "Structure",
        presentation: { layout: "auto", direction: "lr" },
      },
      {
        key: "checkout-flow",
        kind: "dynamic",
        scope: { include: [{ kind: "flow", id: "checkout" }] },
      },
      {
        key: "production",
        kind: "deployment",
        scope: {
          include: [
            { kind: "runtime-environment", id: "production" },
            { kind: "deployment-node", id: "orders-node" },
          ],
        },
      },
    ],
  });

  return {
    ...document,
    relationships: [{ ...document.relationships[0], interfaceId: "orders-api" }],
  } as unknown as typeof document;
}

test("projects validated Canon, hierarchy, relationships, flows, deployment, and declared views", () => {
  const projection = projectArchitectureDocumentToStructurizr(completeDocument());

  assert.match(projection.dsl, /workspace "commerce"/);
  assert.match(projection.dsl, /canon_element_customer = person "Customer"/);
  assert.match(projection.dsl, /tags "CanonElement,CanonKind-actor,external,person"/);
  assert.match(projection.dsl, /"canon\.technology" "Browser"/);
  assert.match(projection.dsl, /"channel" "web"/);
  assert.match(projection.dsl, /canon_element_orders = softwareSystem "orders"/);
  assert.match(projection.dsl, /canon_element_orders_x2d_component = container/);
  assert.match(projection.dsl, /canon_element_orders -> canon_element_payments/);
  assert.match(projection.dsl, /dynamic \* "canon_view_checkout_x2d_flow"/);
  assert.match(projection.dsl, /deployment \* canon_runtime_x2d_environment_production "canon_view_production"/);
  assert.match(projection.dsl, /softwareSystemInstance canon_element_orders/);

  assert.deepEqual(projection.viewMappings, [
    { canonKey: "checkout-flow", kind: "dynamic", structurizrKey: "canon_view_checkout_x2d_flow" },
    { canonKey: "production", kind: "deployment", structurizrKey: "canon_view_production" },
    { canonKey: "structure", kind: "structural", structurizrKey: "canon_view_structure" },
  ]);
  assert.deepEqual(
    projection.identityMappings.find((mapping) => mapping.namespace === "element" && mapping.canonId === "orders"),
    { canonId: "orders", namespace: "element", structurizrId: "canon_element_orders" },
  );
  assert.equal(
    projection.losses.some(({ code }) => code === "unsupported-interface"),
    false,
  );
  assert.equal(
    projection.losses.some(({ code }) => code === "unsupported-flow"),
    false,
  );
  assert.equal(
    projection.losses.some(({ code }) => code === "unsupported-deployment-mapping"),
    false,
  );
});

test("reports element annotations that Structurizr cannot represent losslessly", () => {
  const document = createArchitectureDocument({
    documentId: "annotations",
    root: { id: "architecture" },
    elements: [
      {
        id: "customer",
        kind: "actor",
        technology: "Browser",
        tags: ["comma,tag"],
        properties: { "canon.technology": "custom" },
      },
    ],
  });
  const projection = projectArchitectureDocumentToStructurizr(document);
  assert.deepEqual(
    projection.losses.map(({ code, path }) => ({ code, path })),
    [
      { code: "unsupported-element-annotation", path: "elements[0].tags[0]" },
      { code: "unsupported-element-annotation", path: "elements[0].technology" },
    ],
  );
});

test("projects equivalent Canon input deterministically and reports unsupported semantics explicitly", () => {
  const first = projectArchitectureDocumentToStructurizr(completeDocument());
  const second = projectArchitectureDocumentToStructurizr(completeDocument(true));

  assert.deepEqual(first, second);
  assert.deepEqual(
    new Set(first.losses.map(({ code }) => code)),
    new Set([
      "unsupported-authority",
      "unsupported-ownership",
      "unsupported-boundary",
      "unsupported-responsibility",
      "unsupported-constraint",
      "unsupported-repository-mapping",
      "unsupported-decision",
      "unsupported-reference",
      "unsupported-reference-attachment",
      "unsupported-infrastructure-reference",
    ]),
  );
  assert.equal(
    first.losses.every(({ path, message, canonIds }) => path.length > 0 && message.length > 0 && canonIds.length > 0),
    true,
  );
});

test("refuses a Canon document that has not passed complete-document validation", () => {
  const invalid = createArchitectureDocument({
    documentId: "commerce",
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service" }],
    repositoryMappings: [{ canonId: "missing", paths: ["src/missing.ts"] }],
  });

  assert.throws(() => projectArchitectureDocumentToStructurizr(invalid), /cannot project invalid Architecture Canon/);
});
