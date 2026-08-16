import assert from "node:assert/strict";
import { test } from "node:test";
import type { ObservationEntity, SourceEvidence } from "./observation.js";
import {
  compareFacts,
  compareFactSets,
  FACT_SCHEMA_VERSION,
  factEqualityKey,
  normalizeFacts,
  validateFactEnvelope,
  validateObservationEnvelope,
  type FactObservation,
} from "./facts.js";
import type { ProviderIdentity } from "./provider.js";

const repository = { source: "https://example.test/wabachi.git", commitSha: "a".repeat(40) };
const typescript: ProviderIdentity = { id: "typescript", version: "6.0.3", determinism: "deterministic" };
const scip: ProviderIdentity = { id: "scip-typescript", version: "0.4.0", determinism: "deterministic" };
const graft: ProviderIdentity = { id: "graft", version: "1.2.3", determinism: "deterministic" };

function observation(
  provider: ProviderIdentity,
  predicate: string,
  subject: ObservationEntity,
  object: ObservationEntity | { readonly value: string },
  source: SourceEvidence,
  providerNative: unknown,
): FactObservation {
  return {
    schemaVersion: 1,
    subject,
    predicate,
    object,
    provider,
    repository,
    source,
    determinism: provider.determinism,
    providerNative,
  };
}

function node(id: string, kind: string, path: string, span: string): ObservationEntity {
  return { id, kind };
}

function nativeNode(id: string, kind: string, path: string, span: string): unknown {
  return { node: { id, kind, name: id.split("#").at(-1), path, span } };
}

function nativeEdge(
  sourceId: string,
  sourceKind: string,
  sourcePath: string,
  sourceSpan: string,
  targetId: string,
  targetKind: string,
  targetPath: string,
  targetSpan: string,
): unknown {
  const sourceNode = { id: sourceId, kind: sourceKind, path: sourcePath, span: sourceSpan };
  const targetNode = { id: targetId, kind: targetKind, path: targetPath, span: targetSpan };
  return { node: sourceNode, sourceNode, targetNode, edge: { source: sourceId, target: targetId, relation: "calls" } };
}

test("normalizes overlap, provider-only evidence, and disagreement without losing native payloads", () => {
  const overlap = [
    observation(
      typescript,
      "calls",
      node("ts:caller", "function", "src/main.ts", "L5C1-L5C8"),
      node("ts:add", "function", "src/add.ts", "L1C1-L1C8"),
      { path: "src/main.ts", span: "L5C1-L5C8" },
      nativeNode("ts:add", "function", "src/add.ts", "L1C1-L1C8"),
    ),
    observation(
      scip,
      "calls",
      node("scip:caller", "function", "src/main.ts", "4:0-4:7"),
      node("scip:add", "symbol", "src/add.ts", "0:0-0:7"),
      { path: "src/main.ts", span: "4:0-4:7" },
      nativeNode("scip:add", "symbol", "src/add.ts", "0:0-0:7"),
    ),
    observation(
      graft,
      "calls",
      node("src/main.ts#caller", "function", "src/main.ts", "L5C1-L5C8"),
      node("src/add.ts#add", "function", "src/add.ts", "L1C1-L1C8"),
      { path: "src/main.ts", span: "L5C1-L5C8" },
      nativeEdge(
        "src/main.ts#caller",
        "function",
        "src/main.ts",
        "L5C1-L5C8",
        "src/add.ts#add",
        "function",
        "src/add.ts",
        "L1C1-L1C8",
      ),
    ),
  ];

  const result = normalizeFacts(
    [
      ...overlap,
      observation(
        graft,
        "wires-into",
        node("src/main.ts#caller", "function", "src/main.ts", "L5C1-L5C8"),
        { value: "runtime wiring" },
        { path: "src/main.ts", span: "L5C1-L5C8" },
        { relation: "wires-into", confidence: "extracted" },
      ),
      observation(
        graft,
        "imports",
        node("src/main.ts#caller", "function", "src/main.ts", "L5C1-L5C8"),
        { value: "src/runtime.ts" },
        { path: "src/main.ts", span: "L5C1-L5C8" },
        { relation: "imports", target: "src/runtime.ts" },
      ),
    ],
    { providers: [typescript, scip, graft] },
  );

  assert.equal(result.schemaVersion, FACT_SCHEMA_VERSION);
  assert.equal(result.facts.length, 4);
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0]?.predicate, "wires-into");
  assert.deepEqual(result.unsupported[0]?.providerNative, { relation: "wires-into", confidence: "extracted" });
  assert.equal(result.facts.filter((fact) => fact.predicate === "calls").length, 3);
  assert.equal(new Set(result.facts.map((fact) => fact.repository.commitSha)).size, 1);
  assert.equal(new Set(result.facts.map((fact) => fact.nativeEvidence.id)).size, 4);

  const comparisons = result.comparisons.filter((comparison) => comparison.predicate === "calls");
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0]?.state, "equivalent");
  assert.equal(result.comparisons.find((comparison) => comparison.predicate === "imports")?.state, "provider-only");
  assert.equal(
    result.facts.every((fact) => validateFactEnvelope(fact).valid),
    true,
  );
});

