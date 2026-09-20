import {
  validateCandidateWorkingSet,
  type CandidateWorkingSet,
  type RepositoryIdentity,
  type WorkingSetTarget,
} from "./model.js";

/** Version of the pinned, offline Candidate Working Set quality corpus. */
export const WORKING_SET_QUALITY_CORPUS_SCHEMA_VERSION = 1 as const;
export type WorkingSetQualityCorpusSchemaVersion = typeof WORKING_SET_QUALITY_CORPUS_SCHEMA_VERSION;

export const WORKING_SET_QUALITY_CORPUS_KIND = "working-set-quality-corpus" as const;
export const WORKING_SET_QUALITY_REPORT_KIND = "working-set-quality-report" as const;

const QUALITY_TARGET_KINDS = ["file", "symbol", "test"] as const;
type QualityTargetKind = (typeof QUALITY_TARGET_KINDS)[number];

const MAX_CORPUS_CASES = 128;
const MAX_CORPUS_ID_LENGTH = 256;
const MAX_CASE_ID_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_TARGET_LOCATOR_LENGTH = 1024;

export interface WorkingSetQualityCaseInput {
  readonly caseId: string;
  readonly description: string;
  readonly revision: string;
  readonly candidate: unknown;
  readonly initialTargets: readonly unknown[];
  readonly legitimateTargets: readonly unknown[];
  readonly expansionTargets: readonly unknown[];
  readonly verificationTargets?: readonly unknown[];
  readonly pruning?: {
    readonly beforeTargets: readonly unknown[];
    readonly afterTargets: readonly unknown[];
  };
  readonly behavioralProxies?: {
    readonly observedExpansionTargets?: readonly unknown[];
    readonly observedReadTargets?: readonly unknown[];
    readonly observedVerificationTargets?: readonly unknown[];
  };
}

export interface WorkingSetQualityCase {
  readonly caseId: string;
  readonly description: string;
  readonly revision: string;
  readonly candidate: CandidateWorkingSet;
  readonly initialTargets: readonly WorkingSetTarget[];
  readonly legitimateTargets: readonly WorkingSetTarget[];
  readonly expansionTargets: readonly WorkingSetTarget[];
  readonly verificationTargets?: readonly WorkingSetTarget[];
  readonly pruning?: {
    readonly beforeTargets: readonly WorkingSetTarget[];
    readonly afterTargets: readonly WorkingSetTarget[];
  };
  /** Observations are deliberately kept outside objective labels and artifacts. */
  readonly behavioralProxies?: {
    readonly observedExpansionTargets?: readonly WorkingSetTarget[];
    readonly observedReadTargets?: readonly WorkingSetTarget[];
    readonly observedVerificationTargets?: readonly WorkingSetTarget[];
  };
}

export interface WorkingSetQualityCorpusInput {
  readonly kind?: typeof WORKING_SET_QUALITY_CORPUS_KIND;
  readonly schemaVersion?: WorkingSetQualityCorpusSchemaVersion;
  readonly corpusId: string;
  readonly repository: RepositoryIdentity;
  readonly revision: string;
  readonly cases: readonly WorkingSetQualityCaseInput[];
}

export interface WorkingSetQualityCorpus {
  readonly kind: typeof WORKING_SET_QUALITY_CORPUS_KIND;
  readonly schemaVersion: WorkingSetQualityCorpusSchemaVersion;
  readonly corpusId: string;
  readonly repository: RepositoryIdentity;
  readonly revision: string;
  readonly cases: readonly WorkingSetQualityCase[];
}

export interface WorkingSetQualityTargetMetric {
  readonly count: number;
  readonly denominator: number;
  readonly rate: number;
  readonly targets: readonly WorkingSetTarget[];
}

export interface WorkingSetQualityCountMetric {
  readonly count: number;
}

export interface WorkingSetQualityUnavailableMetric {
  readonly available: false;
  readonly reason: string;
}

