import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FACT_SCHEMA_VERSION,
  factEqualityKey,
  type FactEntityReference,
  type FactEnvelope,
  type FactComparison,
  type FactNormalizationResult,
  type FactObject,
  type UnsupportedProviderEvidence,
} from "./facts.js";
import type {
  CorrelationResult,
  CorrelationStatus,
  NormalizedSourceRange,
  ProviderCorrelationMetrics,
} from "./correlation.js";
import type { ProviderIdentity, ResolvedRepository } from "./provider.js";

/** Version of the deterministic Provider Matrix artifact. */
export const PROVIDER_MATRIX_SCHEMA_VERSION = 1 as const;
export type ProviderMatrixSchemaVersion = typeof PROVIDER_MATRIX_SCHEMA_VERSION;

/**
 * A matrix state describes the comparison result, not provider quality.
 * Correlation status is retained separately on every fact row.
 */
export type MatrixFactState = "overlap" | "provider-only" | "conflict" | "unsupported" | "ambiguous" | "unmatched";

export type MatrixProviderFactState = "present" | "missing" | "unsupported" | "ambiguous" | "unmatched";

export interface MatrixMetricDefinition {
  readonly id: string;
  readonly numerator: string;
  readonly denominator: string;
  readonly meaning: string;
}

export interface MatrixRatio {
  readonly numerator: number;
  readonly denominator: number;
  /** Null means the denominator is zero and the metric is not applicable. */
  readonly value: number | null;
}

export interface NormalizedFactsArtifact {
  readonly schemaVersion: typeof FACT_SCHEMA_VERSION;
  readonly facts: readonly FactEnvelope[];
  readonly unsupported: readonly UnsupportedProviderEvidence[];
  readonly correlation: CorrelationResult;
  /** Optional original #11 comparison projection, retained when persisted. */
  readonly comparisons?: readonly FactComparison[];
}

export interface ProviderMatrixOptions {
  /**
   * Providers expected in the matrix, including providers with no facts.
   * When omitted, providers are collected from facts, unsupported evidence,
   * correlation metrics, and then sorted by identity.
   */
  readonly providers?: readonly ProviderIdentity[];
  /**
   * Explicit order for the incremental information-gain experiment. If
   * omitted, the canonical provider identity order is used.
   */
  readonly additionOrder?: readonly ProviderIdentity[];
}

export interface MatrixEntityReference {
  readonly provider: ProviderIdentity;
  readonly nativeId: string;
  readonly kind: string;
  readonly canonicalId?: string;
  readonly candidateCanonicalIds: readonly string[];
  readonly correlationStatus: CorrelationStatus;
  readonly path?: string;
  readonly range?: NormalizedSourceRange;
}

export type MatrixFactObject =
  | { readonly kind: "entity"; readonly entity: MatrixEntityReference }
  | { readonly kind: "value"; readonly value: string };

export interface MatrixFactVariant {
  /** Exact normalized fact identity, or an evidence identity for unsupported records. */
  readonly key: string;
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly providers: readonly ProviderIdentity[];
  readonly subject: MatrixEntityReference;
  readonly predicate: string;
  readonly object: MatrixFactObject;
}

