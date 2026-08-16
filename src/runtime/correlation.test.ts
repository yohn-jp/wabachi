import assert from "node:assert/strict";
import { test } from "node:test";
import type { Observation } from "./observation.js";
import {
  correlateObservations,
  correlateProviderEntities,
  normalizeRepositoryPath,
  normalizeSourceRange,
  providerEntitiesFromObservations,
} from "./correlation.js";
import type { ProviderEntityInput } from "./correlation.js";
import type { ProviderIdentity } from "./provider.js";

const repository = { source: "https://example.test/repository.git", commitSha: "a".repeat(40) };
const typescript: ProviderIdentity = { id: "typescript", version: "6.0.3", determinism: "deterministic" };
const scip: ProviderIdentity = { id: "scip-typescript", version: "0.4.0", determinism: "deterministic" };
const graft: ProviderIdentity = { id: "graft", version: "1.2.3", determinism: "deterministic" };

function entity(
  provider: ProviderIdentity,
  id: string,
  fields: Partial<
    Pick<
      ProviderEntityInput,
      "kind" | "path" | "span" | "range" | "name" | "qualifiedName" | "signature" | "aliases" | "providerNative"
    >
  > = {},
): ProviderEntityInput {
  return {
    provider,
    repository,
    id,
    kind: "function",
    path: "src/example.ts",
    name: "example",
    qualifiedName: "example",
    providerNative: { provider: provider.id, id },
    ...fields,
  };
}

test("normalizes repository paths and TypeScript/SCIP ranges to one representation", () => {
  assert.equal(normalizeRepositoryPath("./src\\nested/../example.ts"), "src/example.ts");
  assert.deepEqual(
    normalizeSourceRange("L10C1-L10C4", "typescript"),
    normalizeSourceRange("9:0-9:3", "scip-typescript"),
  );
  assert.deepEqual(normalizeSourceRange([9, 0, 3], "scip-typescript"), {
    startLine: 10,
    startColumn: 1,
    endLine: 10,
    endColumn: 4,
  });
});

test("correlates TypeScript, SCIP, and Graft entities with stable order-independent identities", () => {
  const inputs = [
    entity(typescript, '"src/example".example', {
      kind: "FunctionDeclaration",
      range: "L10C1-L10C4",
      qualifiedName: '"src/example".example',
      providerNative: { source: "typescript-native" },
    }),
    entity(scip, "scip-typescript npm example example().", {
      kind: "symbol",
      range: "9:0-9:3",
      qualifiedName: "scip-typescript npm example example().",
      providerNative: { source: "scip-native" },
    }),
    entity(graft, "src/example.ts#example", {
      kind: "function",
      range: "L10C1-L10C4",
      qualifiedName: "example",
      signature: "function example(): void",
      providerNative: { source: "graft-native" },
    }),
  ];

  const first = correlateProviderEntities(inputs);
  const reversed = correlateProviderEntities(inputs.slice().reverse());

  assert.deepEqual(
    first.canonicalEntities.map((record) => record.canonicalId),
    reversed.canonicalEntities.map((record) => record.canonicalId),
  );
  assert.equal(first.canonicalEntities.length, 1);
  const record = first.canonicalEntities[0];
  assert.ok(record);
  assert.equal(record.status, "matched");
  assert.equal(record.members.length, 3);
  assert.equal(new Set(record.members.map((member) => member.provider.id)).size, 3);
  assert.ok(record.rationale.rules.includes("same-range"));
  assert.equal(record.rationale.method, "deterministic-rules");
  assert.deepEqual(
    new Set(record.members.map((member) => (member.providerNative as { source: string }).source)),
    new Set(["typescript-native", "scip-native", "graft-native"]),
  );
  assert.equal(
    first.links.every((link) => link.cardinality === "one-to-one"),
    true,
  );
});

