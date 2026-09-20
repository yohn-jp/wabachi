import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { measureWorkingSetQuality, parseWorkingSetQualityCorpus, serializeWorkingSetQualityReport } from "./quality.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/quality-corpus-v1.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("quality corpus is pinned, normalized, and covers the required evidence classes", () => {
  const corpus = parseWorkingSetQualityCorpus(fixture);

  assert.equal(corpus.schemaVersion, 1);
  assert.match(corpus.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(
    corpus.cases.map((qualityCase) => qualityCase.caseId),
    ["over-inclusion-and-missing-context", "provider-conflict", "seed-expansion-and-verification"],
  );
  assert.ok(corpus.cases.every((qualityCase) => qualityCase.revision === corpus.revision));
  assert.ok(corpus.cases.every((qualityCase) => qualityCase.candidate.revision === corpus.revision));
});

test("measurement keeps objective metrics separate and reports each required dimension", () => {
  const report = measureWorkingSetQuality(fixture);
  const overInclusionCase = report.cases[0];
  const providerConflictCase = report.cases[1];
  const seedExpansionCase = report.cases[2];

  assert.equal(report.objective.summary.initialSetSizeTotal, 3);
  assert.equal(report.objective.summary.missingLegitimateContextCount, 2);
  assert.equal(report.objective.summary.missingExpansionCount, 2);
  assert.equal(report.objective.summary.overInclusionCount, 1);
  assert.equal(report.objective.summary.unresolvedConflictCount, 1);
  assert.equal(report.objective.summary.unresolvedConflictDenominator, 8);
  assert.equal(report.objective.summary.unresolvedConflictRate, 0.125);
  assert.equal(report.objective.summary.pruningCasesWithEvidence, 2);
  assert.equal(report.objective.summary.pruningRemovedCount, 2);
  assert.equal(report.objective.summary.providerCasesWithEvidence, 2);
  assert.equal(report.objective.summary.providerContributionRate, 0.4);
  assert.equal(report.objective.summary.verificationCasesWithEvidence, 2);
  assert.equal(report.objective.summary.verificationRecall, 0.5);
  assert.equal(report.objective.summary.verificationPrecision, 1);

  assert.equal(overInclusionCase?.objective.initialSetSize.count, 1);
  assert.equal(overInclusionCase?.objective.missingLegitimateContext.count, 2);
  assert.equal(overInclusionCase?.objective.missingExpansions.count, 2);
  assert.equal(overInclusionCase?.objective.overInclusion.count, 1);
  assert.equal(overInclusionCase?.objective.verificationRelevance.available, true);
  assert.equal(
    overInclusionCase?.objective.verificationRelevance.available &&
      overInclusionCase.objective.verificationRelevance.recall,
    0,
  );

  assert.equal(providerConflictCase?.objective.unresolvedConflictRate.rate, 0.3333);
  assert.equal(providerConflictCase?.objective.providerContribution.available, true);
  assert.equal(
    providerConflictCase?.objective.providerContribution.available &&
      providerConflictCase.objective.providerContribution.providerAttributedEntryCount,
    1,
  );
  assert.equal(providerConflictCase?.objective.verificationRelevance.available, false);

  assert.equal(seedExpansionCase?.objective.missingExpansions.count, 0);
  assert.equal(seedExpansionCase?.objective.verificationRelevance.available, true);
  assert.equal(
    seedExpansionCase?.objective.verificationRelevance.available &&
      seedExpansionCase.objective.verificationRelevance.recall,
    1,
  );
  assert.equal(report.objective.repeatability.identical, true);
  assert.equal("score" in report.objective, false);
});

test("behavioral observations are tagged proxies and cannot change objective measurement", () => {
  const withObservations = measureWorkingSetQuality(fixture);
  const withoutObservations = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown> & {
    cases: Array<Record<string, unknown>>;
  };
  for (const qualityCase of withoutObservations.cases) delete qualityCase.behavioralProxies;

  const proxyFreeReport = measureWorkingSetQuality(withoutObservations);
  assert.deepEqual(
    proxyFreeReport.cases.map((qualityCase) => qualityCase.objective),
    withObservations.cases.map((qualityCase) => qualityCase.objective),
  );
  assert.equal(proxyFreeReport.behavioralProxies.summary.expansionHistoryCasesWithEvidence, 0);
  assert.equal(withObservations.behavioralProxies.summary.expansionHistoryCasesWithEvidence, 3);
  assert.equal(withObservations.cases[0]?.behavioralProxies.expansionHistory.available, true);
});

test("measurement does not mutate Candidate Working Set artifacts and rejects revision drift", () => {
  const corpus = parseWorkingSetQualityCorpus(fixture);
  const before = corpus.cases.map((qualityCase) => JSON.stringify(qualityCase.candidate));
  measureWorkingSetQuality(corpus);
  assert.deepEqual(
    corpus.cases.map((qualityCase) => JSON.stringify(qualityCase.candidate)),
    before,
  );

  const drifted = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown> & {
    cases: Array<Record<string, unknown>>;
  };
  drifted.cases[0] = { ...drifted.cases[0], revision: "0000000000000000000000000000000000000000" };
  assert.throws(() => parseWorkingSetQualityCorpus(drifted), /not bound to corpus revision/);
});

test("quality report serialization is deterministic", () => {
  const first = measureWorkingSetQuality(fixture);
  const second = measureWorkingSetQuality(JSON.parse(JSON.stringify(fixture)));
  assert.equal(serializeWorkingSetQualityReport(first), serializeWorkingSetQualityReport(second));
});