export interface WorkingSetQualityPruningMetric {
  readonly available: true;
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly removedCount: number;
  readonly removedTargets: readonly WorkingSetTarget[];
  readonly legitimateRemovedCount: number;
  readonly overIncludedRemovedCount: number;
}

export interface WorkingSetQualityProviderMetric {
  readonly available: true;
  readonly candidateEntryCount: number;
  readonly providerAttributedEntryCount: number;
  readonly providerAttributedTargetCount: number;
  readonly contributionRate: number;
}

export interface WorkingSetQualityVerificationMetric {
  readonly available: true;
  readonly expectedCount: number;
  readonly candidateCount: number;
  readonly relevantCount: number;
  readonly missingCount: number;
  readonly irrelevantCount: number;
  readonly recall: number;
  readonly precision: number;
}

export interface WorkingSetQualityBehavioralMetric {
  readonly available: true;
  readonly observedCount: number;
  readonly observedTargets: readonly WorkingSetTarget[];
  readonly candidateOverlapCount: number;
  readonly legitimateOverlapCount: number;
  readonly outsideLegitimateCount: number;
}

export interface WorkingSetQualityObjectiveMetrics {
  readonly initialSetSize: WorkingSetQualityCountMetric;
  readonly missingLegitimateContext: WorkingSetQualityTargetMetric;
  readonly missingExpansions: WorkingSetQualityTargetMetric;
  readonly overInclusion: WorkingSetQualityTargetMetric;
  readonly unresolvedConflictRate: {
    readonly unresolvedCount: number;
    readonly candidateEntryCount: number;
    readonly rate: number;
  };
  readonly pruningEffect: WorkingSetQualityPruningMetric | WorkingSetQualityUnavailableMetric;
  readonly providerContribution: WorkingSetQualityProviderMetric | WorkingSetQualityUnavailableMetric;
  readonly verificationRelevance: WorkingSetQualityVerificationMetric | WorkingSetQualityUnavailableMetric;
}

export interface WorkingSetQualityBehavioralProxyMetrics {
  readonly expansionHistory: WorkingSetQualityBehavioralMetric | WorkingSetQualityUnavailableMetric;
  readonly readHistory: WorkingSetQualityBehavioralMetric | WorkingSetQualityUnavailableMetric;
  readonly verificationHistory: WorkingSetQualityBehavioralMetric | WorkingSetQualityUnavailableMetric;
}

export interface WorkingSetQualityCaseReport {
  readonly caseId: string;
  readonly description: string;
  readonly revision: string;
  readonly workingSetId: string;
  readonly objective: WorkingSetQualityObjectiveMetrics;
  readonly behavioralProxies: WorkingSetQualityBehavioralProxyMetrics;
}

export interface WorkingSetQualityObjectiveSummary {
  readonly caseCount: number;
  readonly initialSetSizeTotal: number;
  readonly missingLegitimateContextCount: number;
  readonly missingExpansionCount: number;
  readonly overInclusionCount: number;
  readonly unresolvedConflictCount: number;
  readonly unresolvedConflictDenominator: number;
  readonly unresolvedConflictRate: number;
  readonly pruningCasesWithEvidence: number;
  readonly pruningBeforeCount: number;
  readonly pruningAfterCount: number;
  readonly pruningRemovedCount: number;
  readonly providerCasesWithEvidence: number;
  readonly providerCandidateEntryCount: number;
  readonly providerAttributedEntryCount: number;
  readonly providerAttributedTargetCount: number;
  readonly providerContributionRate: number;
  readonly verificationCasesWithEvidence: number;
  readonly verificationExpectedCount: number;
  readonly verificationCandidateCount: number;
  readonly verificationRelevantCount: number;
  readonly verificationRecall: number;
  readonly verificationPrecision: number;
}