test("uses aliases and signatures when provider ranges differ", () => {
  const result = correlateProviderEntities([
    entity(typescript, '"src/types".Shape', {
      kind: "InterfaceDeclaration",
      path: "./src/types.ts",
      range: "L1C1-L1C10",
      name: "Shape",
      qualifiedName: '"src/types".Shape',
      aliases: ["ShapeAlias"],
    }),
    entity(scip, "scip-typescript ShapeAlias", {
      kind: "symbol",
      path: "src/types.ts",
      range: "4:0-4:12",
      name: "ShapeAlias",
      qualifiedName: "ShapeAlias",
    }),
  ]);

  assert.equal(result.canonicalEntities.length, 1);
  const record = result.canonicalEntities[0];
  assert.ok(record);
  assert.equal(record.status, "matched");
  assert.ok(record.rationale.rules.includes("same-alias"));
  assert.equal(record.rationale.rules.includes("same-range"), false);
});

test("marks a unique weak deterministic candidate as probable", () => {
  const result = correlateProviderEntities([
    entity(typescript, "ts-local", {
      path: "src/probable.ts",
      range: "L1C1-L1C8",
      name: "local",
      qualifiedName: undefined,
    }),
    entity(scip, "scip-local", {
      kind: "symbol",
      path: "src/probable.ts",
      range: "L3C1-L3C8",
      name: "local",
      qualifiedName: undefined,
    }),
  ]);

  assert.equal(result.canonicalEntities.length, 1);
  assert.equal(result.canonicalEntities[0]?.status, "probable");
  assert.equal(result.canonicalEntities[0]?.rationale.reason, "probable-evidence");
});

test("keeps overloads separate when declaration ranges and signatures identify them", () => {
  const result = correlateProviderEntities([
    entity(typescript, '"src/overloads".overload#string', {
      kind: "FunctionDeclaration",
      path: "src/overloads.ts",
      range: "L1C1-L1C40",
      signature: "(value: string): string",
    }),
    entity(typescript, '"src/overloads".overload#number', {
      kind: "FunctionDeclaration",
      path: "src/overloads.ts",
      range: "L2C1-L2C40",
      signature: "(value: number): number",
    }),
    entity(scip, "scip overload(string)", {
      kind: "symbol",
      path: "src/overloads.ts",
      range: "0:0-0:39",
      signature: "(value: string): string",
    }),
    entity(scip, "scip overload(number)", {
      kind: "symbol",
      path: "src/overloads.ts",
      range: "1:0-1:39",
      signature: "(value: number): number",
    }),
  ]);

  assert.equal(result.canonicalEntities.length, 2);
  assert.equal(
    result.canonicalEntities.every((record) => record.status === "matched"),
    true,
  );
  assert.equal(
    result.canonicalEntities.every((record) => record.members.length === 2),
    true,
  );
  assert.equal(
    new Set(result.canonicalEntities.flatMap((record) => record.members.map((member) => member.signature))).size,
    2,
  );
});

test("correlates anonymous/local entities by normalized location and leaves unresolved cardinality visible", () => {
  const local = correlateProviderEntities([
    entity(typescript, "ts-local-1", {
      kind: "VariableDeclaration",
      path: "src/local.ts",
      range: "L3C3-L3C8",
      name: undefined,
      qualifiedName: undefined,
      signature: undefined,
    }),
    entity(graft, "src/local.ts#local-1", {
      kind: "variable",
      path: "src/local.ts",
      range: "L3C3-L3C8",
      name: undefined,
      qualifiedName: undefined,
      signature: undefined,
    }),
  ]);
  assert.equal(local.canonicalEntities.length, 1);
  assert.equal(local.canonicalEntities[0]?.status, "matched");

  const oneToMany = correlateProviderEntities([
    entity(typescript, "ts-symbol", {
      kind: "VariableDeclaration",
      path: "src/cardinality.ts",
      range: "L5C1-L5C8",
      name: "value",
      qualifiedName: "value",
    }),
    entity(scip, "scip-symbol-a", {
      kind: "symbol",
      path: "src/cardinality.ts",
      range: "4:0-4:7",
      name: "value",
      qualifiedName: "value",
    }),
    entity(scip, "scip-symbol-b", {
      kind: "symbol",
      path: "src/cardinality.ts",
      range: "4:0-4:7",
      name: "value",
      qualifiedName: "value",
    }),
    entity(graft, "src/unmatched.ts#other", {
      kind: "class",
      path: "src/unmatched.ts",
      range: "L1C1-L1C5",
      name: "Other",
      qualifiedName: "Other",
    }),
  ]);

  const ambiguous = oneToMany.canonicalEntities.filter((record) => record.status === "ambiguous");
  assert.equal(ambiguous.length, 3);
  assert.equal(
    oneToMany.links.some((link) => link.cardinality === "one-to-many" || link.cardinality === "many-to-one"),
    true,
  );
  assert.equal(
    ambiguous.some((record) => record.rationale.cardinality === "many-to-one"),
    true,
  );
  assert.equal(
    oneToMany.canonicalEntities.some((record) => record.status === "unmatched"),
    true,
  );
});

