import assert from "node:assert/strict";
import test from "node:test";

import { createCodeIntentContract } from "./code-intent.js";
import { assertValidCodeIntentContract, validateCodeIntentContract } from "./code-intent-validation.js";

const contract = createCodeIntentContract({
  entries: [
    {
      id: "mapped-orders-service",
      ownerId: "element-orders",
      responsibilityIds: ["responsibility-orders"],
      decisionIds: ["decision-orders"],
      invariants: [{ id: "invariant-orders", text: "orders remain durable" }],
    },
  ],
});

test("resolves owner, responsibility, decision, and source-mapping references", () => {
  const result = validateCodeIntentContract(contract, {
    ownerIds: ["element-orders"],
    responsibilityIds: ["responsibility-orders"],
    decisionIds: ["decision-orders"],
    sourceMappingIds: ["mapped-orders-service"],
  });
  assert.deepEqual(result, { valid: true, diagnostics: [] });
});

test("fails closed for unknown Canon and source-mapping references", () => {
  const result = validateCodeIntentContract(contract, {
    ownerIds: ["element-payments"],
    responsibilityIds: [],
    decisionIds: [],
    sourceMappings: [{ canonId: "mapped-payments-service", paths: [], symbols: [], tests: [] }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      "unknown-code-intent-owner",
      "unknown-code-intent-source-mapping",
      "unknown-code-intent-responsibility",
      "unknown-code-intent-decision",
    ],
  );
  assert.throws(
    () => assertValidCodeIntentContract(contract, { ownerIds: [], responsibilityIds: [], decisionIds: [] }),
    /unknown identity/,
  );
});

test("accepts source mappings as records and does not require a matching architecture element", () => {
  const result = validateCodeIntentContract(contract, {
    ownerIds: ["element-orders"],
    responsibilities: [{ id: "responsibility-orders" }],
    decisions: [{ id: "decision-orders" }],
    repositoryMappings: [{ canonId: "mapped-orders-service", paths: [], symbols: [], tests: [] }],
  });
  assert.equal(result.valid, true);
});
