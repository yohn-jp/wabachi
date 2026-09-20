import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkingSetSeeds,
  parseWorkingSetSeeds,
  resolveWorkingSetSeeds,
  serializeWorkingSetSeeds,
  type WorkingSetSeedResolutionContext,
} from "./seeds.js";
import { correlateProviderEntities, type ProviderEntityInput } from "../runtime/correlation.js";

const revision = "0123456789abcdef0123456789abcdef01234567";
const repository = {
  repositoryHost: "github.com",
  repositoryId: "1335559861",
  repository: "yohn-jp/wabachi",
} as const;

const base = {
  kind: "working-set-seeds" as const,
  schemaVersion: 1 as const,
  task: { taskId: "task-138", intent: "investigate" as const },
  repository,
  revision,
  seeds: [
    { kind: "architecture-component" as const, componentId: "orders" },
    { kind: "path" as const, path: "src/orders.ts" },
    { kind: "symbol-export" as const, path: "src/orders.ts", symbol: "createOrder", exportName: "createOrder" },
  ],
};

function context(overrides: Partial<WorkingSetSeedResolutionContext> = {}): WorkingSetSeedResolutionContext {
  return {
    repository,
    revision,
    ...overrides,
  };
}

function entityInputs(): ProviderEntityInput[] {
  return [
    {
      provider: { id: "typescript", version: "1", determinism: "deterministic" },
      repository: { source: repository.repository, commitSha: revision },
      id: "createOrder",
      kind: "function",
      path: "src/orders.ts",
      name: "createOrder",
      qualifiedName: "orders.createOrder",
      providerNative: { id: "createOrder", source: "typescript" },
    },
  ];
}

test("creates a bounded, canonical seed document and rejects prose or authority fields", () => {
  const first = serializeWorkingSetSeeds(base);
  const second = serializeWorkingSetSeeds({ ...base, seeds: [...base.seeds].reverse() });

  assert.equal(first, second);
  assert.deepEqual(parseWorkingSetSeeds(first), parseWorkingSetSeeds(second));
  assert.match(first, /"schemaVersion":1/);
  assert.doesNotMatch(first, /authorization|conversation|payload/);
  assert.throws(
    () => createWorkingSetSeeds({ ...base, task: { ...base.task, summary: "full issue prose" } } as never),
    /unknown field: summary/,
  );
  assert.throws(
    () => createWorkingSetSeeds({ ...base, repository: { ...repository, repository: " yohn-jp/wabachi" } }),
    /repository repository is malformed/,
  );
});

test("enforces exact repository and immutable revision binding without fallback", () => {
  const result = resolveWorkingSetSeeds(base, context({ repository: { ...repository, repositoryId: "different" } }));

  assert.equal(result.binding, "mismatch");
  assert.deepEqual(
    result.resolutions.map((resolution) => resolution.status),
    ["unresolved", "unresolved", "unresolved"],
  );
  assert.ok(
    result.resolutions.every(
      (resolution) => resolution.status === "unresolved" && resolution.reason === "repository-mismatch",
    ),
  );
  assert.throws(() => createWorkingSetSeeds({ ...base, revision: "main" } as never), /immutable hexadecimal revision/);
});

test("resolves exact paths and Canon components deterministically", () => {
  const result = resolveWorkingSetSeeds(
    base,
    context({
      repositoryMappings: [
        {
          canonId: "orders",
          paths: [{ path: "src/orders.ts", scope: "file" }],
          symbols: [{ path: "src/orders.ts", symbol: "createOrder", exportName: "createOrder" }],
          tests: [{ path: "src/orders.test.ts", selector: "creates an order" }],
        },
      ],
    }),
  );

  assert.equal(result.binding, "matched");
  const resolved = result.resolutions.filter((resolution) => resolution.status === "resolved");
  assert.equal(resolved.length, 3);
  const component = resolved.find((resolution) => resolution.seed.kind === "architecture-component");
  assert.deepEqual(component && component.status === "resolved" ? component.targets : [], [
    { kind: "file", locator: "src/orders.ts" },
    { kind: "symbol", locator: "src/orders.ts#createOrder@createOrder" },
    { kind: "test", locator: "src/orders.test.ts#creates an order" },
  ]);
});

test("resolves a symbol only from exact correlation evidence and keeps ambiguity unresolved", () => {
  const correlation = correlateProviderEntities(entityInputs());
  const unique = resolveWorkingSetSeeds(
    { ...base, seeds: [{ kind: "symbol-export", path: "src/orders.ts", symbol: "createOrder" }] },
    context({ correlation }),
  );
  assert.deepEqual(unique.resolutions[0], {
    status: "resolved",
    seed: { kind: "symbol-export", path: "src/orders.ts", symbol: "createOrder" },
    targets: [{ kind: "symbol", locator: "src/orders.ts#createOrder" }],
    evidence: [
      {
        artifact: "provider-correlation",
        reference: unique.resolutions[0]?.status === "resolved" ? unique.resolutions[0].evidence[0]?.reference : "",
      },
    ],
  });

  const ambiguous = correlateProviderEntities([
    ...entityInputs(),
    {
      ...entityInputs()[0],
      id: "another-createOrder",
      providerNative: { id: "another-createOrder", source: "typescript" },
    },
  ]);
  const unresolved = resolveWorkingSetSeeds(
    { ...base, seeds: [{ kind: "symbol-export", path: "src/orders.ts", symbol: "createOrder" }] },
    context({ correlation: ambiguous }),
  ).resolutions[0];
  assert.equal(unresolved?.status, "unresolved");
  assert.equal(unresolved?.reason, "ambiguous");
});

test("missing Canon component and missing symbol evidence are explicit bounded failures", () => {
  const result = resolveWorkingSetSeeds(
    {
      ...base,
      seeds: [
        { kind: "architecture-component", componentId: "missing" },
        { kind: "symbol-export", path: "src/missing.ts", symbol: "missing" },
      ],
    },
    context(),
  );

  assert.deepEqual(
    result.resolutions.map((resolution) => resolution.status),
    ["unresolved", "unresolved"],
  );
  assert.ok(
    result.resolutions.every((resolution) => resolution.status === "unresolved" && resolution.reason === "missing"),
  );
});
