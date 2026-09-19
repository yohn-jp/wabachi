import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeArchitectureDocument,
  encodeCanonicalJson,
  parseCanonicalArchitectureDocument,
  serializeCanonicalArchitectureDocument,
} from "./codec.js";
import { createArchitectureDocument } from "./document.js";

function createCompleteDocument() {
  return createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: [
      { id: "payments", kind: "service" },
      {
        id: "customer",
        kind: "actor",
        displayName: "Customer",
        technology: "Browser",
        tags: ["external", "person"],
        properties: { region: "global", channel: "web" },
      },
      { id: "orders", kind: "service" },
    ],
    interfaces: [{ id: "orders-api", owner: "orders", protocol: "https" }],
    relationships: [{ source: "orders", target: "payments", kind: "calls" }],
    responsibilities: {
      responsibilities: [{ id: "orders-owner", target: { kind: "object", id: "orders" }, concern: "orders" }],
    },
    authority: {
      authority: [{ concern: "orders", owner: "orders" }],
      ownership: [{ resource: "payments", owner: "payments" }],
    },
    boundaries: [{ id: "commerce", kind: "semantic", memberIds: ["payments", "orders"] }],
    constraints: [{ kind: "may-call", source: "orders", target: "payments" }],
    flows: [
      {
        id: "checkout",
        steps: [
          { interfaceId: "orders-api", operation: "create" },
          { interfaceId: "orders-api", information: "payment request" },
        ],
      },
    ],
    deployment: {
      runtimeEnvironments: [{ id: "production", displayName: "Production" }],
      deploymentNodes: [{ id: "orders-node", environmentId: "production" }],
      deploymentInstances: [{ id: "orders-instance", nodeId: "orders-node" }],
      infrastructureReferences: [{ id: "cluster", reference: "cluster/production" }],
      mappings: [{ softwareElementId: "orders", deploymentInstanceId: "orders-instance" }],
    },
    repositoryMappings: [
      {
        canonId: "orders",
        paths: ["src/orders.ts"],
        symbols: [{ path: "src/orders.ts", symbol: "OrdersService", exportName: "OrdersService" }],
        tests: [{ path: "src/orders.test.ts", selector: "checkout" }],
      },
    ],
    decisions: {
      decisions: [
        {
          id: "orders-decision",
          title: "Use the orders service",
          status: "accepted",
          type: "architecture",
          rationale: "The service owns order processing.",
          targetIds: ["orders"],
          referenceIds: ["orders-design"],
        },
      ],
      references: [{ id: "orders-design", label: "Design", uri: "https://example.test/orders" }],
      referenceAttachments: [{ targetId: "orders", referenceIds: ["orders-design"] }],
    },
    views: [
      {
        key: "checkout-flow",
        kind: "dynamic",
        scope: {
          include: [{ kind: "flow", id: "checkout" }],
        },
        root: { kind: "element", id: "orders" },
        description: "Checkout flow",
        order: 1,
      },
    ],
  });
}

function parsed(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

test("decodes and round-trips a complete validated v1 document", () => {
  const document = createCompleteDocument();
  const encoded = serializeCanonicalArchitectureDocument(document);
  const decoded = decodeArchitectureDocument(parsed(encoded));

  assert.deepEqual(decoded, document);
  assert.deepEqual((parsed(encoded).views as Array<Record<string, unknown>>)[0], {
    key: "checkout-flow",
    kind: "dynamic",
    scope: { include: [{ kind: "flow", id: "checkout" }], exclude: [] },
    root: { kind: "element", id: "orders" },
    order: 1,
    description: "Checkout flow",
  });
  assert.equal(parseCanonicalArchitectureDocument(encoded).globalIdentityRegistry.entries.length, 10);
  assert.equal(Object.keys(parsed(encoded)).at(-1), "globalIdentityRegistry");
});

test("canonicalizes equivalent collection order while preserving flow step order", () => {
  const document = createCompleteDocument();
  const value = parsed(serializeCanonicalArchitectureDocument(document));
  const elements = value.elements as Array<Record<string, unknown>>;
  const views = value.views as Array<Record<string, unknown>>;
  const flow = value.flows as Array<Record<string, unknown>>;

  elements.reverse();
  views.reverse();
  const boundary = (value.boundaries as Array<Record<string, unknown>>)[0];
  if (boundary !== undefined && Array.isArray(boundary.memberIds)) boundary.memberIds.reverse();

  const canonical = serializeCanonicalArchitectureDocument(decodeArchitectureDocument(value));
  const expected = serializeCanonicalArchitectureDocument(document);
  assert.equal(canonical, expected);

  const semanticOrder = parsed(expected);
  const semanticSteps = (semanticOrder.flows as Array<Record<string, unknown>>)[0]?.steps as Array<
    Record<string, unknown>
  >;
  semanticSteps.reverse();
  const decoded = decodeArchitectureDocument(semanticOrder);
  assert.deepEqual(decoded.flows[0]?.steps, Array.from(document.flows[0]?.steps ?? []).reverse());
});

test("fails closed for unsupported versions, unknown fields, invalid references, and forged registries", () => {
  const value = parsed(encodeCanonicalJson(createCompleteDocument()));

  assert.throws(() => decodeArchitectureDocument({ ...value, canonVersion: 2 }), /unsupported/);
  assert.throws(() => decodeArchitectureDocument({ ...value, extra: true }), /unknown field/);

  const invalid = structuredClone(value);
  ((invalid.views as Array<Record<string, unknown>>)[0]?.scope as Record<string, unknown>).include = [
    { kind: "element", id: "missing" },
  ];
  assert.throws(() => decodeArchitectureDocument(invalid), /failed validation/);

  const forged = structuredClone(value);
  (forged.globalIdentityRegistry as Record<string, unknown>).entries = [];
  assert.throws(() => decodeArchitectureDocument(forged), /failed validation|global identity registry/);
});

test("rejects malformed JSON text at the codec boundary", () => {
  assert.throws(() => parseCanonicalArchitectureDocument("{}"), /missing required field/);
  assert.throws(() => parseCanonicalArchitectureDocument("not json"), /invalid canonical/);
});

test("strictly decodes actor annotations and rejects malformed annotation fields", () => {
  const value = parsed(encodeCanonicalJson(createCompleteDocument()));
  const decoded = decodeArchitectureDocument(value);
  assert.deepEqual(
    decoded.elements.find(({ id }) => id === "customer"),
    {
      id: "customer",
      kind: "actor",
      displayName: "Customer",
      technology: "Browser",
      tags: ["external", "person"],
      properties: { channel: "web", region: "global" },
    },
  );

  const malformedTags = structuredClone(value);
  (malformedTags.elements as Array<Record<string, unknown>>)[0].tags = ["valid", 1];
  assert.throws(() => decodeArchitectureDocument(malformedTags), /element tags must contain strings/);

  const malformedProperties = structuredClone(value);
  (malformedProperties.elements as Array<Record<string, unknown>>)[0].properties = { key: 1 };
  assert.throws(() => decodeArchitectureDocument(malformedProperties), /string values/);
});