export interface WorkingSetQualityBehavioralProxySummary {
  readonly expansionHistoryCasesWithEvidence: number;
  readonly expansionHistoryObservedCount: number;
  readonly readHistoryCasesWithEvidence: number;
  readonly readHistoryObservedCount: number;
  readonly verificationHistoryCasesWithEvidence: number;
  readonly verificationHistoryObservedCount: number;
}

export interface WorkingSetQualityRepeatabilityMetric {
  readonly available: true;
  readonly runs: 2;
  readonly identical: boolean;
}

export interface WorkingSetQualityReport {
  readonly kind: typeof WORKING_SET_QUALITY_REPORT_KIND;
  readonly schemaVersion: WorkingSetQualityCorpusSchemaVersion;
  readonly corpusId: string;
  readonly repository: RepositoryIdentity;
  readonly revision: string;
  readonly cases: readonly WorkingSetQualityCaseReport[];
  readonly objective: {
    readonly summary: WorkingSetQualityObjectiveSummary;
    readonly repeatability: WorkingSetQualityRepeatabilityMetric;
  };
  readonly behavioralProxies: {
    readonly summary: WorkingSetQualityBehavioralProxySummary;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
}

function normalizeText(value: unknown, label: string, maxLength: number, allowWhitespace = false): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized) ||
    (!allowWhitespace && /\p{White_Space}/u.test(normalized))
  ) {
    throw new TypeError(`${label} is malformed or exceeds its bound`);
  }
  return normalized;
}

function normalizeRevision(value: unknown, label: string): string {
  const revision = normalizeText(value, label, 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(revision)) {
    throw new TypeError(`${label} must be a full immutable hexadecimal revision`);
  }
  return revision.toLowerCase();
}

function normalizeRepository(value: unknown): RepositoryIdentity {
  if (!isRecord(value)) throw new TypeError("quality repository must be an object");
  assertAllowedKeys(value, ["repositoryHost", "repositoryId", "repository"], "quality repository");
  return Object.freeze({
    repositoryHost: normalizeText(value.repositoryHost, "quality repository repositoryHost", 256),
    repositoryId: normalizeText(value.repositoryId, "quality repository repositoryId", 256),
    repository: normalizeText(value.repository, "quality repository repository", 256),
  });
}

function sameRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return (
    left.repositoryHost === right.repositoryHost &&
    left.repositoryId === right.repositoryId &&
    left.repository === right.repository
  );
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function targetKey(target: WorkingSetTarget): string {
  return `${target.kind}\u0000${target.locator}`;
}

function compareTargets(left: WorkingSetTarget, right: WorkingSetTarget): number {
  return compareText(targetKey(left), targetKey(right));
}

function normalizeTarget(value: unknown, label: string): WorkingSetTarget {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  assertAllowedKeys(value, ["kind", "locator"], label);
  if (!QUALITY_TARGET_KINDS.includes(value.kind as QualityTargetKind)) {
    throw new TypeError(`${label} must name a concrete target`);
  }
  return Object.freeze({
    kind: value.kind as QualityTargetKind,
    locator: normalizeText(value.locator, `${label} locator`, MAX_TARGET_LOCATOR_LENGTH, true),
  });
}

function normalizeTargetList(value: unknown, label: string): readonly WorkingSetTarget[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const unique = new Map<string, WorkingSetTarget>();
  for (const [index, target] of value.entries()) {
    const normalized = normalizeTarget(target, `${label} ${index}`);
    const key = targetKey(normalized);
    if (unique.has(key)) throw new TypeError(`${label} contains duplicate target: ${key}`);
    unique.set(key, normalized);
  }
  return Object.freeze([...unique.values()].sort(compareTargets));
}

function targetMap(targets: readonly WorkingSetTarget[]): ReadonlyMap<string, WorkingSetTarget> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}

function difference(
  left: readonly WorkingSetTarget[],
  right: readonly WorkingSetTarget[],
): readonly WorkingSetTarget[] {
  const rightKeys = new Set(right.map(targetKey));
  return left.filter((target) => !rightKeys.has(targetKey(target)));
}