test("extracts provider-native identities from the existing observation envelope and computes provider metrics", () => {
  const observations: Observation[] = [
    {
      subject: { id: "src/example.ts", kind: "module" },
      predicate: "defines",
      object: { id: "ts:example", kind: "FunctionDeclaration" },
      provider: typescript,
      repository,
      source: { path: "src/example.ts", span: "L1C1-L1C8" },
      determinism: "deterministic",
      providerNative: { name: "example", qualifiedName: "example", type: "(): void" },
    },
    {
      subject: { id: "scip:example", kind: "symbol" },
      predicate: "defines",
      object: { value: "src/example.ts" },
      provider: scip,
      repository,
      source: { path: "src/example.ts", span: "0:0-0:7" },
      determinism: "deterministic",
      providerNative: { symbol: "scip:example", range: [0, 0, 7] },
    },
  ];

  const extracted = providerEntitiesFromObservations(observations);
  assert.equal(extracted.length, 2);
  assert.equal((extracted[0]?.providerNative as { name?: string }).name ?? "", "example");
  const result = correlateObservations(observations);
  assert.equal(result.canonicalEntities.length, 1);
  assert.equal(result.canonicalEntities[0]?.members.length, 2);
  assert.equal(result.metrics.typescript?.matched, 1);
  assert.equal(result.metrics["scip-typescript"]?.matched, 1);
  assert.equal(result.metrics.typescript?.total, 1);
});

test("records oversized deterministic candidate buckets instead of materializing an edge explosion", () => {
  // Candidate generation is provider-aware: a shared key's potential pair
  // count is the cross-provider product (leftCount * rightCount), not the
  // full same-key clique. 320 entities per provider gives 320 * 320 =
  // 102,400 potential pairs, just above MAX_CANDIDATE_PAIRS_PER_KEY
  // (100,000) for every key class this fixture activates.
  //
  // qualifiedName/aliases use a structured value ("scope".shared, not the
  // bare token "shared") so they land in the strong qualified-exact/
  // alias-match-exact classes instead of being folded into name-exact by
  // isBareToken -- a bare qualifiedName (e.g. what TypeScript's checker
  // reports for a block-scoped local) is intentionally treated as
  // no-more-informative-than-a-name and is covered by the dedicated
  // "many individually-valid weak-name buckets" tests below.
  const perProvider = 320;
  const inputs = [
    ...Array.from({ length: perProvider }, (_, index) =>
      entity(typescript, `ts-${index}`, {
        path: "src/large.ts",
        name: "shared",
        qualifiedName: '"scope".shared',
        aliases: ["scope.sharedAlias"],
      }),
    ),
    ...Array.from({ length: perProvider }, (_, index) =>
      entity(scip, `scip-${index}`, {
        path: "src/large.ts",
        name: "shared",
        qualifiedName: '"scope".shared',
        aliases: ["scope.sharedAlias"],
      }),
    ),
  ];
  const result = correlateProviderEntities(inputs);

  assert.equal(result.links.length, 0);
  assert.ok(result.diagnostics.skippedKeyCount > 0);
  assert.ok(result.diagnostics.skippedPotentialPairCount > 100_000);
  assert.equal(result.diagnostics.maxCandidatePairsPerKey, 100_000);
  // Every normalized key class this fixture's shared path/name/qualifiedName
  // activates (see candidateKeys) must be represented and skipped, each with
  // a real potential pair count over the cap.
  assert.deepEqual(result.diagnostics.skippedKeys.map((item) => item.keyClass).sort(), [
    "alias-match-exact",
    "name-exact",
    "path-name-exact",
    "qualified-exact",
  ]);
  for (const item of result.diagnostics.skippedKeys) {
    assert.ok(item.keyCount > 0);
    assert.ok(item.potentialPairCount > 100_000);
  }
});

