import assert from "node:assert/strict";
import test from "node:test";

import { BOUNDARY_KINDS, createBoundaries, createBoundary } from "./boundaries.js";

test("represents named semantic, trust, and ownership boundaries", () => {
  assert.deepEqual(BOUNDARY_KINDS, ["semantic", "trust", "ownership"]);

  const boundary = createBoundary({
    id: "customer-data",
    kind: "trust",
    memberIds: ["service-b", "service-a"],
  });

  assert.deepEqual(boundary, {
    id: "customer-data",
    kind: "trust",
    memberIds: ["service-a", "service-b"],
  });
});

test("normalizes equivalent member sets deterministically", () => {
  const first = createBoundary({
    id: "cafe\u0301-boundary",
    kind: "semantic",
    memberIds: ["zeta", "cafe\u0301", "alpha"],
  });
  const second = createBoundary({
    id: "café-boundary",
    kind: "semantic",
    memberIds: ["alpha", "café", "zeta"],
  });

  assert.deepEqual(first, second);
});

test("sorts boundary collections by stable identity", () => {
  const boundaries = createBoundaries([
    { id: "zeta", kind: "ownership", memberIds: ["object-z"] },
    { id: "alpha", kind: "semantic", memberIds: ["object-a"] },
  ]);

  assert.deepEqual(
    boundaries.map((boundary) => boundary.id),
    ["alpha", "zeta"],
  );
});

test("rejects malformed and duplicate boundaries", () => {
  assert.throws(() => createBoundary({ id: " trust", kind: "trust", memberIds: [] }), /identity id is malformed/);
  assert.throws(
    () => createBoundary({ id: "boundary", kind: "network" as never, memberIds: [] }),
    /boundary kind is malformed/,
  );
  assert.throws(
    () => createBoundary({ id: "boundary", kind: "trust", memberIds: ["object-a", "object-a"] }),
    /duplicate boundary member id: object-a/,
  );
  assert.throws(
    () =>
      createBoundaries([
        { id: "boundary", kind: "trust", memberIds: [] },
        { id: "boundary", kind: "ownership", memberIds: [] },
      ]),
    /duplicate boundary id: boundary/,
  );
});

test("does not synthesize unknown member records", () => {
  const boundary = createBoundary({
    id: "declared-only",
    kind: "ownership",
    memberIds: ["not-yet-declared"],
  });

  assert.deepEqual(boundary.memberIds, ["not-yet-declared"]);
  assert.equal(Object.keys(boundary).includes("members"), false);
});
