import assert from "node:assert/strict";
import test from "node:test";

import { normalizeElements } from "./elements.js";
import {
  createInterface,
  createRelationship,
  normalizeInterfaces,
  normalizeRelationships,
  validateRelationships,
} from "./relationships.js";

const elements = normalizeElements([
  { id: "checkout", kind: "component", parentId: "orders" },
  { id: "orders", kind: "service" },
  { id: "payments", kind: "service" },
]);

test("creates typed directed relationships and explicit interface ownership", () => {
  const contract = createInterface({ id: "orders-api", owner: "orders", protocol: "HTTP", technology: "JSON" });
  const relation = createRelationship({
    source: "checkout",
    target: "orders",
    kind: "calls",
    interfaceId: "orders-api",
  });

  assert.deepEqual(contract, {
    id: "orders-api",
    owner: "orders",
    protocol: "HTTP",
    technology: "JSON",
  });
  assert.deepEqual(relation, {
    source: "checkout",
    target: "orders",
    kind: "calls",
    interfaceId: "orders-api",
  });
});

test("normalizes dependency, call/use, and data/control interactions deterministically", () => {
  const interfaces = normalizeInterfaces([{ id: "orders-api", owner: "orders" }], elements);
  const first = normalizeRelationships(
    [
      { source: "payments", target: "orders", kind: "data" },
      { source: "checkout", target: "orders", kind: "calls", interfaceId: "orders-api" },
      { source: "orders", target: "payments", kind: "depends-on" },
      { source: "orders", target: "payments", kind: "control" },
      { source: "checkout", target: "payments", kind: "uses" },
    ],
    { elements, interfaces },
  );
  const second = normalizeRelationships([...first].reverse(), { elements, interfaces });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map(({ source, target, kind }) => `${source}->${target}:${kind}`),
    [
      "checkout->orders:calls",
      "checkout->payments:uses",
      "orders->payments:control",
      "orders->payments:depends-on",
      "payments->orders:data",
    ],
  );
  assert.ok(Object.isFrozen(first));
});

test("rejects unknown endpoints/interfaces and non-endpoint interface owners", () => {
  const interfaces = normalizeInterfaces([{ id: "orders-api", owner: "orders" }], elements);

  assert.throws(
    () => normalizeRelationships([{ source: "missing", target: "orders", kind: "uses" }], { elements }),
    /unknown relationship source: missing/,
  );
  assert.throws(
    () =>
      normalizeRelationships([{ source: "checkout", target: "orders", kind: "calls", interfaceId: "missing" }], {
        elements,
        interfaces,
      }),
    /unknown relationship interface: missing/,
  );
  assert.throws(
    () =>
      normalizeRelationships([{ source: "payments", target: "checkout", kind: "calls", interfaceId: "orders-api" }], {
        elements,
        interfaces,
      }),
    /relationship interface owner is not an endpoint/,
  );
});

test("rejects duplicate semantic relationship and interface declarations", () => {
  assert.throws(
    () =>
      normalizeRelationships(
        [
          { source: "orders", target: "payments", kind: "depends-on" },
          { source: "orders", target: "payments", kind: "depends-on" },
        ],
        { elements },
      ),
    /duplicate relationship: orders -> payments \(depends-on\)/,
  );
  assert.throws(
    () =>
      normalizeInterfaces([
        { id: "orders-api", owner: "orders" },
        { id: "orders-api", owner: "orders" },
      ]),
    /duplicate interface id: orders-api/,
  );
});

test("validates already-created relationships against canonical context", () => {
  const relation = createRelationship({ source: "checkout", target: "orders", kind: "uses" });
  assert.doesNotThrow(() => validateRelationships([relation], { elements }));
  assert.throws(
    () => validateRelationships([relation], { elements: elements.slice(1) }),
    /unknown relationship source|unknown relationship target/,
  );
});