export interface MatrixProviderFactStatus {
  readonly provider: ProviderIdentity;
  readonly state: MatrixProviderFactState;
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface MatrixFactRecord {
  /** Stable row identity. */
  readonly key: string;
  /** Stable comparable subject/predicate identity when correlation permits it. */
  readonly logicalKey: string;
  readonly repository: ResolvedRepository;
  readonly factClass: string;
  readonly predicate: string;
  readonly state: MatrixFactState;
  readonly comparisonPossible: boolean;
  readonly correlationStatus: CorrelationStatus | "not-applicable";
  readonly variants: readonly MatrixFactVariant[];
  /** Includes an explicit missing state for every expected provider. */
  readonly providerStates: readonly MatrixProviderFactStatus[];
  readonly observedProviders: readonly ProviderIdentity[];
  readonly missingProviders: readonly ProviderIdentity[];
}

export interface MatrixFactCorrelationCounts {
  readonly matched: number;
  readonly probable: number;
  readonly correlated: number;
  readonly ambiguous: number;
  readonly unmatched: number;
  readonly matchedCoverage: MatrixRatio;
  readonly correlatedCoverage: MatrixRatio;
}

export interface MatrixEntityCorrelationCounts {
  readonly total: number;
  readonly matched: number;
  readonly probable: number;
  readonly correlated: number;
  readonly ambiguous: number;
  readonly unmatched: number;
  readonly matchedCoverage: MatrixRatio;
  readonly correlatedCoverage: MatrixRatio;
}

export interface FactClassCoverage {
  readonly factClass: string;
  /** Fact records plus unsupported provider evidence records. */
  readonly rawObservedFactCount: number;
  readonly normalizedFactCount: number;
  readonly unsupportedFactCount: number;
  readonly factCorrelation: MatrixFactCorrelationCounts;
  readonly normalizationCoverage: MatrixRatio;
  readonly uniqueFactCount: number;
  readonly uniqueCoverage: MatrixRatio;
  /** Distinct comparable logical fact keys observed by this provider only. */
  readonly uniqueFactKeys: readonly string[];
}

export interface ProviderCoverage extends FactClassCoverage {
  readonly provider: ProviderIdentity;
  readonly factClasses: readonly FactClassCoverage[];
  readonly entityCorrelation: MatrixEntityCorrelationCounts;
}

export interface PairwiseOverlap {
  readonly left: ProviderIdentity;
  readonly right: ProviderIdentity;
  readonly factClass: string;
  readonly leftComparableFactCount: number;
  readonly rightComparableFactCount: number;
  readonly comparedLogicalFactCount: number;
  /** Distinct exact comparable fact keys observed by both providers. */
  readonly overlapFactCount: number;
  /** Logical keys observed only by the left/right provider. */
  readonly leftOnlyFactCount: number;
  readonly rightOnlyFactCount: number;
  /** Logical keys where the two providers expose different exact values/relations. */
  readonly conflictFactCount: number;
  readonly overlapCoverage: MatrixRatio;
  readonly overlapFactKeys: readonly string[];
  readonly conflictLogicalKeys: readonly string[];
}

export interface AllProviderOverlap {
  readonly factClass: string;
  readonly providers: readonly ProviderIdentity[];
  readonly providerCount: number;
  readonly comparableFactUnionCount: number;
  /** Distinct exact comparable fact keys present for every selected provider. */
  readonly allProviderOverlapFactCount: number;
  readonly allProviderOverlapCoverage: MatrixRatio;
  readonly overlapFactKeys: readonly string[];
}

export interface ProviderMatrixOverlap {
  readonly pairwise: readonly PairwiseOverlap[];
  readonly allProviders: readonly AllProviderOverlap[];
  readonly facts: readonly MatrixFactRecord[];
}

export interface ProviderMatrixUnmatched {
  /** Rows whose entity correlation has competing candidates. */
  readonly ambiguous: readonly MatrixFactRecord[];
  /** Rows with no canonical entity identity. */
  readonly unmatched: readonly MatrixFactRecord[];
  /** Rows retained because the predicate has no normalized mapping. */
  readonly unsupported: readonly MatrixFactRecord[];
  readonly records: readonly MatrixFactRecord[];
}

export interface InformationGainClassCount {
  readonly factClass: string;
  readonly newComparableFactCount: number;
  readonly newComparableFactKeys: readonly string[];
}

export interface InformationGain {
  readonly provider: ProviderIdentity;
  /** Providers already present when this provider is added. */
  readonly existingProviders: readonly ProviderIdentity[];
  readonly newComparableFactCount: number;
  readonly newComparableFactKeys: readonly string[];
  readonly newFactClasses: readonly InformationGainClassCount[];
  readonly uniqueFactCount: number;
  readonly uniqueFactKeys: readonly string[];
  readonly informationGainCoverage: MatrixRatio;
  readonly newUnsupportedFactCount: number;
  readonly newUnsupportedEvidenceIds: readonly string[];
  readonly newAmbiguousFactCount: number;
  readonly newAmbiguousFactIds: readonly string[];
  readonly newUnmatchedFactCount: number;
  readonly newUnmatchedFactIds: readonly string[];
}

export interface ProviderMatrix {
  readonly schemaVersion: ProviderMatrixSchemaVersion;
  readonly inputFactSchemaVersion: typeof FACT_SCHEMA_VERSION;
  readonly generatedBy: "deterministic-rules";
  readonly repositories: readonly ResolvedRepository[];
  readonly providers: readonly ProviderIdentity[];
  readonly additionOrder: readonly ProviderIdentity[];
  readonly metricDefinitions: readonly MatrixMetricDefinition[];
  readonly coverage: readonly ProviderCoverage[];
  readonly overlap: ProviderMatrixOverlap;
  readonly conflicts: readonly MatrixFactRecord[];
  readonly unmatched: ProviderMatrixUnmatched;
  readonly informationGain: readonly InformationGain[];
  /** Complete row set; the derived artifact files are projections of this set. */
  readonly facts: readonly MatrixFactRecord[];
}

export interface ProviderMatrixArtifactPaths {
  readonly matrixPath: string;
  readonly coveragePath: string;
  readonly overlapPath: string;
  readonly conflictsPath: string;
  readonly unmatchedPath: string;
  readonly informationGainPath: string;
  readonly reportPath: string;
}

export const MATRIX_METRIC_DEFINITIONS: readonly MatrixMetricDefinition[] = [
  {
    id: "normalizationCoverage",
    numerator: "normalizedFactCount",
    denominator: "rawObservedFactCount",
    meaning:
      "Fraction of retained provider observations mapped to a common normalized predicate; null when no raw observation exists.",
  },
  {
    id: "matchedCoverage",
    numerator: "facts whose entity endpoints are all matched",
    denominator: "normalizedFactCount",
    meaning: "Fraction of normalized facts whose entity correlations are deterministic matches.",
  },
  {
    id: "correlationCoverage",
    numerator: "facts whose entity endpoints are matched or probable",
    denominator: "normalizedFactCount",
    meaning:
      "Fraction of normalized facts with a usable canonical entity identity; ambiguous and unmatched facts are excluded.",
  },
  {
    id: "pairwiseOverlap",
    numerator: "distinct exact comparable fact keys present in both providers",
    denominator: "minimum of the two providers' distinct comparable fact-key counts",
    meaning:
      "Exact normalized fact overlap; conflicting values are not counted as overlap unless the exact value is also shared.",
  },
  {
    id: "allProviderOverlap",
    numerator: "distinct exact comparable fact keys present in every selected provider",
    denominator: "distinct exact comparable fact keys in the selected-provider union",
    meaning:
      "Common evidence across the complete selected provider set; a provider with no fact makes the numerator zero.",
  },
  {
    id: "uniqueCoverage",
    numerator: "distinct comparable logical fact keys observed by exactly one provider",
    denominator: "that provider's distinct comparable logical fact keys",
    meaning:
      "Provider-only comparable coverage; conflicting values are not called unique because both providers observed the same logical fact.",
  },
  {
    id: "incrementalInformationGain",
    numerator: "new distinct exact comparable fact keys absent from the existing provider set",
    denominator: "the added provider's distinct comparable fact keys",
    meaning:
      "Deterministic gain for the explicitly recorded addition order; unsupported, ambiguous, and unmatched evidence is counted separately.",
  },
] as const;

interface FactDescriptor {
  readonly fact: FactEnvelope;
  readonly providerKey: string;
  readonly factClass: string;
  readonly exactKey: string;
  readonly logicalKey?: string;
  readonly correlationStatus: CorrelationStatus;
  readonly comparable: boolean;
}

interface UnsupportedDescriptor {
  readonly evidence: UnsupportedProviderEvidence;
  readonly providerKey: string;
  readonly factClass: string;
  readonly logicalKey?: string;
  readonly correlationStatus: CorrelationStatus;
  readonly comparable: boolean;
}

interface ProviderIdentityEntry {
  readonly key: string;
  readonly provider: ProviderIdentity;
}

interface ComparableFactSets {
  readonly byLogical: ReadonlyMap<string, ReadonlySet<string>>;
}

interface FactCorrelationAccumulator {
  matched: number;
  probable: number;
  ambiguous: number;
  unmatched: number;
}

/**
 * Builds all matrix views from normalized/persisted facts. It only consumes
 * artifacts; provider execution and observation generation are intentionally
 * outside this function.
 */
export function buildProviderMatrix(
  input: NormalizedFactsArtifact | FactNormalizationResult,
  options: ProviderMatrixOptions = {},
): ProviderMatrix {
  const artifact = input as NormalizedFactsArtifact;
  const entries = collectProviders(artifact, options);
  const providers = entries.map((entry) => entry.provider);
  const additionEntries = orderAdditions(entries, options.additionOrder);
  const additionOrder = additionEntries.map((entry) => entry.provider);
  const providerByKey = new Map(entries.map((entry) => [entry.key, entry.provider]));

  const facts = artifact.facts.map(toFactDescriptor).sort(compareFactDescriptors);
  const unsupported = artifact.unsupported.map(toUnsupportedDescriptor).sort(compareUnsupportedDescriptors);
  const rows = buildFactRows(facts, unsupported, entries);
  const factClasses = collectFactClasses(facts, unsupported);
  const uniqueLogicalProviders = indexLogicalProviders(facts);
  const coverage = providers.map((provider) =>
    buildProviderCoverage(provider, facts, unsupported, factClasses, uniqueLogicalProviders, artifact.correlation),
  );
  const overlap = buildOverlap(providers, entries, facts, factClasses, rows);
  const conflicts = rows.filter((row) => row.state === "conflict");
  const unmatchedRecords = rows.filter(
    (row) => row.state === "ambiguous" || row.state === "unmatched" || row.state === "unsupported",
  );
  const unmatched: ProviderMatrixUnmatched = {
    ambiguous: unmatchedRecords.filter((row) => row.state === "ambiguous"),
    unmatched: unmatchedRecords.filter((row) => row.state === "unmatched"),
    unsupported: unmatchedRecords.filter((row) => row.state === "unsupported"),
    records: unmatchedRecords,
  };
  const informationGain = buildInformationGain(
    additionEntries,
    facts,
    unsupported,
    coverage,
    factClasses,
    providerByKey,
  );

  return {
    schemaVersion: PROVIDER_MATRIX_SCHEMA_VERSION,
    inputFactSchemaVersion: FACT_SCHEMA_VERSION,
    generatedBy: "deterministic-rules",
    repositories: collectRepositories(facts, unsupported),
    providers,
    additionOrder,
    metricDefinitions: MATRIX_METRIC_DEFINITIONS,
    coverage,
    overlap,
    conflicts,
    unmatched,
    informationGain,
    facts: rows,
  };
}

/** Alias for callers that use the generation vocabulary. */
export const generateProviderMatrix = buildProviderMatrix;

function collectProviders(artifact: NormalizedFactsArtifact, options: ProviderMatrixOptions): ProviderIdentityEntry[] {
  const byKey = new Map<string, ProviderIdentity>();
  const add = (provider: ProviderIdentity): void => {
    byKey.set(providerKey(provider), provider);
  };
  for (const provider of options.providers ?? []) add(provider);
  for (const fact of artifact.facts) add(fact.provider);
  for (const evidence of artifact.unsupported) add(evidence.provider);
  for (const metric of Object.values(artifact.correlation.metrics)) add(metric.provider);
  return [...byKey.entries()].map(([key, provider]) => ({ key, provider })).sort(compareProviderEntries);
}

function orderAdditions(
  entries: readonly ProviderIdentityEntry[],
  requested: readonly ProviderIdentity[] | undefined,
): ProviderIdentityEntry[] {
  if (requested === undefined) return [...entries];
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const result: ProviderIdentityEntry[] = [];
  const seen = new Set<string>();
  for (const provider of requested) {
    const key = providerKey(provider);
    const entry = byKey.get(key);
    if (entry !== undefined && !seen.has(key)) {
      result.push(entry);
      seen.add(key);
    }
  }
  for (const entry of entries) {
    if (!seen.has(entry.key)) result.push(entry);
  }
  return result;
}

function toFactDescriptor(fact: FactEnvelope): FactDescriptor {
  const correlationStatus = factCorrelationStatus(fact);
  const comparable = correlationStatus === "matched" || correlationStatus === "probable";
  return {
    fact,
    providerKey: providerKey(fact.provider),
    factClass: fact.predicate,
    exactKey: factEqualityKey(fact),
    logicalKey: comparable ? logicalFactKey(fact) : undefined,
    correlationStatus,
    comparable,
  };
}

function toUnsupportedDescriptor(evidence: UnsupportedProviderEvidence): UnsupportedDescriptor {
  const correlationStatus = factCorrelationStatus(evidence);
  const comparable = correlationStatus === "matched" || correlationStatus === "probable";
  return {
    evidence,
    providerKey: providerKey(evidence.provider),
    factClass: evidence.predicate,
    logicalKey: comparable ? logicalFactKey(evidence) : undefined,
    correlationStatus,
    comparable,
  };
}

function buildFactRows(
  facts: readonly FactDescriptor[],
  unsupported: readonly UnsupportedDescriptor[],
  entries: readonly ProviderIdentityEntry[],
): MatrixFactRecord[] {
  const comparableGroups = new Map<string, FactDescriptor[]>();
  for (const descriptor of facts) {
    if (descriptor.logicalKey === undefined) continue;
    const group = comparableGroups.get(descriptor.logicalKey) ?? [];
    group.push(descriptor);
    comparableGroups.set(descriptor.logicalKey, group);
  }

  const rows: MatrixFactRecord[] = [];
  for (const [logicalKey, group] of comparableGroups) {
    rows.push(buildComparableRow(logicalKey, group, entries));
  }

  for (const descriptor of facts.filter((item) => !item.comparable)) {
    rows.push(buildUnresolvedFactRow(descriptor, entries));
  }

  const unsupportedGroups = new Map<string, UnsupportedDescriptor[]>();
  for (const descriptor of unsupported) {
    const key =
      descriptor.logicalKey === undefined
        ? "unsupported:" + descriptor.providerKey + ":" + descriptor.evidence.nativeEvidence.id
        : "unsupported:" + descriptor.logicalKey;
    const group = unsupportedGroups.get(key) ?? [];
    group.push(descriptor);
    unsupportedGroups.set(key, group);
  }
  for (const [key, group] of unsupportedGroups) {
    rows.push(buildUnsupportedRow(key, group, entries));
  }

  return rows.sort(compareMatrixRows);
}

function buildComparableRow(
  logicalKey: string,
  descriptors: readonly FactDescriptor[],
  entries: readonly ProviderIdentityEntry[],
): MatrixFactRecord {
  const variantsByKey = new Map<string, FactDescriptor[]>();
  for (const descriptor of descriptors) {
    const variant = variantsByKey.get(descriptor.exactKey) ?? [];
    variant.push(descriptor);
    variantsByKey.set(descriptor.exactKey, variant);
  }
  const variants = [...variantsByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => buildFactVariant(group));
  const observedProviders = uniqueProviders(descriptors.map((descriptor) => descriptor.fact.provider));
  const state: MatrixFactState =
    variants.length > 1 ? "conflict" : observedProviders.length > 1 ? "overlap" : "provider-only";
  const first = sortFactDescriptors(descriptors)[0];
  if (first === undefined) throw new Error("matrix comparable group cannot be empty");
  return makeRow({
    key: logicalKey,
    logicalKey,
    repository: first.fact.repository,
    factClass: first.factClass,
    predicate: first.fact.predicate,
    state,
    comparisonPossible: true,
    correlationStatus: descriptors.some((item) => item.correlationStatus === "probable") ? "probable" : "matched",
    variants,
    observedProviders,
    entries,
    stateForObserved: "present",
    evidenceForObserved: descriptors,
  });
}

function buildUnresolvedFactRow(
  descriptor: FactDescriptor,
  entries: readonly ProviderIdentityEntry[],
): MatrixFactRecord {
  const fact = descriptor.fact;
  const state: MatrixFactState = descriptor.correlationStatus === "ambiguous" ? "ambiguous" : "unmatched";
  return makeRow({
    key: "unresolved:" + descriptor.providerKey + ":" + fact.factId,
    logicalKey: "unresolved:" + factEqualityKey(fact),
    repository: fact.repository,
    factClass: fact.predicate,
    predicate: fact.predicate,
    state,
    comparisonPossible: false,
    correlationStatus: descriptor.correlationStatus,
    variants: [buildFactVariant([descriptor])],
    observedProviders: [fact.provider],
    entries,
    stateForObserved: state,
    evidenceForObserved: [descriptor],
  });
}

function buildUnsupportedRow(
  key: string,
  descriptors: readonly UnsupportedDescriptor[],
  entries: readonly ProviderIdentityEntry[],
): MatrixFactRecord {
  const ordered = sortUnsupportedDescriptors(descriptors);
  const first = ordered[0];
  if (first === undefined) throw new Error("matrix unsupported group cannot be empty");
  const observedProviders = uniqueProviders(ordered.map((descriptor) => descriptor.evidence.provider));
  const variants = ordered.map((descriptor) => buildUnsupportedVariant(descriptor));
  return makeRow({
    key,
    logicalKey: key,
    repository: first.evidence.repository,
    factClass: first.factClass,
    predicate: first.evidence.predicate,
    state: "unsupported",
    comparisonPossible: false,
    correlationStatus: first.comparable ? "not-applicable" : first.correlationStatus,
    variants,
    observedProviders,
    entries,
    stateForObserved: "unsupported",
    evidenceForObserved: ordered,
  });
}

interface RowInput {
  readonly key: string;
  readonly logicalKey: string;
  readonly repository: ResolvedRepository;
  readonly factClass: string;
  readonly predicate: string;
  readonly state: MatrixFactState;
  readonly comparisonPossible: boolean;
  readonly correlationStatus: CorrelationStatus | "not-applicable";
  readonly variants: readonly MatrixFactVariant[];
  readonly observedProviders: readonly ProviderIdentity[];
  readonly entries: readonly ProviderIdentityEntry[];
  readonly stateForObserved: MatrixProviderFactState;
  readonly evidenceForObserved: readonly (FactDescriptor | UnsupportedDescriptor)[];
}

function makeRow(input: RowInput): MatrixFactRecord {
  const observedKeys = new Set(input.observedProviders.map(providerKey));
  const evidenceByProvider = new Map<string, { factIds: string[]; evidenceIds: string[] }>();
  for (const item of input.evidenceForObserved) {
    const provider = "fact" in item ? item.fact.provider : item.evidence.provider;
    const key = providerKey(provider);
    const value = evidenceByProvider.get(key) ?? { factIds: [], evidenceIds: [] };
    if ("fact" in item) {
      value.factIds.push(item.fact.factId);
      value.evidenceIds.push(item.fact.nativeEvidence.id);
    } else {
      value.evidenceIds.push(item.evidence.nativeEvidence.id);
    }
    evidenceByProvider.set(key, value);
  }
  const providerStates = input.entries.map((entry) => {
    const evidence = evidenceByProvider.get(entry.key);
    return {
      provider: entry.provider,
      state: observedKeys.has(entry.key) ? input.stateForObserved : ("missing" as const),
      factIds: [...new Set(evidence?.factIds ?? [])].sort(),
      evidenceIds: [...new Set(evidence?.evidenceIds ?? [])].sort(),
    };
  });
  return {
    key: input.key,
    logicalKey: input.logicalKey,
    repository: input.repository,
    factClass: input.factClass,
    predicate: input.predicate,
    state: input.state,
    comparisonPossible: input.comparisonPossible,
    correlationStatus: input.correlationStatus,
    variants: [...input.variants].sort(compareVariants),
    providerStates,
    observedProviders: [...input.observedProviders].sort(compareProviders),
    missingProviders: input.entries.filter((entry) => !observedKeys.has(entry.key)).map((entry) => entry.provider),
  };
}

function buildFactVariant(descriptors: readonly FactDescriptor[]): MatrixFactVariant {
  const ordered = sortFactDescriptors(descriptors);
  const first = ordered[0];
  if (first === undefined) throw new Error("matrix fact variant cannot be empty");
  return {
    key: first.exactKey,
    factIds: [...new Set(ordered.map((descriptor) => descriptor.fact.factId))].sort(),
    evidenceIds: [...new Set(ordered.map((descriptor) => descriptor.fact.nativeEvidence.id))].sort(),
    providers: uniqueProviders(ordered.map((descriptor) => descriptor.fact.provider)),
    subject: toMatrixEntity(first.fact.subject),
    predicate: first.fact.predicate,
    object: toMatrixObject(first.fact.object),
  };
}

function buildUnsupportedVariant(descriptor: UnsupportedDescriptor): MatrixFactVariant {
  const evidence = descriptor.evidence;
  return {
    key: "unsupported:" + evidence.nativeEvidence.id,
    factIds: [],
    evidenceIds: [evidence.nativeEvidence.id],
    providers: [evidence.provider],
    subject: toMatrixEntity(evidence.subject),
    predicate: evidence.predicate,
    object: toMatrixObject(evidence.object),
  };
}

function toMatrixEntity(entity: FactEntityReference): MatrixEntityReference {
  return {
    provider: entity.provider,
    nativeId: entity.nativeId,
    kind: entity.kind,
    ...(entity.canonicalId === undefined ? {} : { canonicalId: entity.canonicalId }),
    candidateCanonicalIds: [...entity.candidateCanonicalIds].sort(),
    correlationStatus: entity.correlationStatus,
    ...(entity.path === undefined ? {} : { path: entity.path }),
    ...(entity.range === undefined ? {} : { range: entity.range }),
  };
}

function toMatrixObject(object: FactObject): MatrixFactObject {
  if ("nativeId" in object) return { kind: "entity", entity: toMatrixEntity(object) };
  return { kind: "value", value: object.value };
}

function buildProviderCoverage(
  provider: ProviderIdentity,
  facts: readonly FactDescriptor[],
  unsupported: readonly UnsupportedDescriptor[],
  factClasses: readonly string[],
  uniqueLogicalProviders: ReadonlyMap<string, ReadonlySet<string>>,
  correlation: CorrelationResult,
): ProviderCoverage {
  const providerKeyValue = providerKey(provider);
  const providerFacts = facts.filter((descriptor) => descriptor.providerKey === providerKeyValue);
  const providerUnsupported = unsupported.filter((descriptor) => descriptor.providerKey === providerKeyValue);
  const factCorrelation = countFactCorrelation(providerFacts);
  const rawObservedFactCount = providerFacts.length + providerUnsupported.length;
  const uniqueFactKeys = uniqueKeysForProvider(providerFacts, uniqueLogicalProviders);
  const factClassCoverage = factClasses.map((factClass) => {
    const classFacts = providerFacts.filter((descriptor) => descriptor.factClass === factClass);
    const classUnsupported = providerUnsupported.filter((descriptor) => descriptor.factClass === factClass);
    const classCorrelation = countFactCorrelation(classFacts);
    const classUniqueFactKeys = uniqueKeysForProvider(classFacts, uniqueLogicalProviders);
    return {
      factClass,
      rawObservedFactCount: classFacts.length + classUnsupported.length,
      normalizedFactCount: classFacts.length,
      unsupportedFactCount: classUnsupported.length,
      factCorrelation: classCorrelation,
      normalizationCoverage: ratio(classFacts.length, classFacts.length + classUnsupported.length),
      uniqueFactCount: classUniqueFactKeys.length,
      uniqueCoverage: ratio(classUniqueFactKeys.length, comparableLogicalFactCount(classFacts)),
      uniqueFactKeys: classUniqueFactKeys,
    };
  });
  const entity = findCorrelationMetric(provider, correlation);
  const entityCorrelation = toEntityCorrelationCounts(entity);
  return {
    provider,
    factClass: "__all__",
    rawObservedFactCount,
    normalizedFactCount: providerFacts.length,
    unsupportedFactCount: providerUnsupported.length,
    factCorrelation,
    normalizationCoverage: ratio(providerFacts.length, rawObservedFactCount),
    uniqueFactCount: uniqueFactKeys.length,
    uniqueCoverage: ratio(uniqueFactKeys.length, comparableLogicalFactCount(providerFacts)),
    uniqueFactKeys,
    factClasses: factClassCoverage,
    entityCorrelation,
  };
}

function countFactCorrelation(facts: readonly FactDescriptor[]): MatrixFactCorrelationCounts {
  const counts: FactCorrelationAccumulator = { matched: 0, probable: 0, ambiguous: 0, unmatched: 0 };
  for (const descriptor of facts) counts[descriptor.correlationStatus] += 1;
  const correlated = counts.matched + counts.probable;
  return {
    ...counts,
    correlated,
    matchedCoverage: ratio(counts.matched, facts.length),
    correlatedCoverage: ratio(correlated, facts.length),
  };
}

function uniqueKeysForProvider(
  facts: readonly FactDescriptor[],
  uniqueLogicalProviders: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  if (facts.length === 0) return [];
  return [
    ...new Set(
      facts
        .filter((descriptor) => descriptor.comparable && descriptor.logicalKey !== undefined)
        .filter((descriptor) => uniqueLogicalProviders.get(descriptor.logicalKey ?? "")?.size === 1)
        .map((descriptor) => descriptor.logicalKey as string),
    ),
  ].sort();
}

function comparableLogicalFactCount(facts: readonly FactDescriptor[]): number {
  return new Set(
    facts
      .filter((descriptor) => descriptor.comparable && descriptor.logicalKey !== undefined)
      .map((descriptor) => descriptor.logicalKey as string),
  ).size;
}

function toEntityCorrelationCounts(metric: ProviderCorrelationMetrics | undefined): MatrixEntityCorrelationCounts {
  const total = metric?.total ?? 0;
  const matched = metric?.matched ?? 0;
  const probable = metric?.probable ?? 0;
  const ambiguous = metric?.ambiguous ?? 0;
  const unmatched = metric?.unmatched ?? 0;
  return {
    total,
    matched,
    probable,
    correlated: matched + probable,
    ambiguous,
    unmatched,
    matchedCoverage: ratio(matched, total),
    correlatedCoverage: ratio(matched + probable, total),
  };
}

function findCorrelationMetric(
  provider: ProviderIdentity,
  correlation: CorrelationResult,
): ProviderCorrelationMetrics | undefined {
  const expected = providerKey(provider);
  return Object.values(correlation.metrics).find((metric) => providerKey(metric.provider) === expected);
}

function buildOverlap(
  providers: readonly ProviderIdentity[],
  entries: readonly ProviderIdentityEntry[],
  facts: readonly FactDescriptor[],
  factClasses: readonly string[],
  rows: readonly MatrixFactRecord[],
): ProviderMatrixOverlap {
  const pairwise: PairwiseOverlap[] = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex];
      const right = entries[rightIndex];
      for (const factClass of factClasses) {
        pairwise.push(buildPairwiseOverlap(left, right, factClass, facts));
      }
    }
  }
  const allProviders = factClasses.map((factClass) => buildAllProviderOverlap(providers, entries, factClass, facts));
  return {
    pairwise: pairwise.sort(comparePairwiseOverlap),
    allProviders: allProviders.sort((left, right) => left.factClass.localeCompare(right.factClass)),
    facts: rows.filter((row) => row.state === "overlap"),
  };
}

