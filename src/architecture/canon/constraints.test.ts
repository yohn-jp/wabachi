import assert from "node:assert/strict";
import test from "node:test";

import { CONSTRAINT_KINDS, createConstraint, createConstraints } from "./constraints.js";

test("represents the typed declarative constraint vocabulary", () => {
  assert.deepEqual(CONSTRAINT_KINDS, [
    "may-depend-on",
    "must-not-depend-on",
    "may-call",
    "must-go-through",
    "single-authority",
  ]);

  assert.deepEqual(createConstraint({ kind: "may-depend-on", source: "checkout", target: "orders" }), {
    kind: "may-depend-on",
    source: "checkout",
    target: "orders",
  });
  assert.deepEqual(createConstraint({ kind: "must-not-depend-on", source: "checkout", target: "billing" }), {
    kind: "must-not-depend-on",
    source: "checkout",
    target: "billing",
  });
  assert.deepEqual(createConstraint({ kind: "may-call", source: "checkout", target: "orders" }), {
    kind: "may-call",
    source: "checkout",
    target: "orders",
  });
  assert.deepEqual(
    createConstraint({ kind: "must-go-through", source: "checkout", target: "payments", through: "gateway" }),
    { kind: "must-go-through", source: "checkout", target: "payments", through: "gateway" },
  );
  assert.deepEqual(createConstraint({ kind: "single-authority", concern: "billing" }), {
    kind: "single-authority",
    concern: "billing",
  });
});

test("normalizes constraint records deterministically by predicate and stable IDs", () => {
  const first = createConstraints([
    { kind: "single-authority", concern: "billing" },
    { kind: "must-go-through", source: "checkout", target: "payments", through: "gateway" },
    { kind: "may-call", source: "checkout", target: "orders" },
    { kind: "may-depend-on", source: "checkout", target: "orders" },
    { kind: "must-not-depend-on", source: "orders", target: "billing" },
  ]);
  const second = createConstraints([...first].reverse());

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((constraint) => constraint.kind),
    ["may-call", "may-depend-on", "must-go-through", "must-not-depend-on", "single-authority"],
  );
  assert.ok(Object.isFrozen(first));
});

test("normalizes IDs and rejects malformed, unsupported, and duplicate predicates", () => {
  const normalized = createConstraint({ kind: "single-authority", concern: "cafe\u0301" });
  assert.equal(normalized.kind, "single-authority");
  assert.equal(normalized.concern, "café");
  assert.throws(
    () => createConstraint({ kind: "unsupported" as never, source: "a", target: "b" } as never),
    /constraint kind is unsupported: unsupported/,
  );
  assert.throws(() => createConstraint({ kind: "may-call", source: "", target: "orders" }), /identity id is malformed/);
  assert.throws(
    () => createConstraint({ kind: "must-go-through", source: "a", target: "b" } as never),
    /must-go-through constraint through must be a string/,
  );
  assert.throws(
    () =>
      createConstraints([
        { kind: "may-depend-on", source: "a", target: "b" },
        { kind: "may-depend-on", source: "a", target: "b" },
      ]),
    /duplicate constraint: may-depend-on -> a -> b/,
  );
});

test("keeps declarations independent from source observation and enforcement", () => {
  const constraint = createConstraint({ kind: "must-not-depend-on", source: "service-a", target: "service-b" });

  assert.deepEqual(Object.keys(constraint), ["kind", "source", "target"]);
  assert.equal("evaluate" in constraint, false);
  assert.equal("observed" in constraint, false);
});
