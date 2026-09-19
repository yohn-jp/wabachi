import assert from "node:assert/strict";
import test from "node:test";

import { createElement, normalizeElements, validateContainment } from "./elements.js";

test("creates annotated actor records without changing id identity", () => {
  const first = createElement({
    id: "orders",
    kind: "actor",
    displayName: "Orders",
    technology: " Web ",
    tags: ["customer", "external"],
    properties: { region: "global", channel: "web" },
  });
  const second = createElement({
    id: "orders",
    kind: "actor",
    displayName: "Order Processing",
  });

  assert.equal(first.id, second.id);
  assert.deepEqual(first, {
    id: "orders",
    kind: "actor",
    displayName: "Orders",
    technology: "Web",
    tags: ["customer", "external"],
    properties: { channel: "web", region: "global" },
  });
});

test("normalizes representative nested containment deterministically", () => {
  const first = normalizeElements([
    { id: "checkout", kind: "component", parentId: "orders" },
    { id: "orders", kind: "service", parentId: "platform" },
    { id: "platform", kind: "system" },
  ]);
  const second = normalizeElements([
    { id: "platform", kind: "system" },
    { id: "orders", kind: "service", parentId: "platform" },
    { id: "checkout", kind: "component", parentId: "orders" },
  ]);

  assert.deepEqual(first, [
    { id: "checkout", kind: "component", parentId: "orders" },
    { id: "orders", kind: "service", parentId: "platform" },
    { id: "platform", kind: "system" },
  ]);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
});

test("normalizes parent identities before containment checks", () => {
  const elements = normalizeElements([
    { id: "child", kind: "component", parentId: "parent" },
    { id: "pare\u006et", kind: "service" },
  ]);

  assert.equal(elements[0]?.parentId, "parent");
});

test("rejects duplicate elements, unknown parents, and cycles", () => {
  assert.throws(
    () =>
      normalizeElements([
        { id: "service", kind: "service" },
        { id: "service", kind: "component" },
      ]),
    /duplicate element id: service/,
  );
  assert.throws(
    () => normalizeElements([{ id: "child", kind: "component", parentId: "missing" }]),
    /unknown parent id: missing/,
  );
  assert.throws(
    () =>
      normalizeElements([
        { id: "a", kind: "service", parentId: "b" },
        { id: "b", kind: "service", parentId: "a" },
      ]),
    /containment cycle detected/,
  );
});

test("rejects unsupported element kinds and validates canonical records", () => {
  assert.throws(
    () => normalizeElements([{ id: "service", kind: "unknown" as never }]),
    /element kind is unsupported: unknown/,
  );

  const elements = normalizeElements([
    { id: "service", kind: "service" },
    { id: "component", kind: "component", parentId: "service" },
  ]);
  assert.doesNotThrow(() => validateContainment(elements));
});

test("normalizes annotations deterministically and rejects malformed or duplicate declarations", () => {
  const first = createElement({
    id: "customer",
    kind: "actor",
    tags: ["beta", "alpha"],
    properties: { zeta: "last", alpha: "first" },
  });
  const second = createElement({
    id: "customer",
    kind: "actor",
    tags: ["alpha", "beta"],
    properties: { alpha: "first", zeta: "last" },
  });
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first.tags));
  assert.ok(Object.isFrozen(first.properties));

  assert.throws(() => createElement({ id: "x", kind: "actor", tags: ["tag", " tag "] }), /duplicate element tag/);
  assert.throws(
    () => createElement({ id: "x", kind: "actor", properties: { "e\u0301": "a", "\u00e9": "b" } }),
    /duplicate element property/,
  );
  assert.throws(() => createElement({ id: "x", kind: "actor", tags: [""] }), /element tag is malformed/);
  assert.throws(
    () => createElement({ id: "x", kind: "actor", properties: new Date() as never }),
    /element properties must be a plain object/,
  );
  assert.throws(
    () => createElement({ id: "x", kind: "actor", properties: { valid: 1 as never } }),
    /element property valid must be a string/,
  );
});
