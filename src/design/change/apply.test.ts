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
