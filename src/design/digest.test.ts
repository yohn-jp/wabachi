import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeJson, digestJson } from "./digest.js";

test("sorts object keys ordinally while preserving array order", () => {
  const first = { zeta: 1, alpha: { second: 2, first: 1 }, items: ["first", "second"] };
  const reordered = { items: ["first", "second"], alpha: { first: 1, second: 2 }, zeta: 1 };
  const reorderedArray = { zeta: 1, alpha: { second: 2, first: 1 }, items: ["second", "first"] };

  assert.equal(digestJson(first), digestJson(reordered));
  assert.notEqual(digestJson(first), digestJson(reorderedArray));
  assert.equal(canonicalizeJson(first), '{"alpha":{"first":1,"second":2},"items":["first","second"],"zeta":1}');
});

test("rejects values that JSON would omit or serialize ambiguously", () => {
  assert.throws(() => digestJson(undefined), /only JSON values/);
  assert.throws(() => digestJson({ value: Number.NaN }), /finite numbers/);
  assert.throws(() => digestJson({ value: Number.POSITIVE_INFINITY }), /finite numbers/);

  const sparse = [] as string[];
  sparse.length = 1;
  assert.throws(() => digestJson(sparse), /dense JSON array/);
});

test("rejects non-plain objects and cyclic values", () => {
  assert.throws(() => digestJson(new Date("2026-01-01T00:00:00.000Z")), /only JSON values/);

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => digestJson(cyclic), /cyclic references/);
});