function intersection(
  left: readonly WorkingSetTarget[],
  right: readonly WorkingSetTarget[],
): readonly WorkingSetTarget[] {
  const rightKeys = new Set(right.map(targetKey));
  return left.filter((target) => rightKeys.has(targetKey(target)));
}

function rate(count: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((count / denominator) * 10000) / 10000;
}

function normalizeOptionalTargets(
  value: unknown,
  label: string,
  required: boolean,
): readonly WorkingSetTarget[] | undefined {
  if (value === undefined && !required) return undefined;
  return normalizeTargetList(value, label);
}

function normalizeBehavioralProxies(value: unknown): WorkingSetQualityCase["behavioralProxies"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("quality behavioralProxies must be an object");
  assertAllowedKeys(
    value,
    ["observedExpansionTargets", "observedReadTargets", "observedVerificationTargets"],
    "quality behavioralProxies",
  );
  return Object.freeze({
    observedExpansionTargets: normalizeOptionalTargets(
      value.observedExpansionTargets,
      "observedExpansionTargets",
      false,
    ),
    observedReadTargets: normalizeOptionalTargets(value.observedReadTargets, "observedReadTargets", false),
    observedVerificationTargets: normalizeOptionalTargets(
      value.observedVerificationTargets,
      "observedVerificationTargets",
      false,
    ),
  });
}

function normalizePruning(value: unknown): WorkingSetQualityCase["pruning"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("quality pruning must be an object");
  assertAllowedKeys(value, ["beforeTargets", "afterTargets"], "quality pruning");
  const beforeTargets = normalizeTargetList(value.beforeTargets, "pruning beforeTargets");
  const afterTargets = normalizeTargetList(value.afterTargets, "pruning afterTargets");
  if (difference(afterTargets, beforeTargets).length > 0) {
    throw new TypeError("pruning afterTargets must be a subset of beforeTargets");
  }
  return Object.freeze({ beforeTargets, afterTargets });
}

function normalizeQualityCase(value: unknown, repository: RepositoryIdentity, revision: string): WorkingSetQualityCase {
  if (!isRecord(value)) throw new TypeError("quality case must be an object");
  assertAllowedKeys(
    value,
    [
      "caseId",
      "description",
      "revision",
      "candidate",
      "initialTargets",
      "legitimateTargets",
      "expansionTargets",
      "verificationTargets",
      "pruning",
      "behavioralProxies",
    ],
    "quality case",
  );
  const caseId = normalizeText(value.caseId, "quality case caseId", MAX_CASE_ID_LENGTH);
  const description = normalizeText(value.description, "quality case description", MAX_DESCRIPTION_LENGTH, true);
  const caseRevision = normalizeRevision(value.revision, `quality case ${caseId} revision`);
  if (caseRevision !== revision) throw new TypeError(`quality case ${caseId} is not bound to corpus revision`);

  const candidate = validateCandidateWorkingSet(value.candidate);
  if (candidate.revision !== revision) throw new TypeError(`quality case ${caseId} candidate revision is not pinned`);
  if (!sameRepository(candidate.repository, repository)) {
    throw new TypeError(`quality case ${caseId} candidate repository does not match corpus repository`);
  }

  const initialTargets = normalizeTargetList(value.initialTargets, `quality case ${caseId} initialTargets`);
  const legitimateTargets = normalizeTargetList(value.legitimateTargets, `quality case ${caseId} legitimateTargets`);
  const expansionTargets = normalizeTargetList(value.expansionTargets, `quality case ${caseId} expansionTargets`);
  if (difference(expansionTargets, legitimateTargets).length > 0) {
    throw new TypeError(`quality case ${caseId} expansionTargets must be legitimate context`);
  }
  if (intersection(expansionTargets, initialTargets).length > 0) {
    throw new TypeError(`quality case ${caseId} expansionTargets must be outside the initial set`);
  }
  const verificationTargets = normalizeOptionalTargets(
    value.verificationTargets,
    `quality case ${caseId} verificationTargets`,
    false,
  );
  if (verificationTargets?.some((target) => target.kind !== "test")) {
    throw new TypeError(`quality case ${caseId} verificationTargets must be test targets`);
  }

  return Object.freeze({
    caseId,
    description,
    revision: caseRevision,
    candidate,
    initialTargets,
    legitimateTargets,
    expansionTargets,
    verificationTargets,
    pruning: normalizePruning(value.pruning),
    behavioralProxies: normalizeBehavioralProxies(value.behavioralProxies),
  });
}