test("fact equality is deterministic and independent of input/provider order", () => {
  const observations: FactObservation[] = [
    observation(
      typescript,
      "defines",
      node("src/example.ts", "module", "src/example.ts", "L1C1-L1C8"),
      node("ts:example", "function", "src/example.ts", "L1C1-L1C8"),
      { path: "src/example.ts", span: "L1C1-L1C8" },
      { id: "ts:example", path: "src/example.ts", span: "L1C1-L1C8" },
    ),
    observation(
      scip,
      "defines",
      node("scip:example", "symbol", "src/example.ts", "0:0-0:7"),
      { value: "src/example.ts" },
      { path: "src/example.ts", span: "0:0-0:7" },
      { symbol: "scip:example", range: [0, 0, 7] },
    ),
  ];
  const first = normalizeFacts(observations, { providers: [typescript, scip] });
  const reversed = normalizeFacts(observations.slice().reverse(), { providers: [scip, typescript] });

  assert.deepEqual(first.facts.map(factEqualityKey), reversed.facts.map(factEqualityKey));
  assert.deepEqual(
    first.facts.map((fact) => fact.factId),
    reversed.facts.map((fact) => fact.factId),
  );
  assert.equal(first.comparisons[0]?.state, "equivalent");
});

test("separates absent, unsupported, provider-only, equivalent, and conflict states", () => {
  const absent = compareFacts([]);
  assert.equal(absent.state, "absent");

  const unsupportedObservation = observation(
    graft,
    "contains",
    node("src/a.ts", "file", "src/a.ts", "L1-L2"),
    { value: "src/a.ts#value" },
    { path: "src/a.ts", span: "L1-L2" },
    { relation: "contains" },
  );
  const normalized = normalizeFacts([unsupportedObservation]);
  const unsupported = compareFacts([], { unsupported: normalized.unsupported });
  assert.equal(unsupported.state, "unsupported");

  const providerOnly = compareFacts(normalizedFact("a"));
  assert.equal(providerOnly.state, "provider-only");

  const equivalent = compareFacts(normalizedFact("same", typescript), { providers: [typescript, scip] });
  assert.equal(equivalent.state, "provider-only");

  const facts = normalizeFacts([
    observation(
      typescript,
      "references",
      node("ts:caller", "function", "src/main.ts", "L1C1-L1C5"),
      { value: "src/a.ts" },
      { path: "src/main.ts", span: "L1C1-L1C5" },
      { target: "a" },
    ),
    observation(
      scip,
      "references",
      node("scip:caller", "symbol", "src/main.ts", "0:0-0:4"),
      { value: "src/b.ts" },
      { path: "src/main.ts", span: "0:0-0:4" },
      { target: "b" },
    ),
  ]);
  assert.equal(facts.comparisons[0]?.state, "conflict");
  assert.equal(compareFactSets(facts.facts)[0]?.state, "conflict");
});

test("keeps one-to-many correlation ambiguity visible in normalized entity references", () => {
  const result = normalizeFacts([
    observation(
      typescript,
      "defines",
      node("src/cardinality.ts", "module", "src/cardinality.ts", "L5C1-L5C8"),
      node("ts:value", "variable", "src/cardinality.ts", "L5C1-L5C8"),
      { path: "src/cardinality.ts", span: "L5C1-L5C8" },
      nativeNode("ts:value", "variable", "src/cardinality.ts", "L5C1-L5C8"),
    ),
    observation(
      scip,
      "defines",
      node("scip:value-a", "symbol", "src/cardinality.ts", "4:0-4:7"),
      { value: "src/cardinality.ts" },
      { path: "src/cardinality.ts", span: "4:0-4:7" },
      { symbol: "scip:value-a", range: [4, 0, 7] },
    ),
    observation(
      scip,
      "defines",
      node("scip:value-b", "symbol", "src/cardinality.ts", "4:0-4:7"),
      { value: "src/cardinality.ts" },
      { path: "src/cardinality.ts", span: "4:0-4:7" },
      { symbol: "scip:value-b", range: [4, 0, 7] },
    ),
  ]);

  assert.equal(
    result.correlation.canonicalEntities.every((entity) => entity.status === "ambiguous"),
    true,
  );
  assert.equal(
    result.facts.every(
      (fact) => fact.subject.correlationStatus === "ambiguous" && fact.subject.candidateCanonicalIds.length > 0,
    ),
    true,
  );
  assert.equal(
    result.facts.every((fact) => fact.subject.canonicalId === undefined),
    true,
  );
});

test("observation and fact schema validation rejects unversioned or contradictory envelopes", () => {
  const unversioned = observation(
    typescript,
    "calls",
    node("caller", "function", "src/main.ts", "L1C1-L1C3"),
    { value: "callee" },
    { path: "src/main.ts", span: "L1C1-L1C3" },
    { id: "callee" },
  );
  assert.equal(validateObservationEnvelope(unversioned).valid, true);
  assert.equal(validateObservationEnvelope({ ...unversioned, schemaVersion: undefined }).valid, false);

  const fact = normalizeFacts([unversioned]).facts[0];
  assert.ok(fact);
  assert.equal(validateFactEnvelope({ ...fact, schemaVersion: undefined }).valid, false);
  assert.equal(validateFactEnvelope({ ...fact, schemaVersion: 99 }).valid, false);
  assert.equal(validateFactEnvelope({ ...fact, determinism: "non-deterministic" }).valid, false);
});

function normalizedFact(value: string, provider: ProviderIdentity = typescript) {
  const result = normalizeFacts([
    observation(
      provider,
      "reads",
      node(`${provider.id}:subject`, "function", "src/a.ts", "L1C1-L1C3"),
      { value },
      { path: "src/a.ts", span: "L1C1-L1C3" },
      { value },
    ),
  ]);
  const fact = result.facts[0];
  assert.ok(fact);
  return [fact];
}
