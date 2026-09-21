import assert from "node:assert/strict";
import test from "node:test";
import { createArchitectureDocument, type ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { digestJson, type JsonValue } from "../digest.js";
import { createRelationshipEntryKey, createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";
import type {
  DesignChangeOperation,
  DesignChangeSetPayload,
  ModifiedSemanticEntry,
  RemovedSemanticEntry,
} from "../contracts.js";
import { applyDesignChange } from "./apply.js";
import { diffArchitectureDocuments } from "./diff.js";

function baseCanon(): ArchitectureDocumentV1 {
  return createArchitectureDocument({
    documentId: "design-change-test",
    root: { id: "architecture" },
    elements: [
      { id: "orders", kind: "service", displayName: "Orders" },
      { id: "legacy", kind: "component", displayName: "Legacy" },
    ],
  });
}

function codeIntent(id: string, text: string) {
  return {
    id,
    ownerId: "architecture",
    invariants: [{ id: `${id}-invariant`, text }],
  };
}

function codeIntentCanon(entries: readonly ReturnType<typeof codeIntent>[]): ArchitectureDocumentV1 {
  return createArchitectureDocument({
    documentId: "code-intent-change-test",
    root: { id: "architecture" },
    repositoryMappings: entries.map(({ id }) => ({ canonId: id, paths: [`src/${id}.ts`] })),
    codeIntents: { schemaVersion: 1, entries },
  });
}

function json(value: unknown): JsonValue {
  return value as JsonValue;
}

function changeFor(
  base: ArchitectureDocumentV1,
  operations: readonly DesignChangeOperation[],
  target: ArchitectureDocumentV1,
): DesignChangeSetPayload {
  return {
    contractVersion: 1,
    changeId: "change-201",
    base: {
      repositoryRevision: "rev-1",
      canonVersion: base.canonVersion,
      canonDigest: digestJson(base),
    },
    target: {
      canonVersion: target.canonVersion,
      operations,
      targetCanonDigest: digestJson(target),
    },
  };
}

function add(entryKey: SemanticEntryKey, value: unknown): DesignChangeOperation {
  return { kind: "added", entryKey, value: json(value) };
}

function modify(entryKey: SemanticEntryKey, before: unknown, after: unknown): ModifiedSemanticEntry {
  return { kind: "modified", entryKey, before: json(before), after: json(after) };
}

function remove(entryKey: SemanticEntryKey, before: unknown): RemovedSemanticEntry {
  return { kind: "removed", entryKey, before: json(before) };
}

test("mixed add/remove/replace is deterministic regardless of operation ordering", () => {
  const base = baseCanon();
  const orders = base.elements.find((element) => element.id === "orders")!;
  const legacy = base.elements.find((element) => element.id === "legacy")!;
  const modified = { ...orders, displayName: "Orders API" };
  const added = { id: "payments", kind: "service" as const, displayName: "Payments" };
  const target = createArchitectureDocument({
    documentId: "design-change-test",
    root: { id: "architecture" },
    elements: [modified, added],
  });
  const operations: DesignChangeOperation[] = [
    add(createSemanticEntryKey({ collection: "element", identity: ["payments"] }), added),
    remove(createSemanticEntryKey({ collection: "element", identity: ["legacy"] }), legacy),
    modify(createSemanticEntryKey({ collection: "element", identity: ["orders"] }), orders, modified),
  ];

  const first = applyDesignChange(changeFor(base, operations, target), base);
  const second = applyDesignChange(changeFor(base, [...operations].reverse(), target), base);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.elements.map((element) => element.id),
    ["orders", "payments"],
  );
});

test("preflight rejects before mismatch, duplicate operation, and identity rename", () => {
  const base = baseCanon();
  const orders = base.elements.find((element) => element.id === "orders")!;
  const ordersKey = createSemanticEntryKey({ collection: "element", identity: ["orders"] });
  const target = baseCanon();

  assert.throws(
    () =>
      applyDesignChange(
        changeFor(base, [modify(ordersKey, { ...orders, displayName: "stale" }, orders)], target),
        base,
      ),
    /before digest mismatch/,
  );

  assert.throws(
    () => applyDesignChange(changeFor(base, [remove(ordersKey, orders), remove(ordersKey, orders)], target), base),
    /duplicate operation target/,
  );

  assert.throws(
    () => applyDesignChange(changeFor(base, [modify(ordersKey, orders, { ...orders, id: "renamed" })], target), base),
    /changes the identity/,
  );
});

test("dangling references fail closed and the base document remains unchanged", () => {
  const base = baseCanon();
  const beforeDigest = digestJson(base);
  const relationship = { source: "orders", target: "missing", kind: "calls" as const };
  const relationshipKey = createRelationshipEntryKey(relationship);
  const operation = add(relationshipKey, relationship);
  const change = changeFor(base, [operation], base);

  assert.throws(() => applyDesignChange(change, base), /proposed Canon is invalid/);
  assert.equal(digestJson(base), beforeDigest);
});

test("mutually referencing newly added entries succeed after one complete validation", () => {
  const base = baseCanon();
  const payments = { id: "payments", kind: "service" as const };
  const billing = { id: "billing", kind: "service" as const };
  const callsBilling = { source: "payments", target: "billing", kind: "calls" as const };
  const callsPayments = { source: "billing", target: "payments", kind: "calls" as const };
  const target = createArchitectureDocument({
    documentId: "design-change-test",
    root: { id: "architecture" },
    elements: [...base.elements, payments, billing],
    relationships: [callsBilling, callsPayments],
  });
  const operations = [
    add(createRelationshipEntryKey(callsPayments), callsPayments),
    add(createSemanticEntryKey({ collection: "element", identity: ["billing"] }), billing),
    add(createRelationshipEntryKey(callsBilling), callsBilling),
    add(createSemanticEntryKey({ collection: "element", identity: ["payments"] }), payments),
  ];

  const result = applyDesignChange(changeFor(base, operations, target), base);
  assert.deepEqual(result, target);
});

test("production diff and apply round-trip added, modified, and removed Code Intent entries", () => {
  const base = codeIntentCanon([codeIntent("intent-keep", "the old rule"), codeIntent("intent-remove", "remove")]);
  const target = codeIntentCanon([codeIntent("intent-keep", "the amended rule"), codeIntent("intent-add", "add")]);
  const operations = diffArchitectureDocuments(base, target);

  assert.deepEqual(applyDesignChange(changeFor(base, operations, target), base), target);
  assert.ok(operations.some((operation) => operation.entryKey === '["code-intent","intent-add"]'));
  assert.ok(operations.some((operation) => operation.entryKey === '["code-intent","intent-keep"]'));
  assert.ok(operations.some((operation) => operation.entryKey === '["code-intent","intent-remove"]'));
});

test("Code Intent identity and malformed operations fail closed", () => {
  const base = codeIntentCanon([codeIntent("intent", "durable")]);
  const intentKey = createSemanticEntryKey({ collection: "code-intent", identity: ["intent"] });
  const target = codeIntentCanon([codeIntent("intent", "changed")]);
  const current = base.codeIntents!.entries[0];

  assert.throws(
    () => applyDesignChange(changeFor(base, [modify(intentKey, current, { ...current, id: "renamed" })], target), base),
    /changes the identity/,
  );
  assert.throws(
    () =>
      applyDesignChange(
        changeFor(
          base,
          [add(createSemanticEntryKey({ collection: "code-intent", identity: ["new"] }), { id: "new" })],
          target,
        ),
        base,
      ),
    /code intent ownerId must be a string|proposed Canon is invalid/,
  );
});

test("removing the last Code Intent preserves an absent optional section", () => {
  const base = codeIntentCanon([codeIntent("intent", "remove")]);
  const target = createArchitectureDocument({
    documentId: "code-intent-change-test",
    root: { id: "architecture" },
  });
  const operations = diffArchitectureDocuments(base, target);

  assert.deepEqual(applyDesignChange(changeFor(base, operations, target), base), target);
  assert.equal(applyDesignChange(changeFor(base, operations, target), base).codeIntents, undefined);
});

test("production diff and apply round-trip every required semantic identity", () => {
  const base = createArchitectureDocument({
    documentId: "design-change-round-trip",
    root: { id: "architecture" },
  });
  const relationship = { source: "orders", target: "billing", kind: "calls" as const };
  const target = createArchitectureDocument({
    documentId: "design-change-round-trip",
    root: { id: "architecture" },
    elements: [
      { id: "billing", kind: "service" },
      { id: "orders", kind: "service" },
    ],
    interfaces: [{ id: "orders-api", owner: "orders", protocol: "https" }],
    relationships: [relationship],
    authority: {
      authority: [{ concern: "orders", owner: "billing" }],
      ownership: [{ resource: "billing", owner: "orders" }],
    },
    constraints: [
      { kind: "may-depend-on", source: "orders", target: "billing" },
      { kind: "must-not-depend-on", source: "billing", target: "orders" },
      { kind: "may-call", source: "orders", target: "billing" },
      { kind: "must-go-through", source: "orders", target: "billing", through: "orders" },
      { kind: "single-authority", concern: "orders" },
    ],
    flows: [
      {
        id: "checkout",
        steps: [
          { interfaceId: "orders-api", operation: "create" },
          { interfaceId: "orders-api", operation: "confirm" },
        ],
      },
    ],
    deployment: {
      runtimeEnvironments: [{ id: "production" }],
      deploymentNodes: [{ id: "orders-node", environmentId: "production" }],
      deploymentInstances: [{ id: "orders-instance", nodeId: "orders-node" }],
      infrastructureReferences: [{ id: "cluster", reference: "k8s/prod" }],
      mappings: [{ softwareElementId: "orders", deploymentInstanceId: "orders-instance" }],
    },
    repositoryMappings: [{ canonId: "orders", paths: ["src/orders.ts"] }],
    decisions: {
      decisions: [
        {
          id: "decide-orders",
          title: "Orders owns billing calls",
          status: "accepted",
          type: "architecture",
          rationale: "The orders service is authoritative.",
          targetIds: ["orders"],
          referenceIds: ["adr-orders"],
        },
      ],
      references: [{ id: "adr-orders", label: "Orders ADR", uri: "https://example.invalid/orders" }],
      referenceAttachments: [{ targetId: "orders", referenceIds: ["adr-orders"] }],
    },
  });

  const operations = diffArchitectureDocuments(base, target);
  const result = applyDesignChange(changeFor(base, operations, target), base);

  assert.deepEqual(result, target);
  assert.ok(operations.some((operation) => operation.entryKey.includes("relationship")));
  assert.ok(operations.some((operation) => operation.entryKey.includes("authority")));
  assert.ok(operations.some((operation) => operation.entryKey.includes("constraint")));
  assert.ok(operations.some((operation) => operation.entryKey.includes("deployment-mapping")));
  assert.ok(operations.some((operation) => operation.entryKey.includes("reference-attachment")));
  assert.ok(operations.some((operation) => operation.entryKey.includes('"flow"')));
});