/** Parses and validates an immutable-revision-bound quality corpus manifest. */
export function parseWorkingSetQualityCorpus(value: unknown): WorkingSetQualityCorpus {
  if (!isRecord(value)) throw new TypeError("quality corpus must be an object");
  assertAllowedKeys(value, ["kind", "schemaVersion", "corpusId", "repository", "revision", "cases"], "quality corpus");
  if (value.kind !== undefined && value.kind !== WORKING_SET_QUALITY_CORPUS_KIND) {
    throw new TypeError("quality corpus kind is unsupported");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== WORKING_SET_QUALITY_CORPUS_SCHEMA_VERSION) {
    throw new TypeError("quality corpus schema version is unsupported");
  }
  const corpusId = normalizeText(value.corpusId, "quality corpus corpusId", MAX_CORPUS_ID_LENGTH);
  const repository = normalizeRepository(value.repository);
  const revision = normalizeRevision(value.revision, "quality corpus revision");
  if (!Array.isArray(value.cases)) throw new TypeError("quality corpus cases must be an array");
  if (value.cases.length > MAX_CORPUS_CASES) throw new TypeError("quality corpus cases exceed their bound");

  const cases = value.cases.map((entry) => normalizeQualityCase(entry, repository, revision));
  const caseIds = new Set<string>();
  for (const qualityCase of cases) {
    if (caseIds.has(qualityCase.caseId))
      throw new TypeError(`quality corpus contains duplicate case: ${qualityCase.caseId}`);
    caseIds.add(qualityCase.caseId);
  }
  cases.sort((left, right) => compareText(left.caseId, right.caseId));

  return Object.freeze({
    kind: WORKING_SET_QUALITY_CORPUS_KIND,
    schemaVersion: WORKING_SET_QUALITY_CORPUS_SCHEMA_VERSION,
    corpusId,
    repository,
    revision,
    cases: Object.freeze(cases),
  });
}

/** Alias for callers that construct a corpus in memory rather than parse JSON. */
export const createWorkingSetQualityCorpus = parseWorkingSetQualityCorpus;

function metricForTargets(targets: readonly WorkingSetTarget[], denominator: number): WorkingSetQualityTargetMetric {
  return Object.freeze({
    count: targets.length,
    denominator,
    rate: rate(targets.length, denominator),
    targets: Object.freeze([...targets]),
  });
}

function unavailable(reason: string): WorkingSetQualityUnavailableMetric {
  return Object.freeze({ available: false as const, reason });
}

function isProviderArtifact(artifact: string): boolean {
  return artifact === "provider" || artifact.startsWith("provider-");
}

function concreteCandidateTargets(candidate: CandidateWorkingSet): readonly WorkingSetTarget[] {
  const unique = new Map<string, WorkingSetTarget>();
  for (const entry of candidate.entries) {
    if (entry.target.kind !== "unresolved") unique.set(targetKey(entry.target), entry.target);
  }
  return [...unique.values()].sort(compareTargets);
}

