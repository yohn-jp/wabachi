import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthorityFact,
  createAuthorityFacts,
  createAuthorityOwnershipFacts,
  createOwnershipFact,
  createOwnershipFacts,
} from "./authority.js";

test("creates distinct machine-readable authority and ownership facts", () => {
  const authority = createAuthorityFact({ concern: "billing", owner: "billing-service" });
  const ownership = createOwnershipFact({ resource: "billing-contract", owner: "billing-service" });

  assert.deepEqual(authority, {
    kind: "authority",
    concern: "billing",
    owner: "billing-service",
  });
  assert.deepEqual(ownership, {
    kind: "ownership",
    resource: "billing-contract",
    owner: "billing-service",
  });
  assert.notEqual(authority.kind, ownership.kind);
});

test("normalizes equivalent fact sets deterministically", () => {
  const first = createAuthorityOwnershipFacts({
    authority: [
      { concern: "zeta", owner: "owner-z" },
      { concern: "alpha", owner: "owner-a" },
    ],
    ownership: [
      { resource: "zeta-contract", owner: "owner-z" },
      { resource: "alpha-contract", owner: "owner-a" },
    ],
  });
  const second = createAuthorityOwnershipFacts({
    authority: [
      { concern: "alpha", owner: "owner-a" },
      { concern: "zeta", owner: "owner-z" },
    ],
    ownership: [
      { resource: "alpha-contract", owner: "owner-a" },
      { resource: "zeta-contract", owner: "owner-z" },
    ],
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.authority.map((fact) => fact.concern),
    ["alpha", "zeta"],
  );
  assert.deepEqual(
    first.ownership.map((fact) => fact.resource),
    ["alpha-contract", "zeta-contract"],
  );
});

test("allows multiple authority owners for later single-authority validation", () => {
  const facts = createAuthorityFacts([
    { concern: "payment", owner: "service-a" },
    { concern: "payment", owner: "service-b" },
  ]);

  assert.equal(facts.length, 2);
});

test("rejects malformed IDs and duplicate semantic facts", () => {
  assert.throws(() => createAuthorityFact({ concern: "", owner: "service-a" }), /identity id is malformed/);
  assert.throws(
    () => createOwnershipFact({ resource: "service\u0000a", owner: "service-b" }),
    /identity id is malformed/,
  );
  assert.throws(
    () =>
      createAuthorityFacts([
        { concern: "payment", owner: "service-a" },
        { concern: "payment", owner: "service-a" },
      ]),
    /duplicate authority fact: payment -> service-a/,
  );
  assert.throws(
    () =>
      createOwnershipFacts([
        { resource: "payment-contract", owner: "service-a" },
        { resource: "payment-contract", owner: "service-a" },
      ]),
    /duplicate ownership fact: payment-contract -> service-a/,
  );
});
