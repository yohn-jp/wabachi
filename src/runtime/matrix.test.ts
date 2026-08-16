import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeFacts, type FactObservation } from "./facts.js";
import type { ObservationEntity } from "./observation.js";
import type { ProviderIdentity } from "./provider.js";
import {
  buildProviderMatrix,
  buildProviderMatrixFromArtifact,
  renderProviderMatrixReport,
  writeNormalizedFactsArtifact,
  writeProviderMatrix,
} from "./matrix.js";

const repository = { source: "https://example.test/wabachi.git", commitSha: "a".repeat(40) };
const alpha: ProviderIdentity = { id: "alpha", version: "1.0.0", determinism: "deterministic" };
const beta: ProviderIdentity = { id: "beta", version: "2.0.0", determinism: "deterministic" };
const gamma: ProviderIdentity = { id: "gamma", version: "3.0.0", determinism: "deterministic" };

function entity(id: string, kind = "function"): ObservationEntity {
  return { id, kind };
}

function observation(
  provider: ProviderIdentity,
  predicate: string,
  subjectId: string,
  sourcePath: string,
  value: string,
  name: string,
  kind = "function",
): FactObservation {
  const span = "L1C1-L1C8";
  return {
    schemaVersion: 1,
    subject: entity(subjectId, kind),
    predicate,
    object: { value },
    provider,
    repository,
    source: { path: sourcePath, span },
    determinism: provider.determinism,
    providerNative: {
      node: { id: subjectId, kind, name, path: sourcePath, span },
      value,
    },
  };
}

function comparableFixture() {
  return normalizeFacts(
    [
      observation(alpha, "reads", "alpha:main", "src/main.ts", "shared", "main"),
      observation(beta, "reads", "beta:main", "src/main.ts", "shared", "main"),
      observation(alpha, "imports", "alpha:main", "src/main.ts", "src/alpha.ts", "main"),
      observation(alpha, "references", "alpha:main", "src/main.ts", "left", "main"),
      observation(beta, "references", "beta:main", "src/main.ts", "right", "main"),
      observation(alpha, "contains", "alpha:main", "src/main.ts", "provider-native", "main"),
      observation(alpha, "reads", "alpha:private", "src/private.ts", "unmatched", "private"),
    ],
    { providers: [alpha, beta] },
  );
}

test("builds deterministic coverage, overlap, conflict, unique, and explicit missing views", () => {
  const normalized = comparableFixture();
  const matrix = buildProviderMatrix(normalized, { providers: [gamma, beta, alpha] });

  assert.deepEqual(
    matrix.providers.map((provider) => provider.id),
    ["alpha", "beta", "gamma"],
  );
  assert.equal(
    matrix.facts.some((row) => row.state === "overlap"),
    true,
  );
  assert.equal(
    matrix.facts.some((row) => row.state === "provider-only"),
    true,
  );
  assert.equal(
    matrix.facts.some((row) => row.state === "conflict"),
    true,
  );
  assert.equal(
    matrix.facts.some((row) => row.state === "unsupported"),
    true,
  );
  assert.equal(
    matrix.facts.some((row) => row.state === "unmatched"),
    true,
  );

  const overlap = matrix.overlap.pairwise.find(
    (item) => item.left.id === "alpha" && item.right.id === "beta" && item.factClass === "reads",
  );
  assert.ok(overlap);
  assert.equal(overlap.overlapFactCount, 1);
  assert.equal(overlap.conflictFactCount, 0);

  const conflict = matrix.conflicts.find((row) => row.factClass === "references");
  assert.ok(conflict);
  assert.equal(conflict.variants.length, 2);
  assert.equal(conflict.state, "conflict");
  assert.equal(conflict.providerStates.find((state) => state.provider.id === "gamma")?.state, "missing");

  const alphaCoverage = matrix.coverage.find((item) => item.provider.id === "alpha");
  const gammaCoverage = matrix.coverage.find((item) => item.provider.id === "gamma");
  assert.ok(alphaCoverage);
  assert.ok(gammaCoverage);
  assert.equal(alphaCoverage.uniqueFactCount, 1);
  assert.equal(alphaCoverage.normalizedFactCount, 4);
  assert.equal(alphaCoverage.unsupportedFactCount, 1);
  assert.equal(alphaCoverage.normalizationCoverage.denominator, 5);
  assert.equal(alphaCoverage.uniqueCoverage.numerator, 1);
  assert.equal(alphaCoverage.uniqueCoverage.denominator, 3);
  assert.equal(gammaCoverage.rawObservedFactCount, 0);
  assert.equal(gammaCoverage.normalizationCoverage.value, null);

  const readsAll = matrix.overlap.allProviders.find((item) => item.factClass === "reads");
  assert.ok(readsAll);
  assert.equal(readsAll.allProviderOverlapFactCount, 0);

  const alphaGain = matrix.informationGain.find((item) => item.provider.id === "alpha");
  assert.ok(alphaGain);
  assert.equal(alphaGain.uniqueFactCount, 1);
  assert.equal(alphaGain.informationGainCoverage.value, 1);
  assert.equal(alphaGain.newUnsupportedFactCount, 1);
  assert.equal(alphaGain.newUnmatchedFactCount, 1);
});