function buildPairwiseOverlap(
  left: ProviderIdentityEntry,
  right: ProviderIdentityEntry,
  factClass: string,
  facts: readonly FactDescriptor[],
): PairwiseOverlap {
  const leftSets = comparableFactSets(facts, left.key, factClass);
  const rightSets = comparableFactSets(facts, right.key, factClass);
  const logicalKeys = new Set([...leftSets.byLogical.keys(), ...rightSets.byLogical.keys()]);
  const overlapFactKeys = intersection(exactKeys(leftSets.byLogical), exactKeys(rightSets.byLogical));
  const leftOnly = [...leftSets.byLogical.keys()].filter((key) => !rightSets.byLogical.has(key)).sort();
  const rightOnly = [...rightSets.byLogical.keys()].filter((key) => !leftSets.byLogical.has(key)).sort();
  const conflictLogicalKeys = [...leftSets.byLogical.keys()]
    .filter((key) => rightSets.byLogical.has(key))
    .filter((key) => !setsEqual(leftSets.byLogical.get(key) ?? new Set(), rightSets.byLogical.get(key) ?? new Set()))
    .sort();
  const leftCount = exactKeys(leftSets.byLogical).length;
  const rightCount = exactKeys(rightSets.byLogical).length;
  return {
    left: left.provider,
    right: right.provider,
    factClass,
    leftComparableFactCount: leftCount,
    rightComparableFactCount: rightCount,
    comparedLogicalFactCount: [...logicalKeys].filter(
      (key) => leftSets.byLogical.has(key) && rightSets.byLogical.has(key),
    ).length,
    overlapFactCount: overlapFactKeys.length,
    leftOnlyFactCount: leftOnly.length,
    rightOnlyFactCount: rightOnly.length,
    conflictFactCount: conflictLogicalKeys.length,
    overlapCoverage: ratio(overlapFactKeys.length, Math.min(leftCount, rightCount)),
    overlapFactKeys,
    conflictLogicalKeys,
  };
}