function providerMetric(
  candidate: CandidateWorkingSet,
): WorkingSetQualityProviderMetric | WorkingSetQualityUnavailableMetric {
  const concreteEntries = candidate.entries.filter((entry) => entry.target.kind !== "unresolved");
  const providerEntries = concreteEntries.filter((entry) =>
    entry.evidence.some(({ artifact }) => isProviderArtifact(artifact)),
  );
  if (providerEntries.length === 0) return unavailable("candidate artifact has no provider attribution evidence");
  const providerTargets = new Map<string, WorkingSetTarget>();
  for (const entry of providerEntries) providerTargets.set(targetKey(entry.target), entry.target);
  return Object.freeze({
    available: true as const,
    candidateEntryCount: concreteEntries.length,
    providerAttributedEntryCount: providerEntries.length,
    providerAttributedTargetCount: providerTargets.size,
    contributionRate: rate(providerEntries.length, concreteEntries.length),
  });
}

function verificationMetric(
  qualityCase: WorkingSetQualityCase,
  candidateTargets: readonly WorkingSetTarget[],
): WorkingSetQualityVerificationMetric | WorkingSetQualityUnavailableMetric {
  const expectedTargets = qualityCase.verificationTargets;
  if (expectedTargets === undefined) return unavailable("corpus case has no verification relevance labels");
  const candidateVerificationTargets = candidateTargets.filter((target) => target.kind === "test");
  const relevantTargets = intersection(candidateVerificationTargets, expectedTargets);
  const missingTargets = difference(expectedTargets, candidateVerificationTargets);
  const irrelevantTargets = difference(candidateVerificationTargets, expectedTargets);
  return Object.freeze({
    available: true as const,
    expectedCount: expectedTargets.length,
    candidateCount: candidateVerificationTargets.length,
    relevantCount: relevantTargets.length,
    missingCount: missingTargets.length,
    irrelevantCount: irrelevantTargets.length,
    recall: rate(relevantTargets.length, expectedTargets.length),
    precision: rate(relevantTargets.length, candidateVerificationTargets.length),
  });
}

function pruningMetric(
  qualityCase: WorkingSetQualityCase,
  legitimateTargets: readonly WorkingSetTarget[],
): WorkingSetQualityPruningMetric | WorkingSetQualityUnavailableMetric {
  const pruning = qualityCase.pruning;
  if (pruning === undefined) return unavailable("corpus case has no before/after pruning evidence");
  const removedTargets = difference(pruning.beforeTargets, pruning.afterTargets);
  const overIncludedBeforePruning = difference(pruning.beforeTargets, legitimateTargets);
  return Object.freeze({
    available: true as const,
    beforeCount: pruning.beforeTargets.length,
    afterCount: pruning.afterTargets.length,
    removedCount: removedTargets.length,
    removedTargets: Object.freeze([...removedTargets]),
    legitimateRemovedCount: intersection(removedTargets, legitimateTargets).length,
    overIncludedRemovedCount: intersection(removedTargets, overIncludedBeforePruning).length,
  });
}

function behavioralMetric(
  observedTargets: readonly WorkingSetTarget[] | undefined,
  candidateTargets: readonly WorkingSetTarget[],
  legitimateTargets: readonly WorkingSetTarget[],
): WorkingSetQualityBehavioralMetric | WorkingSetQualityUnavailableMetric {
  if (observedTargets === undefined) return unavailable("corpus case has no tagged behavioral observation");
  return Object.freeze({
    available: true as const,
    observedCount: observedTargets.length,
    observedTargets: Object.freeze([...observedTargets]),
    candidateOverlapCount: intersection(observedTargets, candidateTargets).length,
    legitimateOverlapCount: intersection(observedTargets, legitimateTargets).length,
    outsideLegitimateCount: difference(observedTargets, legitimateTargets).length,
  });
}

