import assert from "node:assert/strict";
import test from "node:test";

import { createFlow, createFlows } from "./flows.js";

test("represents ordered request/effect interactions with canonical references", () => {
  const flow = createFlow({
    id: "checkout",
    steps: [
      { relationshipId: "checkout-orders", interfaceId: "orders-api", operation: "submit" },
      { relationshipId: "orders-payments", information: "payment authorization" },
    ],
  });

  assert.deepEqual(flow, {
    id: "checkout",
    steps: [
      { relationshipId: "checkout-orders", interfaceId: "orders-api", operation: "submit" },
      { relationshipId: "orders-payments", information: "payment authorization" },
    ],
  });
  assert.ok(Object.isFrozen(flow));
  assert.ok(Object.isFrozen(flow.steps));
  assert.ok(Object.isFrozen(flow.steps[0]));
});

test("normalizes equivalent flow collections without changing step order", () => {
  const first = createFlows([
    {
      id: "zeta",
      steps: [
        { interfaceId: "first", operation: "request" },
        { relationshipId: "second", information: "effect" },
      ],
    },
    { id: "alpha", steps: [{ relationshipId: "alpha-relation" }] },
  ]);
  const second = createFlows([
    { id: "alpha", steps: [{ relationshipId: "alpha-relation" }] },
    {
      id: "zeta",
      steps: [
        { interfaceId: "first", operation: "request" },
        { relationshipId: "second", information: "effect" },
      ],
    },
  ]);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((flow) => flow.id),
    ["alpha", "zeta"],
  );
  assert.deepEqual(first[1]?.steps, [
    { interfaceId: "first", operation: "request" },
    { relationshipId: "second", information: "effect" },
  ]);
  assert.deepEqual(second[1]?.steps, [
    { interfaceId: "first", operation: "request" },
    { relationshipId: "second", information: "effect" },
  ]);
});

test("keeps references opaque and rejects malformed or duplicate flow records", () => {
  assert.doesNotThrow(() => createFlows([{ id: "flow", steps: [{ relationshipId: "not-yet-resolved" }] }]));
  assert.throws(
    () =>
      createFlows([
        { id: "flow", steps: [{ relationshipId: "a" }] },
        { id: "flow", steps: [] },
      ]),
    /duplicate flow id: flow/,
  );
  assert.throws(() => createFlow({ id: "flow", steps: [{}] }), /flow step must reference/);
  assert.throws(
    () => createFlow({ id: "flow", steps: [{ relationshipId: " malformed" }] }),
    /flow step relationshipId/,
  );
  assert.throws(
    () => createFlow({ id: "flow", steps: [{ interfaceId: "a", operation: "   " }] }),
    /flow step operation/,
  );
});