function buildAllProviderOverlap(
  providers: readonly ProviderIdentity[],
  entries: readonly ProviderIdentityEntry[],
  factClass: string,
  facts: readonly FactDescriptor[],
): AllProviderOverlap {
  const exactSets = entries.map((entry) => comparableFactSets(facts, entry.key, factClass));
  const exactKeySets = exactSets.map((set) => new Set(exactKeys(set.byLogical)));
  const union = new Set<string>();
  for (const keys of exactKeySets) for (const key of keys) union.add(key);
  const overlap =
    entries.length === 0
      ? []
      : [...union].filter((key) => exactKeySets.every((keys) => keys.has(key))).sort();
  return {
    factClass,
    providers,
    providerCount: providers.length,
    comparableFactUnionCount: union.size,
    allProviderOverlapFactCount: overlap.length,
    allProviderOverlapCoverage: ratio(overlap.length, union.size),
    overlapFactKeys: overlap,
  };
}

function comparableFactSets(facts: readonly FactDescriptor[], provider: string, factClass: string): ComparableFactSets {
  const byLogical = new Map<string, Set<string>>();
  for (const descriptor of facts) {
    if (!descriptor.comparable || descriptor.providerKey !== provider || descriptor.factClass !== factClass) continue;
    if (descriptor.logicalKey === undefined) continue;
    const values = byLogical.get(descriptor.logicalKey) ?? new Set<string>();
    values.add(descriptor.exactKey);
    byLogical.set(descriptor.logicalKey, values);
  }
  return { byLogical };
}