test("does not confuse overlap with conflict and preserves ambiguous correlation", () => {
  const ambiguous = normalizeFacts([
    observation(alpha, "reads", "alpha:ambiguous", "src/ambiguous.ts", "value-a", "ambiguous"),
    observation(beta, "reads", "beta:ambiguous-a", "src/ambiguous.ts", "value-b", "ambiguous"),
    observation(beta, "reads", "beta:ambiguous-b", "src/ambiguous.ts", "value-c", "ambiguous"),
  ]);
  const matrix = buildProviderMatrix(ambiguous, { providers: [alpha, beta] });

  assert.ok(matrix.unmatched.ambiguous.length > 0);
  assert.equal(matrix.overlap.facts.length, 0);
  assert.equal(matrix.conflicts.length, 0);
  assert.equal(
    matrix.unmatched.ambiguous.every((row) => row.comparisonPossible === false),
    true,
  );
  assert.equal(
    matrix.unmatched.ambiguous.every((row) =>
      row.variants.every((variant) => variant.subject.candidateCanonicalIds.length > 0),
    ),
    true,
  );
});

test("is independent of observation and expected-provider ordering", () => {
  const observations = [
    observation(alpha, "reads", "alpha:main", "src/main.ts", "shared", "main"),
    observation(beta, "reads", "beta:main", "src/main.ts", "shared", "main"),
    observation(alpha, "imports", "alpha:main", "src/main.ts", "src/alpha.ts", "main"),
    observation(alpha, "references", "alpha:main", "src/main.ts", "left", "main"),
    observation(beta, "references", "beta:main", "src/main.ts", "right", "main"),
  ];
  const first = buildProviderMatrix(normalizeFacts(observations, { providers: [alpha, beta] }), {
    providers: [alpha, beta, gamma],
  });
  const reversed = buildProviderMatrix(normalizeFacts(observations.slice().reverse(), { providers: [beta, alpha] }), {
    providers: [gamma, beta, alpha],
  });
  assert.equal(JSON.stringify(first), JSON.stringify(reversed));
});

test("persists normalized input and produces auditable matrix artifacts without provider execution", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-matrix-"));
  try {
    const normalizedPath = path.join(runRoot, "normalized", "facts.json");
    await writeNormalizedFactsArtifact(normalizedPath, comparableFixture());
    const fromArtifact = await buildProviderMatrixFromArtifact(normalizedPath, { providers: [alpha, beta] });
    const direct = buildProviderMatrix(comparableFixture(), { providers: [alpha, beta] });
    assert.equal(JSON.stringify(fromArtifact), JSON.stringify(direct));

    const paths = await writeProviderMatrix(runRoot, fromArtifact);
    for (const filePath of Object.values(paths)) {
      assert.equal((await readFile(filePath, "utf8")).length > 0, true);
    }
    const report = await readFile(paths.reportPath, "utf8");
    assert.match(report, /Metric semantics/u);
    assert.match(report, /Conflict rows: 1/u);
    assert.match(report, /Unique comparable evidence/u);
    assert.match(report, /Disagreement details/u);
    assert.equal(renderProviderMatrixReport(fromArtifact), report);

    const persistedMatrix = JSON.parse(await readFile(paths.matrixPath, "utf8"));
    assert.equal("facts" in persistedMatrix, false);
    assert.equal("coverage" in persistedMatrix, false);
    assert.equal("overlap" in persistedMatrix, false);
    assert.equal("conflicts" in persistedMatrix, false);
    assert.equal("unmatched" in persistedMatrix, false);
    assert.equal(persistedMatrix.rowCounts.conflicts, fromArtifact.conflicts.length);
    assert.equal(persistedMatrix.rowCounts.total, fromArtifact.facts.length);

    const persistedConflicts = JSON.parse(await readFile(paths.conflictsPath, "utf8"));
    const conflictRow = persistedConflicts.conflicts[0];
    const conflictVariant = conflictRow.variants[0];
    assert.equal("path" in conflictVariant.subject, false);
    assert.equal("range" in conflictVariant.subject, false);
    assert.equal("kind" in conflictVariant.subject, false);
    assert.ok(Array.isArray(conflictVariant.factIds) && conflictVariant.factIds.length > 0);
    assert.equal(typeof conflictVariant.subject.nativeId, "string");

    const persistedNormalized = JSON.parse(await readFile(normalizedPath, "utf8"));
    const persistedFactIds = new Set(persistedNormalized.facts.map((fact: { factId: string }) => fact.factId));
    for (const factId of conflictVariant.factIds as readonly string[]) {
      assert.equal(persistedFactIds.has(factId), true);
    }
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("reports disjoint providers as no overlap while retaining incomparable evidence", () => {
  const normalized = normalizeFacts([
    observation(alpha, "reads", "alpha:isolated", "src/alpha.ts", "alpha-only", "alpha"),
    observation(beta, "reads", "beta:isolated", "src/beta.ts", "beta-only", "beta", "class"),
  ]);
  const matrix = buildProviderMatrix(normalized, { providers: [alpha, beta] });
  const pair = matrix.overlap.pairwise.find(
    (item) => item.left.id === "alpha" && item.right.id === "beta" && item.factClass === "reads",
  );
  assert.ok(pair);
  assert.equal(pair.overlapFactCount, 0);
  assert.equal(pair.conflictFactCount, 0);
  assert.equal(matrix.unmatched.unmatched.length, 2);
  assert.equal(matrix.generatedBy, "deterministic-rules");
});