function measureCase(qualityCase: WorkingSetQualityCase): WorkingSetQualityCaseReport {
  const candidateTargets = concreteCandidateTargets(qualityCase.candidate);
  const missingLegitimateContext = difference(qualityCase.legitimateTargets, candidateTargets);
  const missingExpansions = difference(qualityCase.expansionTargets, candidateTargets);
  const overIncluded = difference(candidateTargets, qualityCase.legitimateTargets);
  const unresolvedCount = qualityCase.candidate.entries.filter((entry) => entry.state === "unresolved").length;
  const providerContribution = providerMetric(qualityCase.candidate);
  const behavioral = qualityCase.behavioralProxies;

  return Object.freeze({
    caseId: qualityCase.caseId,
    description: qualityCase.description,
    revision: qualityCase.revision,
    workingSetId: qualityCase.candidate.workingSetId,
    objective: Object.freeze({
      initialSetSize: Object.freeze({ count: qualityCase.initialTargets.length }),
      missingLegitimateContext: metricForTargets(missingLegitimateContext, qualityCase.legitimateTargets.length),
      missingExpansions: metricForTargets(missingExpansions, qualityCase.expansionTargets.length),
      overInclusion: metricForTargets(overIncluded, candidateTargets.length),
      unresolvedConflictRate: Object.freeze({
        unresolvedCount,
        candidateEntryCount: qualityCase.candidate.entries.length,
        rate: rate(unresolvedCount, qualityCase.candidate.entries.length),
      }),
      pruningEffect: pruningMetric(qualityCase, qualityCase.legitimateTargets),
      providerContribution,
      verificationRelevance: verificationMetric(qualityCase, candidateTargets),
    }),
    behavioralProxies: Object.freeze({
      expansionHistory: behavioralMetric(
        behavioral?.observedExpansionTargets,
        candidateTargets,
        qualityCase.legitimateTargets,
      ),
      readHistory: behavioralMetric(behavioral?.observedReadTargets, candidateTargets, qualityCase.legitimateTargets),
      verificationHistory: behavioralMetric(
        behavioral?.observedVerificationTargets,
        candidateTargets,
        qualityCase.legitimateTargets,
      ),
    }),
  });
}

function sumAvailable<T extends { readonly available: true }>(
  metrics: readonly (T | WorkingSetQualityUnavailableMetric)[],
): readonly T[] {
  return metrics.filter((metric): metric is T => metric.available);
}