function buildInformationGain(
  additionEntries: readonly ProviderIdentityEntry[],
  facts: readonly FactDescriptor[],
  unsupported: readonly UnsupportedDescriptor[],
  coverage: readonly ProviderCoverage[],
  factClasses: readonly string[],
  providerByKey: ReadonlyMap<string, ProviderIdentity>,
): InformationGain[] {
  const baseline = new Set<string>();
  const result: InformationGain[] = [];
  for (const entry of additionEntries) {
    const providerFacts = facts.filter((descriptor) => descriptor.providerKey === entry.key && descriptor.comparable);
    const exactKeysForProvider = [...new Set(providerFacts.map((descriptor) => descriptor.exactKey))].sort();
    const newComparableFactKeys = exactKeysForProvider.filter((key) => !baseline.has(key));
    const newComparableFactKeySet = new Set(newComparableFactKeys);
    const classCounts = factClasses
      .map((factClass) => {
        const classKeys = new Set(
          providerFacts
            .filter((descriptor) => descriptor.factClass === factClass)
            .map((descriptor) => descriptor.exactKey),
        );
        const newKeys = [...classKeys].filter((key) => newComparableFactKeySet.has(key)).sort();
        return { factClass, newComparableFactCount: newKeys.length, newComparableFactKeys: newKeys };
      })
      .filter((item) => item.newComparableFactCount > 0);
    for (const key of exactKeysForProvider) baseline.add(key);

    const providerCoverage = coverage.find((item) => providerKey(item.provider) === entry.key);
    const providerUnsupported = unsupported.filter((item) => item.providerKey === entry.key);
    const providerAmbiguous = facts.filter(
      (item) => item.providerKey === entry.key && item.correlationStatus === "ambiguous",
    );
    const providerUnmatched = facts.filter(
      (item) => item.providerKey === entry.key && item.correlationStatus === "unmatched",
    );
    const entryIndex = additionEntries.findIndex((item) => item.key === entry.key);
    const existingProviders = additionEntries.slice(0, entryIndex).map((item) => item.provider);
    const normalizedProvider = providerByKey.get(entry.key) ?? entry.provider;
    result.push({
      provider: normalizedProvider,
      existingProviders,
      newComparableFactCount: newComparableFactKeys.length,
      newComparableFactKeys,
      newFactClasses: classCounts,
      uniqueFactCount: providerCoverage?.uniqueFactCount ?? 0,
      uniqueFactKeys: providerCoverage?.uniqueFactKeys ?? [],
      informationGainCoverage: ratio(
        newComparableFactKeys.length,
        new Set(providerFacts.map((descriptor) => descriptor.exactKey)).size,
      ),
      newUnsupportedFactCount: providerUnsupported.length,
      newUnsupportedEvidenceIds: providerUnsupported.map((item) => item.evidence.nativeEvidence.id).sort(),
      newAmbiguousFactCount: providerAmbiguous.length,
      newAmbiguousFactIds: providerAmbiguous.map((item) => item.fact.factId).sort(),
      newUnmatchedFactCount: providerUnmatched.length,
      newUnmatchedFactIds: providerUnmatched.map((item) => item.fact.factId).sort(),
    });
  }
  return result;
}

