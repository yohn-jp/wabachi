import assert from "node:assert/strict";
import test from "node:test";

import {
  createRepositoryMapping,
  createRepositoryMappings,
  normalizeRepositoryPath,
  serializeRepositoryMappings,
} from "./repository-mappings.js";

test("represents source file and directory scope mappings", () => {
  const mapping = createRepositoryMapping({
    canonId: "object-orders",
    paths: [{ path: "src\\orders\\", scope: "directory" }, "src/orders/index.ts"],
  });

  assert.deepEqual(mapping.paths, [
    { path: "src/orders", scope: "directory" },
    { path: "src/orders/index.ts", scope: "file" },
  ]);
});

test("represents symbol/export and test selector mappings", () => {
  const mapping = createRepositoryMapping({
    canonId: "object-orders",
    symbols: [
      { path: "src/orders/service.ts", symbol: "OrderService", exportName: "OrderService" },
      { path: "src/orders/service.ts", symbol: "createOrder" },
    ],
    tests: [{ path: "src/orders/service.test.ts", selector: "creates an order" }],
  });

  assert.deepEqual(mapping.symbols, [
    { path: "src/orders/service.ts", symbol: "OrderService", exportName: "OrderService" },
    { path: "src/orders/service.ts", symbol: "createOrder" },
  ]);
  assert.deepEqual(mapping.tests, [{ path: "src/orders/service.test.ts", selector: "creates an order" }]);
});

test("normalizes paths and rejects declarations outside the repository root", () => {
  assert.equal(normalizeRepositoryPath("./src/./orders\\service.ts"), "src/orders/service.ts");
  assert.throws(() => normalizeRepositoryPath("../outside.ts"), /cannot escape/);
  assert.throws(() => normalizeRepositoryPath("src/../../outside.ts"), /cannot escape/);
  assert.throws(() => normalizeRepositoryPath("/absolute.ts"), /must be relative/);
  assert.throws(() => normalizeRepositoryPath("C:\\outside.ts"), /must be relative/);
});

test("sorts one-to-many and shared mappings deterministically", () => {
  const first = createRepositoryMappings([
    {
      canonId: "object-zeta",
      paths: ["src/shared.ts", "src/zeta.ts"],
      symbols: [{ path: "src/shared.ts", symbol: "Shared" }],
    },
    {
      canonId: "object-alpha",
      paths: ["src/shared.ts", "src/alpha.ts"],
      symbols: [{ path: "src/shared.ts", symbol: "Shared" }],
    },
  ]);
  const second = createRepositoryMappings([
    {
      canonId: "object-alpha",
      paths: ["src/alpha.ts", "src/shared.ts"],
      symbols: [{ path: "src/shared.ts", symbol: "Shared" }],
    },
    {
      canonId: "object-zeta",
      paths: ["src/zeta.ts", "src/shared.ts"],
      symbols: [{ path: "src/shared.ts", symbol: "Shared" }],
    },
  ]);

  assert.deepEqual(first, second);
  assert.equal(serializeRepositoryMappings(first), serializeRepositoryMappings(second));
  assert.throws(
    () => createRepositoryMappings([{ canonId: "object-alpha" }, { canonId: "object-alpha" }]),
    /duplicate repository mapping canon id/,
  );
});
