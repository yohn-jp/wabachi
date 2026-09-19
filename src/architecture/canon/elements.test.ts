import assert from "node:assert/strict";
import test from "node:test";

import { createElement, normalizeElements, validateContainment } from "./elements.js";

test("creates canonical element records without display-name identity", () => {
  const first = createElement({
    id: "orders",
    kind: "service",
    displayName: "Orders",
  });
  const second = createElement({
    id: "orders",
    kind: "service",
    displayName: "Order Processing",
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first, { id: "orders", kind: "service" });
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