function factCorrelationStatus(value: FactEnvelope | UnsupportedProviderEvidence): CorrelationStatus {
  const entities = [value.subject, ...("nativeId" in value.object ? [value.object] : [])];
  if (entities.some((entity) => entity.correlationStatus === "ambiguous")) return "ambiguous";
  if (entities.some((entity) => entity.correlationStatus === "unmatched" || entity.canonicalId === undefined)) {
    return "unmatched";
  }
  if (entities.every((entity) => entity.correlationStatus === "matched")) return "matched";
  return "probable";
}

function logicalFactKey(value: FactEnvelope | UnsupportedProviderEvidence): string {
  const subject = value.subject.canonicalId;
  if (subject === undefined) throw new Error("logical fact key requires a canonical subject");
  return stableSerialize({ repository: value.repository, subject, predicate: value.predicate });
}

function indexLogicalProviders(facts: readonly FactDescriptor[]): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const descriptor of facts) {
    if (!descriptor.comparable || descriptor.logicalKey === undefined) continue;
    const providers = result.get(descriptor.logicalKey) ?? new Set<string>();
    providers.add(descriptor.providerKey);
    result.set(descriptor.logicalKey, providers);
  }
  return result;
}

function collectFactClasses(facts: readonly FactDescriptor[], unsupported: readonly UnsupportedDescriptor[]): string[] {
  return [...new Set([...facts.map((fact) => fact.factClass), ...unsupported.map((item) => item.factClass)])].sort();
}

