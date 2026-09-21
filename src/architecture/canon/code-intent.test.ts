import assert from "node:assert/strict";
import test from "node:test";

import {
  CODE_INTENT_VERIFICATION_MODES,
  createCodeIntent,
  createCodeIntentContract,
  serializeCodeIntentContract,
} from "./code-intent.js";

test("attaches intent to a mapped source identity without creating an architecture element", () => {
  const intent = createCodeIntent({
    id: "mapped-orders-service",
    ownerId: "architecture",
    responsibilityIds: ["responsibility-orders"],
    decisionIds: ["decision-orders"],
    invariants: [{ id: "invariant-orders", text: "orders remain durable" }],
    prohibitions: [{ id: "prohibition-orders", text: "must not bypass the order boundary" }],
    verificationObligations: [
      { id: "verify-orders", statementId: "invariant-orders", mode: "machine", predicate: "orders-durable" },
    ],
  });

  assert.equal(intent.id, "mapped-orders-service");
  assert.equal("kind" in intent, false);
  assert.deepEqual(CODE_INTENT_VERIFICATION_MODES, ["machine", "review"]);
});

test("sorts set-like references and contract entries while preserving statement order", () => {
  const first = createCodeIntentContract({
    entries: [
      {
        id: "intent-z",
        ownerId: "owner-z",
        responsibilityIds: ["responsibility-z", "responsibility-a"],
        decisionIds: ["decision-z", "decision-a"],
        invariants: [
          { id: "step-b", text: "second" },
          { id: "step-a", text: "first" },
        ],
      },
      { id: "intent-a", ownerId: "owner-a" },
    ],
  });
  const second = createCodeIntentContract({
    entries: [
      { id: "intent-a", ownerId: "owner-a" },
      {
        id: "intent-z",
        ownerId: "owner-z",
        responsibilityIds: ["responsibility-a", "responsibility-z"],
        decisionIds: ["decision-a", "decision-z"],
        invariants: [
          { id: "step-b", text: "second" },
          { id: "step-a", text: "first" },
        ],
      },
    ],
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.entries[1]?.invariants.map((statement) => statement.id),
    ["step-b", "step-a"],
  );
  assert.equal(serializeCodeIntentContract(first), serializeCodeIntentContract(second));
});

test("rejects duplicate identities, statement IDs, and unsupported verification modes", () => {
  assert.throws(
    () => createCodeIntent({ id: "intent", ownerId: "owner", responsibilityIds: ["same", "same"] }),
    /duplicate code intent responsibility id/,
  );
  assert.throws(
    () =>
      createCodeIntent({
        id: "intent",
        ownerId: "owner",
        invariants: [{ id: "same", text: "one" }],
        prohibitions: [{ id: "same", text: "two" }],
      }),
    /duplicate code intent statement id/,
  );
  assert.throws(
    () =>
      createCodeIntent({
        id: "intent",
        ownerId: "owner",
        invariants: [{ id: "statement", text: "must hold" }],
        verificationObligations: [
          { id: "check", statementId: "statement", mode: "unsupported" as never, predicate: "check" },
        ],
      }),
    /mode is unsupported/,
  );
});

test("does not accept responsibility prose as a competing Code Intent field", () => {
  assert.throws(
    () => createCodeIntent({ id: "intent", ownerId: "owner", responsibility: "duplicated prose" } as never),
    /unsupported field: responsibility/,
  );
});
