import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { architectureCanonDigest, createDesignChangeSet, diffArchitectureDocuments } from "./diff.js";

const REVISION = "0123456789012345678901234567890123456789";

function canon(overrides: Record<string, unknown> = {}) {
  return createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: [
      { id: "orders", kind: "service" },
      { id: "billing", kind: "service" },
    ],
    interfaces: [{ id: "orders-api", owner: "orders", protocol: "https" }],
    authority: { authority: [{ concern: "orders", owner: "orders" }] },
    flows: [{ id: "checkout", steps: [{ interfaceId: "orders-api", operation: "create" }] }],
    ...overrides,
  });
}

function change(base: ReturnType<typeof canon>, target: ReturnType<typeof canon>) {
  return createDesignChangeSet({
    changeId: "change-1",
    base: { repositoryRevision: REVISION, canonVersion: 1, canonDigest: architectureCanonDigest(base) },
    baseCanon: base,
    targetCanon: target,
  });
}

test("diffs ordered flow semantics and authority-owner changes", () => {
  const base = canon();
  const target = canon({
    authority: { authority: [{ concern: "orders", owner: "billing" }] },
    flows: [{ id: "checkout", steps: [{ interfaceId: "orders-api", operation: "update" }] }],
  });
  const operations = diffArchitectureDocuments(base, target);

  assert.equal(operations.length, 3);
  assert.equal(operations.filter((operation) => operation.entryKey.includes('"authority"')).length, 2);
  assert.ok(operations.some((operation) => operation.kind === "modified" && operation.entryKey.includes("flow")));
  assert.equal(change(base, target).target.operations.length, 3);
});

test("formatting and collection order differences produce no operations", () => {
  const base = canon({
    elements: [
      { id: "orders", kind: "service", tags: ["a", "b"] },
      { id: "payments", kind: "service" },
    ],
  });
  const equivalent = canon({
    elements: [
      { id: "payments", kind: "service" },
      { id: "orders", kind: "service", tags: ["a", "b"] },
    ],
  });
  assert.deepEqual(diffArchitectureDocuments(base, equivalent), []);
});