function collectRepositories(
  facts: readonly FactDescriptor[],
  unsupported: readonly UnsupportedDescriptor[],
): ResolvedRepository[] {
  const values = [...facts.map((item) => item.fact.repository), ...unsupported.map((item) => item.evidence.repository)];
  const byKey = new Map<string, ResolvedRepository>();
  for (const repository of values) byKey.set(stableSerialize(repository), repository);
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function ratio(numerator: number, denominator: number): MatrixRatio {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function providerKey(provider: ProviderIdentity): string {
  return provider.id + "\u0000" + provider.version + "\u0000" + provider.determinism;
}

function compareProviderEntries(left: ProviderIdentityEntry, right: ProviderIdentityEntry): number {
  return left.key.localeCompare(right.key);
}

function compareProviders(left: ProviderIdentity, right: ProviderIdentity): number {
  return providerKey(left).localeCompare(providerKey(right));
}

function compareFactDescriptors(left: FactDescriptor, right: FactDescriptor): number {
  const key = left.exactKey.localeCompare(right.exactKey);
  if (key !== 0) return key;
  const provider = left.providerKey.localeCompare(right.providerKey);
  if (provider !== 0) return provider;
  return left.fact.factId.localeCompare(right.fact.factId);
}

function sortFactDescriptors(values: readonly FactDescriptor[]): FactDescriptor[] {
  return [...values].sort(compareFactDescriptors);
}

function compareUnsupportedDescriptors(left: UnsupportedDescriptor, right: UnsupportedDescriptor): number {
  const leftKey = stableSerialize({
    predicate: left.factClass,
    provider: left.providerKey,
    evidence: left.evidence.nativeEvidence.id,
  });
  const rightKey = stableSerialize({
    predicate: right.factClass,
    provider: right.providerKey,
    evidence: right.evidence.nativeEvidence.id,
  });
  return leftKey.localeCompare(rightKey);
}

function sortUnsupportedDescriptors(values: readonly UnsupportedDescriptor[]): UnsupportedDescriptor[] {
  return [...values].sort(compareUnsupportedDescriptors);
}

function compareMatrixRows(left: MatrixFactRecord, right: MatrixFactRecord): number {
  const repository = stableSerialize(left.repository).localeCompare(stableSerialize(right.repository));
  if (repository !== 0) return repository;
  const factClass = left.factClass.localeCompare(right.factClass);
  if (factClass !== 0) return factClass;
  return left.key.localeCompare(right.key);
}

function compareVariants(left: MatrixFactVariant, right: MatrixFactVariant): number {
  return left.key.localeCompare(right.key);
}

function comparePairwiseOverlap(left: PairwiseOverlap, right: PairwiseOverlap): number {
  const provider = providerKey(left.left).localeCompare(providerKey(right.left));
  if (provider !== 0) return provider;
  const rightProvider = providerKey(left.right).localeCompare(providerKey(right.right));
  if (rightProvider !== 0) return rightProvider;
  return left.factClass.localeCompare(right.factClass);
}

function uniqueProviders(values: readonly ProviderIdentity[]): ProviderIdentity[] {
  const byKey = new Map<string, ProviderIdentity>();
  for (const provider of values) byKey.set(providerKey(provider), provider);
  return [...byKey.values()].sort(compareProviders);
}

function exactKeys(byLogical: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return [...new Set([...byLogical.values()].flatMap((values) => [...values]))].sort();
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => rightSet.has(value)).sort();
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return value.toString() + "n";
  if (Array.isArray(value)) return "[" + value.map((item) => stableSerialize(item)).join(",") + "]";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableSerialize(record[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(String(value));
}

/** Renders the matrix without consulting a model or changing any matrix state. */
export function renderProviderMatrixReport(matrix: ProviderMatrix): string {
  const codeMark = String.fromCharCode(96);
  const lines: string[] = [
    "# Provider Matrix",
    "",
    "Generated by deterministic rules from persisted normalized fact evidence.",
    "",
    "## Revision",
    "",
    matrix.repositories.length === 0
      ? "No repository revision was present in the supplied fact artifact."
      : matrix.repositories
          .map((repository) => "- " + repository.source + " @ " + codeMark + repository.commitSha + codeMark)
          .join("\n"),
    "",
    "## Metric semantics",
    "",
    "| Metric | Numerator | Denominator | Meaning |",
    "| --- | --- | --- | --- |",
    ...matrix.metricDefinitions.map(
      (definition) =>
        "| " +
        escapeMarkdown(definition.id) +
        " | " +
        escapeMarkdown(definition.numerator) +
        " | " +
        escapeMarkdown(definition.denominator) +
        " | " +
        escapeMarkdown(definition.meaning) +
        " |",
    ),
    "",
    "## Provider coverage",
    "",
    "| Provider | Raw observed | Normalized | Unsupported | Normalization | Correlated | Ambiguous | Unmatched |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...matrix.coverage.map(
      (coverage) =>
        "| " +
        escapeMarkdown(providerLabel(coverage.provider)) +
        " | " +
        coverage.rawObservedFactCount +
        " | " +
        coverage.normalizedFactCount +
        " | " +
        coverage.unsupportedFactCount +
        " | " +
        formatRatio(coverage.normalizationCoverage) +
        " | " +
        coverage.factCorrelation.correlated +
        " (" +
        formatRatio(coverage.factCorrelation.correlatedCoverage) +
        ") | " +
        coverage.factCorrelation.ambiguous +
        " | " +
        coverage.factCorrelation.unmatched +
        " |",
    ),
    "",
    "### Coverage by normalized fact class",
    "",
    "| Provider | Fact class | Raw | Normalized | Unsupported | Correlated | Unique logical facts | Unique coverage |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...matrix.coverage.flatMap((coverage) =>
      coverage.factClasses.map(
        (item) =>
          "| " +
          escapeMarkdown(providerLabel(coverage.provider)) +
          " | " +
          codeMark +
          escapeMarkdown(item.factClass) +
          codeMark +
          " | " +
          item.rawObservedFactCount +
          " | " +
          item.normalizedFactCount +
          " | " +
          item.unsupportedFactCount +
          " | " +
          item.factCorrelation.correlated +
          " (" +
          formatRatio(item.factCorrelation.correlatedCoverage) +
          ") | " +
          item.uniqueFactCount +
          " | " +
          formatRatio(item.uniqueCoverage) +
          " |",
      ),
    ),
    "",
    "## Unique information and incremental gain",
    "",
    "Unique means a comparable logical fact key observed by exactly one provider; it is not a quality ranking.",
    "",
    "| Added provider | Existing set | New comparable facts | Gain coverage | Unique comparable facts | Ambiguous | Unmatched | Unsupported |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...matrix.informationGain.map(
      (gain) =>
        "| " +
        escapeMarkdown(providerLabel(gain.provider)) +
        " | " +
        (gain.existingProviders.length === 0
          ? "∅"
          : gain.existingProviders.map(providerLabel).map(escapeMarkdown).join(", ")) +
        " | " +
        gain.newComparableFactCount +
        " | " +
        formatRatio(gain.informationGainCoverage) +
        " | " +
        gain.uniqueFactCount +
        " | " +
        gain.newAmbiguousFactCount +
        " | " +
        gain.newUnmatchedFactCount +
        " | " +
        gain.newUnsupportedFactCount +
        " |",
    ),
    "",
    "## Overlap and conflicts",
    "",
    ...renderOverlapSummary(matrix),
    "",
    "## Incomparable evidence",
    "",
    "- Ambiguous correlation rows: " + matrix.unmatched.ambiguous.length,
    "- Unmatched correlation rows: " + matrix.unmatched.unmatched.length,
    "- Unsupported predicate rows: " + matrix.unmatched.unsupported.length,
    "",
  ];
  return lines.join("\n") + "\n";
}

function renderOverlapSummary(matrix: ProviderMatrix): string[] {
  const codeMark = String.fromCharCode(96);
  const lines = [
    "Exact overlap rows: " + matrix.overlap.facts.length,
    "Conflict rows: " + matrix.conflicts.length,
    "",
    "| Fact class | Provider pair | Exact overlap | Conflicts | Left only | Right only |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const pair of matrix.overlap.pairwise) {
    lines.push(
      "| " +
        codeMark +
        escapeMarkdown(pair.factClass) +
        codeMark +
        " | " +
        escapeMarkdown(providerLabel(pair.left) + " / " + providerLabel(pair.right)) +
        " | " +
        pair.overlapFactCount +
        " | " +
        pair.conflictFactCount +
        " | " +
        pair.leftOnlyFactCount +
        " | " +
        pair.rightOnlyFactCount +
        " |",
    );
  }
  lines.push("", "### Unique comparable evidence", "");
  const uniqueCoverage = matrix.coverage.flatMap((coverage) =>
    coverage.factClasses
      .filter((item) => item.uniqueFactCount > 0)
      .map(
        (item) =>
          "- " +
          escapeMarkdown(providerLabel(coverage.provider)) +
          " / " +
          codeMark +
          escapeMarkdown(item.factClass) +
          codeMark +
          ": " +
          item.uniqueFactCount +
          " logical fact(s)",
      ),
  );
  lines.push(...(uniqueCoverage.length === 0 ? ["None."] : uniqueCoverage));
  lines.push("", "### Disagreement details", "");
  if (matrix.conflicts.length === 0) {
    lines.push("None.");
  } else {
    for (const row of matrix.conflicts) {
      const subject = row.variants[0]?.subject;
      const subjectLabel = subject?.canonicalId ?? subject?.nativeId ?? "unknown";
      const variants = row.variants.map((variant) => {
        const providers = variant.providers.map(providerLabel).map(escapeMarkdown).join(", ");
        return providers + " => " + formatMatrixObject(variant.object);
      });
      lines.push(
        "- " +
          codeMark +
          escapeMarkdown(row.factClass) +
          codeMark +
          " subject " +
          codeMark +
          escapeMarkdown(subjectLabel) +
          codeMark +
          ": " +
          variants.join("; "),
      );
    }
  }
  return lines;
}

function formatMatrixObject(object: MatrixFactObject): string {
  if (object.kind === "value") return JSON.stringify(object.value);
  return "entity " + (object.entity.canonicalId ?? object.entity.nativeId);
}

function providerLabel(provider: ProviderIdentity): string {
  return provider.id + "@" + provider.version;
}