function buildCoreReport(corpus: WorkingSetQualityCorpus): Omit<WorkingSetQualityReport, "objective"> & {
  readonly objective: Omit<WorkingSetQualityReport["objective"], "repeatability">;
} {
  const cases = corpus.cases.map(measureCase);
  const objectives = cases.map(({ objective }) => objective);
  const pruning = sumAvailable(objectives.map(({ pruningEffect }) => pruningEffect));
  const providers = sumAvailable(objectives.map(({ providerContribution }) => providerContribution));
  const verification = sumAvailable(objectives.map(({ verificationRelevance }) => verificationRelevance));
  const proxies = cases.map(({ behavioralProxies }) => behavioralProxies);
  const expansionHistory = sumAvailable(proxies.map(({ expansionHistory: metric }) => metric));
  const readHistory = sumAvailable(proxies.map(({ readHistory: metric }) => metric));
  const verificationHistory = sumAvailable(proxies.map(({ verificationHistory: metric }) => metric));
  const unresolvedConflictCount = objectives.reduce(
    (sum, objective) => sum + objective.unresolvedConflictRate.unresolvedCount,
    0,
  );
  const unresolvedConflictDenominator = objectives.reduce(
    (sum, objective) => sum + objective.unresolvedConflictRate.candidateEntryCount,
    0,
  );
  const providerCandidateEntryCount = providers.reduce((sum, metric) => sum + metric.candidateEntryCount, 0);
  const providerAttributedEntryCount = providers.reduce((sum, metric) => sum + metric.providerAttributedEntryCount, 0);

  return {
    kind: WORKING_SET_QUALITY_REPORT_KIND,
    schemaVersion: WORKING_SET_QUALITY_CORPUS_SCHEMA_VERSION,
    corpusId: corpus.corpusId,
    repository: corpus.repository,
    revision: corpus.revision,
    cases: Object.freeze(cases),
    behavioralProxies: {
      summary: {
        expansionHistoryCasesWithEvidence: expansionHistory.length,
        expansionHistoryObservedCount: expansionHistory.reduce((sum, metric) => sum + metric.observedCount, 0),
        readHistoryCasesWithEvidence: readHistory.length,
        readHistoryObservedCount: readHistory.reduce((sum, metric) => sum + metric.observedCount, 0),
        verificationHistoryCasesWithEvidence: verificationHistory.length,
        verificationHistoryObservedCount: verificationHistory.reduce((sum, metric) => sum + metric.observedCount, 0),
      },
    },
    objective: {
      summary: {
        caseCount: cases.length,
        initialSetSizeTotal: objectives.reduce((sum, objective) => sum + objective.initialSetSize.count, 0),
        missingLegitimateContextCount: objectives.reduce(
          (sum, objective) => sum + objective.missingLegitimateContext.count,
          0,
        ),
        missingExpansionCount: objectives.reduce((sum, objective) => sum + objective.missingExpansions.count, 0),
        overInclusionCount: objectives.reduce((sum, objective) => sum + objective.overInclusion.count, 0),
        unresolvedConflictCount,
        unresolvedConflictDenominator,
        unresolvedConflictRate: rate(unresolvedConflictCount, unresolvedConflictDenominator),
        pruningCasesWithEvidence: pruning.length,
        pruningBeforeCount: pruning.reduce((sum, metric) => sum + metric.beforeCount, 0),
        pruningAfterCount: pruning.reduce((sum, metric) => sum + metric.afterCount, 0),
        pruningRemovedCount: pruning.reduce((sum, metric) => sum + metric.removedCount, 0),
        providerCasesWithEvidence: providers.length,
        providerCandidateEntryCount,
        providerAttributedEntryCount,
        providerAttributedTargetCount: providers.reduce((sum, metric) => sum + metric.providerAttributedTargetCount, 0),
        providerContributionRate: rate(providerAttributedEntryCount, providerCandidateEntryCount),
        verificationCasesWithEvidence: verification.length,
        verificationExpectedCount: verification.reduce((sum, metric) => sum + metric.expectedCount, 0),
        verificationCandidateCount: verification.reduce((sum, metric) => sum + metric.candidateCount, 0),
        verificationRelevantCount: verification.reduce((sum, metric) => sum + metric.relevantCount, 0),
        verificationRecall: rate(
          verification.reduce((sum, metric) => sum + metric.relevantCount, 0),
          verification.reduce((sum, metric) => sum + metric.expectedCount, 0),
        ),
        verificationPrecision: rate(
          verification.reduce((sum, metric) => sum + metric.relevantCount, 0),
          verification.reduce((sum, metric) => sum + metric.candidateCount, 0),
        ),
      },
    },
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("quality value is not serializable");
  return serialized;
}

/** Serializes a quality report with recursively sorted object keys. */
export function serializeWorkingSetQualityReport(report: WorkingSetQualityReport): string {
  return `${stableSerialize(report)}\n`;
}

/**
 * Measures only the supplied artifacts and labels. It never derives, prunes,
 * mutates, or promotes behavioral observations into Candidate Working Set data.
 */
export function measureWorkingSetQuality(value: unknown): WorkingSetQualityReport {
  const corpus = parseWorkingSetQualityCorpus(value);
  const first = buildCoreReport(corpus);
  const second = buildCoreReport(corpus);
  const repeatability = Object.freeze({
    available: true as const,
    runs: 2 as const,
    identical: stableSerialize(first) === stableSerialize(second),
  });
  return Object.freeze({
    ...first,
    objective: Object.freeze({ ...first.objective, repeatability }),
  }) as WorkingSetQualityReport;
}

/** Descriptive alias for callers measuring Candidate Working Set artifacts. */
export const measureCandidateWorkingSetQuality = measureWorkingSetQuality;