test("bounds the aggregate cost of many individually-valid weak-name buckets", () => {
  // Each bucket alone is far below the per-key pair cap (100 * 100 =
  // 10,000 << 100,000), so a single global/per-key check on strong evidence
  // would let all 200 buckets through -- 200 * 10,000 = 2,000,000
  // candidate pairs from bare name matches with no path/qualifiedName/
  // signature to narrow them. Weak key classes get a much tighter per-key
  // cap (MAX_WEAK_CANDIDATE_PAIRS_PER_KEY) specifically so this shape is
  // bounded without relying on the aggregate safety valve.
  const bucketSize = 100;
  const bucketCount = 200;
  const inputs: ProviderEntityInput[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const name = `shared${bucket}`;
    for (let index = 0; index < bucketSize; index += 1) {
      inputs.push(entity(typescript, `ts-${bucket}-${index}`, { path: undefined, name, qualifiedName: undefined }));
    }
    for (let index = 0; index < bucketSize; index += 1) {
      inputs.push(
        entity(scip, `scip-${bucket}-${index}`, { path: undefined, name, qualifiedName: undefined, kind: "symbol" }),
      );
    }
  }

  const start = process.hrtime.bigint();
  const result = correlateProviderEntities(inputs);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  assert.equal(result.links.length, 0);
  assert.equal(result.diagnostics.skippedKeyCount, bucketCount);
  assert.ok(elapsedMs < 5_000, `expected the weak-bucket cap to keep this under 5s, took ${elapsedMs}ms`);
});

test("still compares small weak-name buckets pairwise instead of skipping them", () => {
  // A bucket below MAX_WEAK_CANDIDATE_PAIRS_PER_KEY must still be fully
  // compared -- the weak-class cap must not regress recall for the common
  // case of a handful of same-named entities.
  const result = correlateProviderEntities([
    entity(typescript, "ts-helper", { path: undefined, name: "helper", qualifiedName: undefined }),
    entity(scip, "scip-helper", { path: undefined, name: "helper", qualifiedName: undefined, kind: "symbol" }),
  ]);
  assert.equal(result.diagnostics.skippedKeyCount, 0);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0]?.rules.includes("same-name"), true);
});

test("produces identical canonical identities regardless of input order at scale", () => {
  const build = (): ProviderEntityInput[] => {
    const inputs: ProviderEntityInput[] = [];
    const symbolsPerFile = 20;
    for (let index = 0; index < 400; index += 1) {
      const fileIndex = Math.floor(index / symbolsPerFile);
      const lineInFile = (index % symbolsPerFile) + 1;
      const path = `src/order${fileIndex}.ts`;
      const range = `L${lineInFile}C1-L${lineInFile}C10`;
      const name = `sym${index}`;
      inputs.push(entity(typescript, `ts-${index}`, { path, range, name, qualifiedName: name }));
      inputs.push(entity(scip, `scip-${index}`, { path, range, name, qualifiedName: name, kind: "symbol" }));
    }
    return inputs;
  };
  const forward = build();
  const reversed = [...forward].reverse();

  const forwardResult = correlateProviderEntities(forward);
  const reversedResult = correlateProviderEntities(reversed);

  assert.deepEqual(
    forwardResult.canonicalEntities.map((item) => item.canonicalId),
    reversedResult.canonicalEntities.map((item) => item.canonicalId),
  );
  assert.equal(
    forwardResult.canonicalEntities.every((item) => item.status === "matched"),
    true,
  );
});