function formatRatio(value: MatrixRatio): string {
  return value.value === null ? value.numerator + "/" + value.denominator + " (n/a)" : value.value.toFixed(3);
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * Writes aggregate and sliced machine-readable artifacts plus the report.
 * The writer performs no provider execution and no normalization.
 */
export async function writeProviderMatrixArtifacts(
  runRoot: string,
  matrix: ProviderMatrix,
): Promise<ProviderMatrixArtifactPaths> {
  const matrixRoot = path.join(runRoot, "matrix");
  await mkdir(matrixRoot, { recursive: true });
  const matrixPath = path.join(matrixRoot, "matrix.json");
  const coveragePath = path.join(matrixRoot, "coverage.json");
  const overlapPath = path.join(matrixRoot, "overlap.json");
  const conflictsPath = path.join(matrixRoot, "conflicts.json");
  const unmatchedPath = path.join(matrixRoot, "unmatched.json");
  const informationGainPath = path.join(matrixRoot, "information-gain.json");
  const reportPath = path.join(runRoot, "report.md");
  await writeJson(matrixPath, matrix);
  await writeJson(coveragePath, {
    schemaVersion: matrix.schemaVersion,
    metricDefinitions: matrix.metricDefinitions,
    repositories: matrix.repositories,
    providers: matrix.providers,
    coverage: matrix.coverage,
  });
  await writeJson(overlapPath, {
    schemaVersion: matrix.schemaVersion,
    metricDefinitions: matrix.metricDefinitions,
    repositories: matrix.repositories,
    overlap: matrix.overlap,
  });
  await writeJson(conflictsPath, {
    schemaVersion: matrix.schemaVersion,
    metricDefinitions: matrix.metricDefinitions,
    repositories: matrix.repositories,
    conflicts: matrix.conflicts,
  });
  await writeJson(unmatchedPath, {
    schemaVersion: matrix.schemaVersion,
    metricDefinitions: matrix.metricDefinitions,
    repositories: matrix.repositories,
    unmatched: matrix.unmatched,
  });
  await writeJson(informationGainPath, {
    schemaVersion: matrix.schemaVersion,
    metricDefinitions: matrix.metricDefinitions,
    repositories: matrix.repositories,
    additionOrder: matrix.additionOrder,
    informationGain: matrix.informationGain,
  });
  await writeFile(reportPath, renderProviderMatrixReport(matrix), "utf8");
  return {
    matrixPath,
    coveragePath,
    overlapPath,
    conflictsPath,
    unmatchedPath,
    informationGainPath,
    reportPath,
  };
}

/** Builds then persists a matrix, accepting either normalized facts or a matrix. */
export async function writeProviderMatrix(
  runRoot: string,
  input: NormalizedFactsArtifact | FactNormalizationResult | ProviderMatrix,
  options: ProviderMatrixOptions = {},
): Promise<ProviderMatrixArtifactPaths> {
  const matrix = isProviderMatrix(input) ? input : buildProviderMatrix(input, options);
  return writeProviderMatrixArtifacts(runRoot, matrix);
}

/** Persists the exact normalized artifact consumed by the matrix builder. */
export async function writeNormalizedFactsArtifact(
  filePath: string,
  input: NormalizedFactsArtifact | FactNormalizationResult,
): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "w");
  try {
    await handle.write(`{"schemaVersion":${FACT_SCHEMA_VERSION},"facts":[`);
    await writeJsonArray(handle, input.facts, persistFactEnvelope);
    await handle.write(`],"unsupported":[`);
    await writeJsonArray(handle, input.unsupported, persistUnsupportedEvidence);
    await handle.write(`],"correlation":${JSON.stringify(input.correlation)}`);
    await handle.write("}\n");
  } finally {
    await handle.close();
  }
  return filePath;
}

/**
 * The in-memory envelope retains providerNative as a convenience alias, while
 * the persisted artifact stores the payload once under nativeEvidence and
 * replaces duplicate aliases with an auditable local reference.
 */
function persistFactEnvelope(fact: FactEnvelope): FactEnvelope {
  const reference = { $ref: `nativeEvidence:${fact.nativeEvidence.id}/providerNative` };
  return {
    ...fact,
    providerNative: reference,
    nativeEvidence: {
      ...fact.nativeEvidence,
      observation: { ...fact.nativeEvidence.observation, providerNative: reference },
    },
  };
}

function persistUnsupportedEvidence(evidence: UnsupportedProviderEvidence): UnsupportedProviderEvidence {
  const reference = { $ref: `nativeEvidence:${evidence.nativeEvidence.id}/providerNative` };
  return {
    ...evidence,
    providerNative: reference,
    nativeEvidence: {
      ...evidence.nativeEvidence,
      observation: { ...evidence.nativeEvidence.observation, providerNative: reference },
    },
  };
}

async function writeJsonArray<T>(
  handle: Awaited<ReturnType<typeof open>>,
  values: readonly T[],
  transform: (value: T) => unknown,
): Promise<void> {
  let buffer = "";
  for (let index = 0; index < values.length; index += 1) {
    buffer += (index === 0 ? "" : ",") + JSON.stringify(transform(values[index]));
    if (buffer.length >= 1024 * 1024) {
      await handle.write(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) await handle.write(buffer);
}

/** Reads a persisted #11 normalized-facts artifact without running providers. */
export async function readNormalizedFactsArtifact(filePath: string): Promise<NormalizedFactsArtifact> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed)) throw new Error("normalized fact artifact must be an object");
  if (parsed.schemaVersion !== FACT_SCHEMA_VERSION) {
    throw new Error("normalized fact artifact schemaVersion must be " + FACT_SCHEMA_VERSION);
  }
  if (!Array.isArray(parsed.facts)) throw new Error("normalized fact artifact facts must be an array");
  if (!Array.isArray(parsed.unsupported)) throw new Error("normalized fact artifact unsupported must be an array");
  if (!isRecord(parsed.correlation)) throw new Error("normalized fact artifact correlation must be an object");
  return parsed as unknown as NormalizedFactsArtifact;
}

/** Reads a persisted normalized artifact and generates its deterministic matrix. */
export async function buildProviderMatrixFromArtifact(
  filePath: string,
  options: ProviderMatrixOptions = {},
): Promise<ProviderMatrix> {
  return buildProviderMatrix(await readNormalizedFactsArtifact(filePath), options);
}

function isProviderMatrix(
  value: NormalizedFactsArtifact | FactNormalizationResult | ProviderMatrix,
): value is ProviderMatrix {
  return isRecord(value) && value.schemaVersion === PROVIDER_MATRIX_SCHEMA_VERSION && "metricDefinitions" in value;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "w");
  const writer = new JsonArtifactWriter(handle);
  try {
    await writer.writeValue(value);
    await writer.write("\n");
    await writer.flush();
  } finally {
    await handle.close();
  }
}

/**
 * Serializes large generated artifacts without first constructing one giant
 * JSON string. Mottainai's TypeScript observation set is large enough for a
 * single JSON.stringify(matrix) call to exceed V8's string limit.
 */
class JsonArtifactWriter {
  private buffer = "";

  constructor(private readonly handle: Awaited<ReturnType<typeof open>>) {}

  async write(value: string): Promise<void> {
    this.buffer += value;
    if (this.buffer.length >= 1024 * 1024) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    await this.handle.write(this.buffer);
    this.buffer = "";
  }

  async writeValue(value: unknown): Promise<void> {
    if (value === null) {
      await this.write("null");
      return;
    }
    if (Array.isArray(value)) {
      await this.write("[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) await this.write(",");
        await this.writeValue(value[index]);
      }
      await this.write("]");
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      await this.write("{");
      let first = true;
      for (const key of Object.keys(record)) {
        if (record[key] === undefined) continue;
        if (!first) await this.write(",");
        first = false;
        await this.write(JSON.stringify(key));
        await this.write(":");
        await this.writeValue(record[key]);
      }
      await this.write("}");
      return;
    }
    const serialized = JSON.stringify(value);
    await this.write(serialized === undefined ? "null" : serialized);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
