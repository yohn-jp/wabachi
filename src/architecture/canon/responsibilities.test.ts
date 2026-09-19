import assert from "node:assert/strict";
import test from "node:test";

import { createResponsibility, createResponsibilitySet, normalizeResponsibilityId } from "./responsibilities.js";

test("creates machine-readable responsibility facts for stable Canon targets", () => {
  const set = createResponsibilitySet({
    responsibilities: [
      {
        id: "responsibility-z",
        target: { kind: "object", id: "orders", displayName: "Orders" },
        concern: "fulfil orders",
      },
      {
        id: "responsibility-a",
        target: { kind: "architecture", id: "platform" },
        concern: "provide the platform boundary",
      },
    ],
  });

  assert.deepEqual(set.responsibilities, [
    {
      kind: "responsibility",
      id: "responsibility-a",
      target: { kind: "architecture", id: "platform" },
      concern: "provide the platform boundary",
    },
    {
      kind: "responsibility",
      id: "responsibility-z",
      target: { kind: "object", id: "orders" },
      concern: "fulfil orders",
    },
  ]);
});

test("normalizes responsibility identities and equivalent facts deterministically", () => {
  assert.equal(normalizeResponsibilityId("cafe\u0301"), "café");

  const first = createResponsibilitySet({
    responsibilities: [
      {
        id: "resp-1",
        target: { kind: "object", id: "service\u0301" },
        concern: "serve café",
        displayName: "Orders",
      },
    ],
  });
  const second = createResponsibilitySet({
    responsibilities: [
      {
        id: "resp-1",
        target: { kind: "object", id: "servicé" },
        concern: "serve cafe\u0301",
        displayName: "Order Processing",
      },
    ],
  });

  assert.deepEqual(first, second);
});

test("display text does not become responsibility or target identity", () => {
  const first = createResponsibility({
    id: "resp-1",
    target: { kind: "object", id: "service-a", displayName: "Orders" },
    concern: "own order processing",
    displayName: "Orders owner",
  });
  const second = createResponsibility({
    id: "resp-1",
    target: { kind: "object", id: "service-a", displayName: "Order API" },
    concern: "own order processing",
    displayName: "Order processing owner",
  });

  assert.deepEqual(first, second);
});

test("rejects malformed and duplicate responsibility declarations", () => {
  assert.throws(
    () =>
      createResponsibility({
        id: "resp-1",
        target: { kind: "object", id: " service-a" },
        concern: "own orders",
      }),
    /identity id is malformed/,
  );
  assert.throws(
    () =>
      createResponsibilitySet({
        responsibilities: [
          {
            id: "resp-1",
            target: { kind: "object", id: "service-a" },
            concern: "own orders",
          },
          {
            id: "resp-1",
            target: { kind: "object", id: "service-b" },
            concern: "own orders",
          },
        ],
      }),
    /duplicate responsibility id: resp-1/,
  );
  assert.throws(
    () =>
      createResponsibilitySet({
        responsibilities: [
          {
            id: "resp-1",
            target: { kind: "object", id: "service-a" },
            concern: "own orders",
          },
          {
            id: "resp-2",
            target: { kind: "object", id: "service-a" },
            concern: "own orders",
          },
        ],
      }),
    /duplicate responsibility declaration/,
  );
});
