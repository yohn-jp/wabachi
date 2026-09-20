import assert from "node:assert/strict";
import test from "node:test";

import { createRelationshipEntryKey, createSemanticEntryKey } from "./entry-key.js";

test("uses collection-qualified ordered tuples for stable semantic keys", () => {
  const first = createSemanticEntryKey({ collection: "element", identity: ["orders"] });
  const second = createSemanticEntryKey({ collection: "element", identity: ["orders"] });
  const differentCollection = createSemanticEntryKey({ collection: "interface", identity: ["orders"] });

  assert.equal(first, second);
  assert.notEqual(first, differentCollection);
});

test("keeps relationship tuple components collision-safe", () => {
  const withDelimiterInSource = createRelationshipEntryKey({
    source: "service|orders",
    target: "repository",
    kind: "uses",
  });
  const withDelimiterInTarget = createRelationshipEntryKey({
    source: "service",
    target: "orders|repository",
    kind: "uses",
  });
  const withDelimiterInTuple = createSemanticEntryKey({
    collection: "relationship",
    identity: ["service|orders", "repository", "uses"],
  });

  assert.notEqual(withDelimiterInSource, withDelimiterInTarget);
  assert.notEqual(withDelimiterInTuple, withDelimiterInTarget);
});

test("distinguishes a relationship with and without an interface identity", () => {
  const withoutInterface = createRelationshipEntryKey({ source: "service", target: "orders", kind: "uses" });
  const withInterface = createRelationshipEntryKey({
    source: "service",
    target: "orders",
    kind: "uses",
    interfaceId: "orders-api",
  });

  assert.notEqual(withoutInterface, withInterface);
});
