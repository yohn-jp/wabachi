import { createHash } from "node:crypto";
import type { Observation, ObservationEntity, ObservationPredicate, SourceEvidence } from "./observation.js";
import {
  correlateProviderEntities,
  normalizeRepositoryPath,
  normalizeSourceRange,
  providerEntitiesFromAllObservations,
  providerEntitiesFromObservations,
  type CanonicalEntity,
  type CanonicalEntityMember,
  type CorrelationResult,
  type CorrelationStatus,
  type NormalizedSourceRange,
  type ProviderEntityInput,
} from "./correlation.js";
import type { DeterminismClass, ProviderIdentity, ResolvedRepository } from "./provider.js";

/** Version of the minimal normalized fact interchange envelope. */
export const FACT_SCHEMA_VERSION = 1 as const;
export type FactSchemaVersion = typeof FACT_SCHEMA_VERSION;
export type DerivationClass = DeterminismClass;

export type FactObservation = Omit<Observation, "predicate"> & {
  /** Common predicates are normalized; any other value is retained as unsupported evidence. */
  readonly predicate: string;
};

export interface FactEntityReference {
  /** Present only when correlation produced one unambiguous canonical entity. */
  readonly canonicalId?: string;
  /** Canonical IDs retained when more than one candidate remains possible. */
  readonly candidateCanonicalIds: readonly string[];
  /** Provider-native entity identity; never replaced by canonicalId. */
  readonly id: string;
  readonly nativeId: string;
  readonly kind: string;
  readonly provider: ProviderIdentity;
  readonly correlationStatus: CorrelationStatus;
  readonly path?: string;
  readonly range?: NormalizedSourceRange;
}

export type FactObject = FactEntityReference | { readonly value: string };

export interface NativeEvidenceReference {
  /** Stable digest of the pinned observation and its provider-native payload. */
  readonly id: string;
  readonly provider: ProviderIdentity;
  readonly source: SourceEvidence;
  /** Original observation retained when normalization changes endpoint orientation. */
  readonly observation: FactObservation;
  /** Retained inline so normalization never discards provider-native evidence. */
  readonly providerNative: unknown;
}

export interface FactEnvelope {
  readonly schemaVersion: FactSchemaVersion;
  /** Stable per-evidence record identity; not used for cross-provider equality. */
  readonly factId: string;
  readonly status: "present";
  readonly subject: FactEntityReference;
  readonly predicate: ObservationPredicate;
  readonly object: FactObject;
  readonly provider: ProviderIdentity;
  readonly repository: ResolvedRepository;
  readonly source: SourceEvidence;
  readonly derivationClass: DerivationClass;
  /** Compatibility with the provider observation vocabulary. */
  readonly determinism: DeterminismClass;
  readonly nativeEvidence: NativeEvidenceReference;
  /** Direct alias for consumers that already consume the observation envelope. */
  readonly providerNative: unknown;
}

export interface UnsupportedProviderEvidence {
  readonly schemaVersion: FactSchemaVersion;
  readonly status: "unsupported";
  readonly subject: FactEntityReference;
  readonly predicate: string;
  readonly object: FactObject;
  readonly provider: ProviderIdentity;
  readonly repository: ResolvedRepository;
  readonly source: SourceEvidence;
  readonly derivationClass: DerivationClass;
  readonly determinism: DeterminismClass;
  readonly nativeEvidence: NativeEvidenceReference;
  readonly providerNative: unknown;
}

export type FactComparisonState = "equivalent" | "provider-only" | "absent" | "unsupported" | "conflict";
export type FactState = FactComparisonState;

export interface FactComparison {
  readonly key: string;
  readonly state: FactComparisonState;
  readonly subject?: FactEntityReference;
  readonly predicate?: string;
  readonly facts: readonly FactEnvelope[];
  readonly unsupported: readonly UnsupportedProviderEvidence[];
  readonly providers: readonly ProviderIdentity[];
}

export interface FactNormalizationOptions {
  /** Provider identities expected in the comparison; used to distinguish provider-only from equivalent. */
  readonly providers?: readonly ProviderIdentity[];
  /** Skip the legacy comparison projection when only the matrix is required. */
  readonly includeComparisons?: boolean;
}

export interface FactNormalizationResult {
  readonly schemaVersion: FactSchemaVersion;
  readonly facts: readonly FactEnvelope[];
  /** Unsupported predicates/evidence are retained instead of being dropped. */
  readonly unsupported: readonly UnsupportedProviderEvidence[];
  readonly correlation: CorrelationResult;
  readonly comparisons: readonly FactComparison[];
}

interface EntityAssignment {
  readonly entity: CanonicalEntity;
  readonly member: CanonicalEntityMember;
}

interface EntityAssignments {
  readonly byNative: ReadonlyMap<string, readonly EntityAssignment[]>;
  readonly byFingerprint: ReadonlyMap<string, readonly EntityAssignment[]>;
}

interface ComparisonOptions {
  readonly providers?: readonly ProviderIdentity[];
  readonly unsupported?: readonly UnsupportedProviderEvidence[];
}

const COMMON_PREDICATES: ReadonlySet<string> = new Set<ObservationPredicate>([
  "defines",
  "references",
  "calls",
  "imports",
  "exports",
  "extends",
  "implements",
  "type-of",
  "reads",
  "writes",
  "flows-to",
  "depends-on",
]);

/**
 * Normalizes provider observations and correlates their endpoints with the
 * existing deterministic entity layer. Provider-native IDs, payloads and
 * source evidence remain present on every output record.
 */
export function normalizeFacts(
  observations: readonly FactObservation[],
  options: FactNormalizationOptions = {},
): FactNormalizationResult {
  const runtimeObservations = observations as readonly Observation[];
  const preferredEntities = providerEntitiesFromObservations(runtimeObservations);
  const allEntities = providerEntitiesFromAllObservations(runtimeObservations);
  const preferredByNative = groupByNative(preferredEntities);
  const allByNative = groupByNative(allEntities);
  const selectedEntities = selectEntityInputs(preferredByNative, allByNative);
  const correlation = correlateProviderEntities(selectedEntities);
  const assignments = indexAssignments(correlation);

  const facts: FactEnvelope[] = [];
  const unsupported: UnsupportedProviderEvidence[] = [];
  for (const observation of observations) {
    const endpointInputs = endpointInputsForObservation(observation, preferredByNative, allByNative);
    const subjectInput = endpointInputs.find((input) => input.id === observation.subject.id);
    const subject = toFactEntityReference(
      subjectInput ?? fallbackEntityInput(observation, observation.subject),
      assignments,
    );
    let object: FactObject;
    if (isObservationEntity(observation.object)) {
      const objectEntity = observation.object;
      object = toFactEntityReference(
        endpointInputs.find((input) => input.id === objectEntity.id) ?? fallbackEntityInput(observation, objectEntity),
        assignments,
      );
    } else {
      object = { value: observation.object.value.trim() };
    }

    if (isCommonPredicate(observation.predicate)) {
      const normalized = normalizePredicateEndpoints(observation, subject, object);
      facts.push(toFactEnvelope(observation, normalized.subject, normalized.object));
    } else {
      unsupported.push(toUnsupportedEvidence(observation, subject, object));
    }
  }

  const sortedFacts = sortFactsForOutput(facts);
  facts.length = 0;
  for (const fact of sortedFacts) facts.push(fact);
  unsupported.sort(compareUnsupportedForOutput);
  const comparisons =
    options.includeComparisons === false ? [] : compareFactSets(facts, { providers: options.providers, unsupported });
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    facts,
    unsupported,
    correlation,
    comparisons,
  };
}

/**
 * Providers encode a definition in opposite directions: TypeScript commonly
 * emits `module defines symbol`, while SCIP emits `symbol defines document`.
 * The comparable form is `defined symbol defines source path`; the original
 * observation and native payload remain in the evidence fields.
 */
function normalizePredicateEndpoints(
  observation: FactObservation,
  subject: FactEntityReference,
  object: FactObject,
): { readonly subject: FactEntityReference; readonly object: FactObject } {
  if (observation.predicate !== "defines") return { subject, object };
  const definedEntity = isObservationEntity(observation.object) ? object : subject;
  return {
    subject: definedEntity as FactEntityReference,
    object: { value: normalizeRepositoryPath(observation.source.path) },
  };
}

/** Alias using the vocabulary of the provider observation layer. */
export const normalizeObservations = normalizeFacts;

/** Returns true when a predicate has a defined common semantic mapping. */
export function isCommonPredicate(value: string): value is ObservationPredicate {
  return COMMON_PREDICATES.has(value);
}

/**
 * Equality deliberately excludes provider version, source span, native
 * payload and factId. Canonical entity IDs and the pinned repository revision
 * are the cross-provider comparison basis.
 */
export function factEqualityKey(fact: FactEnvelope): string {
  return stableSerialize({
    repository: fact.repository,
    subject: factEntityEqualityKey(fact.subject),
    predicate: fact.predicate,
    object: isFactEntityReference(fact.object)
      ? { entity: factEntityEqualityKey(fact.object) }
      : { value: fact.object.value.trim() },
  });
}

/** Deterministic equality comparison for normalized facts. */
export function areEquivalentFacts(left: FactEnvelope, right: FactEnvelope): boolean {
  return factEqualityKey(left) === factEqualityKey(right);
}

/**
 * Compares one logical fact group. No facts means absence of evidence; an
 * unsupported record is kept distinct from that absence; differing values
 * are a conflict rather than a winner-takes-all merge.
 */
export function compareFacts(facts: readonly FactEnvelope[], options: ComparisonOptions = {}): FactComparison {
  const orderedFacts = sortFactsForOutput(facts);
  const unsupported = [...(options.unsupported ?? [])].sort(compareUnsupportedForOutput);
  const keys = [...new Set(orderedFacts.map(factEqualityKey))].sort();
  const providerMap = new Map<string, ProviderIdentity>();
  for (const fact of orderedFacts) providerMap.set(providerKey(fact.provider), fact.provider);
  for (const evidence of unsupported) providerMap.set(providerKey(evidence.provider), evidence.provider);
  const providers = [...providerMap.values()].sort(compareProviders);

  let state: FactComparisonState;
  if (orderedFacts.length === 0) {
    state = unsupported.length > 0 ? "unsupported" : "absent";
  } else if (keys.length > 1) {
    state = "conflict";
  } else {
    const expected = uniqueProviderKeys(options.providers ?? []);
    const observed = new Set(orderedFacts.map((fact) => providerKey(fact.provider)));
    const unsupportedExpected = unsupported.some((evidence) => expected.has(providerKey(evidence.provider)));
    const coversExpected = expected.size > 0 && [...expected].every((key) => observed.has(key));
    state =
      coversExpected && !unsupportedExpected
        ? "equivalent"
        : observed.size > 1 && expected.size === 0 && !unsupportedExpected
          ? "equivalent"
          : "provider-only";
  }

  const firstFact = orderedFacts[0];
  const firstUnsupported = unsupported[0];
  return {
    key:
      firstFact === undefined
        ? firstUnsupported === undefined
          ? "absent"
          : comparisonGroupKey(firstUnsupported)
        : comparisonGroupKey(firstFact),
    state,
    subject: firstFact?.subject ?? firstUnsupported?.subject,
    predicate: firstFact?.predicate ?? firstUnsupported?.predicate,
    facts: orderedFacts,
    unsupported,
    providers,
  };
}

/** Groups facts by subject/predicate and reports overlap and disagreement. */
export function compareFactSets(facts: readonly FactEnvelope[], options: ComparisonOptions = {}): FactComparison[] {
  const groups = new Map<string, { facts: FactEnvelope[]; unsupported: UnsupportedProviderEvidence[] }>();
  for (const fact of facts) {
    const group = groups.get(comparisonGroupKey(fact)) ?? { facts: [], unsupported: [] };
    group.facts.push(fact);
    groups.set(comparisonGroupKey(fact), group);
  }
  for (const evidence of options.unsupported ?? []) {
    const group = groups.get(comparisonGroupKey(evidence)) ?? { facts: [], unsupported: [] };
    group.unsupported.push(evidence);
    groups.set(comparisonGroupKey(evidence), group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => compareFacts(group.facts, { providers: options.providers, unsupported: group.unsupported }));
}

/** Alias for callers that use the normalized-fact terminology. */
export const compareNormalizedFacts = compareFacts;

/** Runtime validation for a versioned fact envelope. */
export function validateFactEnvelope(value: unknown): EnvelopeValidationResult {
  const errors: string[] = [];
  const record = asRecord(value);
  if (record === undefined) return invalid("envelope must be an object");
  if (record.schemaVersion !== FACT_SCHEMA_VERSION) errors.push("schemaVersion must be 1");
  if (record.status !== "present") errors.push("status must be present");
  if (typeof record.factId !== "string" || record.factId.length === 0) errors.push("factId must be a non-empty string");
  if (!isCommonPredicate(record.predicate as string)) errors.push("predicate is not a supported common predicate");
  validateEntityReference(record.subject, "subject", errors);
  validateFactObject(record.object, "object", errors);
  validateProvider(record.provider, "provider", errors);
  validateRepository(record.repository, "repository", errors);
  validateSource(record.source, "source", errors);
  if (record.derivationClass !== "deterministic" && record.derivationClass !== "non-deterministic") {
    errors.push("derivationClass must be deterministic or non-deterministic");
  }
  if (record.determinism !== record.derivationClass) errors.push("determinism must equal derivationClass");
  validateNativeEvidence(record.nativeEvidence, errors);
  return { valid: errors.length === 0, errors };
}

/** Runtime validation for the provider observation envelope before normalization. */
export function validateObservationEnvelope(value: unknown): EnvelopeValidationResult {
  const errors: string[] = [];
  const record = asRecord(value);
  if (record === undefined) return invalid("observation must be an object");
  if (record.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!isCommonPredicate(record.predicate as string)) errors.push("predicate is not a supported observation predicate");
  validateObservationEntity(record.subject, "subject", errors);
  validateObservationObject(record.object, "object", errors);
  validateProvider(record.provider, "provider", errors);
  validateRepository(record.repository, "repository", errors);
  validateSource(record.source, "source", errors);
  if (record.determinism !== "deterministic" && record.determinism !== "non-deterministic") {
    errors.push("determinism must be deterministic or non-deterministic");
  }
  if (!("providerNative" in record)) errors.push("providerNative is required");
  return { valid: errors.length === 0, errors };
}

export function isFactEnvelope(value: unknown): value is FactEnvelope {
  return validateFactEnvelope(value).valid;
}

export function assertValidFactEnvelope(value: unknown): asserts value is FactEnvelope {
  const result = validateFactEnvelope(value);
  if (!result.valid) throw new Error(`invalid fact envelope: ${result.errors.join("; ")}`);
}

export interface EnvelopeValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function toFactEnvelope(observation: FactObservation, subject: FactEntityReference, object: FactObject): FactEnvelope {
  const nativeEvidence = nativeEvidenceReference(observation);
  const base = {
    schemaVersion: FACT_SCHEMA_VERSION,
    factId: "",
    status: "present" as const,
    subject,
    predicate: observation.predicate as ObservationPredicate,
    object,
    provider: observation.provider,
    repository: observation.repository,
    source: normalizedSource(observation.source),
    derivationClass: observation.determinism,
    determinism: observation.determinism,
    nativeEvidence,
    providerNative: observation.providerNative,
  } satisfies Omit<FactEnvelope, "factId"> & { factId: string };
  return {
    ...base,
    factId: digest({ equality: factEqualityKey(base), nativeEvidence: nativeEvidence.id }),
  };
}

function toUnsupportedEvidence(
  observation: FactObservation,
  subject: FactEntityReference,
  object: FactObject,
): UnsupportedProviderEvidence {
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    status: "unsupported",
    subject,
    predicate: observation.predicate,
    object,
    provider: observation.provider,
    repository: observation.repository,
    source: normalizedSource(observation.source),
    derivationClass: observation.determinism,
    determinism: observation.determinism,
    nativeEvidence: nativeEvidenceReference(observation),
    providerNative: observation.providerNative,
  };
}

function nativeEvidenceReference(observation: FactObservation): NativeEvidenceReference {
  return {
    id: `ne_${digest({
      provider: observation.provider,
      repository: observation.repository,
      subject: observation.subject,
      predicate: observation.predicate,
      object: observation.object,
      source: observation.source,
      providerNative: observation.providerNative,
    })}`,
    provider: observation.provider,
    source: normalizedSource(observation.source),
    observation,
    providerNative: observation.providerNative,
  };
}

function normalizedSource(source: SourceEvidence): SourceEvidence {
  return {
    path: normalizeRepositoryPath(source.path),
    ...(source.span === undefined ? {} : { span: source.span }),
  };
}

function selectEntityInputs(
  preferredByNative: ReadonlyMap<string, readonly ProviderEntityInput[]>,
  allByNative: ReadonlyMap<string, readonly ProviderEntityInput[]>,
): ProviderEntityInput[] {
  const selected = [...preferredByNative.values()].flat();
  for (const [nativeKey, candidates] of allByNative) {
    // Definitions are the correlation authority when a provider emits them.
    // Relation occurrences still remain in nativeEvidence and are resolved
    // against this smaller index while normalizing each fact. Keeping every
    // occurrence here turns large repositories into an O(n²) ambiguity graph.
    if ((preferredByNative.get(nativeKey) ?? []).length > 0) continue;
    const representative = [...candidates].sort((left, right) => {
      const fingerprint = entityFingerprint(left).localeCompare(entityFingerprint(right));
      return fingerprint !== 0
        ? fingerprint
        : stableSerialize(left.providerNative).localeCompare(stableSerialize(right.providerNative));
    })[0];
    if (representative !== undefined) selected.push(representative);
  }
  return deduplicateEntityInputs(selected);
}

function endpointInputsForObservation(
  observation: FactObservation,
  preferredByNative: ReadonlyMap<string, readonly ProviderEntityInput[]>,
  allByNative: ReadonlyMap<string, readonly ProviderEntityInput[]>,
): ProviderEntityInput[] {
  const endpointInputs = providerEntitiesFromAllObservations([observation as Observation]);
  return endpointInputs.map((input) => {
    const preferredCandidates = preferredByNative.get(providerNativeKey(input)) ?? [];
    if (preferredCandidates.length === 1) return preferredCandidates[0];
    const allCandidates = allByNative.get(providerNativeKey(input)) ?? [];
    const exact = allCandidates.filter((candidate) => entityFingerprint(candidate) === entityFingerprint(input));
    if (exact.length === 1) return exact[0];
    return input;
  });
}

function fallbackEntityInput(observation: FactObservation, entity: ObservationEntity): ProviderEntityInput {
  return {
    provider: observation.provider,
    repository: observation.repository,
    id: entity.id,
    kind: entity.kind,
    path: observation.source.path,
    span: observation.source.span,
    providerNative: observation.providerNative,
  };
}

function groupByNative(inputs: readonly ProviderEntityInput[]): Map<string, ProviderEntityInput[]> {
  const result = new Map<string, ProviderEntityInput[]>();
  for (const input of inputs) {
    const key = providerNativeKey(input);
    const list = result.get(key) ?? [];
    list.push(input);
    result.set(key, list);
  }
  return result;
}

function deduplicateEntityInputs(inputs: readonly ProviderEntityInput[]): ProviderEntityInput[] {
  const byKey = new Map<string, ProviderEntityInput>();
  for (const input of inputs) {
    const key = entityFingerprint(input);
    const previous = byKey.get(key);
    if (
      previous === undefined ||
      stableSerialize(input.providerNative).localeCompare(stableSerialize(previous.providerNative)) < 0
    ) {
      byKey.set(key, input);
    }
  }
  return [...byKey.values()].sort((left, right) => entityFingerprint(left).localeCompare(entityFingerprint(right)));
}

function indexAssignments(correlation: CorrelationResult): EntityAssignments {
  const byNative = new Map<string, EntityAssignment[]>();
  const byFingerprint = new Map<string, EntityAssignment[]>();
  for (const entity of correlation.canonicalEntities) {
    for (const member of entity.members) {
      const assignment = { entity, member };
      addAssignment(byNative, memberNativeKey(member), assignment);
      addAssignment(byFingerprint, memberFingerprint(member), assignment);
    }
  }
  return { byNative, byFingerprint };
}

function addAssignment(map: Map<string, EntityAssignment[]>, key: string, assignment: EntityAssignment): void {
  const existing = map.get(key) ?? [];
  if (!existing.some((item) => item.entity.canonicalId === assignment.entity.canonicalId)) existing.push(assignment);
  map.set(key, existing);
}

function toFactEntityReference(input: ProviderEntityInput, assignments: EntityAssignments): FactEntityReference {
  const exact = assignments.byFingerprint.get(entityFingerprint(input)) ?? [];
  const native = assignments.byNative.get(providerNativeKey(input)) ?? [];
  // `indexAssignments` already deduplicates each native/fingerprint bucket by
  // canonical entity. Rebuilding a Map for every high-volume occurrence made
  // ambiguous native IDs dominate large-repository normalization.
  const candidates = exact.length > 0 ? exact : native;
  const only = candidates.length === 1 ? candidates[0] : undefined;
  const correlationStatus: CorrelationStatus =
    candidates.length > 1 ? "ambiguous" : (only?.entity.status ?? "unmatched");
  const candidateCanonicalIds = (
    candidates.length > 1
      ? candidates.map((candidate) => candidate.entity.canonicalId)
      : [...(only?.entity.candidateCanonicalIds ?? [])]
  ).sort();
  return {
    ...(only === undefined || correlationStatus === "ambiguous" ? {} : { canonicalId: only.entity.canonicalId }),
    candidateCanonicalIds,
    id: input.id.trim(),
    nativeId: input.id.trim(),
    kind: input.kind.trim() || "unknown",
    provider: input.provider,
    correlationStatus,
    ...(input.path === undefined && input.source?.path === undefined
      ? {}
      : { path: normalizeRepositoryPath(input.path ?? input.source?.path ?? ".") }),
    ...(normalizeInputRange(input) === undefined ? {} : { range: normalizeInputRange(input) }),
  };
}

function entityFingerprint(input: ProviderEntityInput): string {
  return stableSerialize({
    provider: providerKey(input.provider),
    id: input.id.trim(),
    kind: input.kind.trim() || "unknown",
    path:
      input.path === undefined && input.source?.path === undefined
        ? undefined
        : normalizeRepositoryPath(input.path ?? input.source?.path ?? "."),
    range: normalizeInputRange(input),
  });
}

function memberFingerprint(member: CanonicalEntityMember): string {
  return stableSerialize({
    provider: providerKey(member.provider),
    id: member.nativeId,
    kind: member.kind,
    path: member.path,
    range: member.range,
  });
}

function providerNativeKey(input: ProviderEntityInput): string {
  return `${providerKey(input.provider)}\u0000${input.id.trim()}`;
}

function memberNativeKey(member: CanonicalEntityMember): string {
  return `${providerKey(member.provider)}\u0000${member.nativeId}`;
}

function normalizeInputRange(input: ProviderEntityInput): NormalizedSourceRange | undefined {
  return normalizeSourceRange(input.range ?? input.span ?? input.source?.span, input.provider.id, input.rangeBase);
}

function comparisonGroupKey(value: FactEnvelope | UnsupportedProviderEvidence): string {
  return stableSerialize({
    repository: value.repository,
    subject: factEntityEqualityKey(value.subject),
    predicate: value.predicate,
  });
}

function factEntityEqualityKey(entity: FactEntityReference): unknown {
  return entity.canonicalId === undefined
    ? {
        candidates: entity.candidateCanonicalIds,
        provider: providerKey(entity.provider),
        nativeId: entity.nativeId,
        kind: entity.kind,
      }
    : { canonicalId: entity.canonicalId };
}

function isFactEntityReference(value: FactObject): value is FactEntityReference {
  return "nativeId" in value && "provider" in value;
}

function isObservationEntity(value: Observation["object"]): value is ObservationEntity {
  const record = asRecord(value);
  return record !== undefined && typeof record.id === "string" && typeof record.kind === "string";
}

function sortFactsForOutput(values: readonly FactEnvelope[]): FactEnvelope[] {
  const equalityKeys = new WeakMap<FactEnvelope, string>();
  const keyFor = (fact: FactEnvelope): string => {
    const cached = equalityKeys.get(fact);
    if (cached !== undefined) return cached;
    const key = factEqualityKey(fact);
    equalityKeys.set(fact, key);
    return key;
  };
  return [...values].sort((left, right) => {
    const leftKey = keyFor(left);
    const rightKey = keyFor(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    if (left.factId < right.factId) return -1;
    if (left.factId > right.factId) return 1;
    return 0;
  });
}

function compareUnsupportedForOutput(left: UnsupportedProviderEvidence, right: UnsupportedProviderEvidence): number {
  const leftKey = stableSerialize({ group: comparisonGroupKey(left), native: left.nativeEvidence.id });
  const rightKey = stableSerialize({ group: comparisonGroupKey(right), native: right.nativeEvidence.id });
  return leftKey.localeCompare(rightKey);
}

function compareProviders(left: ProviderIdentity, right: ProviderIdentity): number {
  return providerKey(left).localeCompare(providerKey(right));
}

function providerKey(provider: ProviderIdentity): string {
  return `${provider.id}\u0000${provider.version}\u0000${provider.determinism}`;
}

function uniqueProviderKeys(providers: readonly ProviderIdentity[]): Set<string> {
  return new Set(providers.map(providerKey));
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function invalid(message: string): EnvelopeValidationResult {
  return { valid: false, errors: [message] };
}

function validateEntityReference(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined) {
    errors.push(`${path} must be an entity reference`);
    return;
  }
  if (typeof record.id !== "string" || typeof record.nativeId !== "string" || typeof record.kind !== "string") {
    errors.push(`${path} must retain id, nativeId and kind`);
  }
  if (record.canonicalId !== undefined && typeof record.canonicalId !== "string") {
    errors.push(`${path}.canonicalId must be a string when present`);
  }
  if (
    !Array.isArray(record.candidateCanonicalIds) ||
    !record.candidateCanonicalIds.every((id) => typeof id === "string")
  ) {
    errors.push(`${path}.candidateCanonicalIds must be a string array`);
  }
  validateProvider(record.provider, `${path}.provider`, errors);
  if (
    record.correlationStatus !== "matched" &&
    record.correlationStatus !== "probable" &&
    record.correlationStatus !== "ambiguous" &&
    record.correlationStatus !== "unmatched"
  ) {
    errors.push(`${path}.correlationStatus is invalid`);
  }
}

function validateFactObject(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined) {
    errors.push(`${path} must be an entity or scalar value`);
    return;
  }
  if (typeof record.value === "string" && Object.keys(record).length === 1) return;
  validateEntityReference(value, path, errors);
}

function validateObservationEntity(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined || typeof record.id !== "string" || typeof record.kind !== "string") {
    errors.push(`${path} must contain string id and kind`);
  }
}

function validateObservationObject(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined) {
    errors.push(`${path} must be an entity or scalar value`);
    return;
  }
  if (typeof record.value === "string" && Object.keys(record).length === 1) return;
  validateObservationEntity(value, path, errors);
}

function validateProvider(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined || typeof record.id !== "string" || typeof record.version !== "string") {
    errors.push(`${path} must contain string id and version`);
    return;
  }
  if (record.determinism !== "deterministic" && record.determinism !== "non-deterministic") {
    errors.push(`${path}.determinism is invalid`);
  }
}

function validateRepository(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record.source !== "string" ||
    typeof record.commitSha !== "string" ||
    record.commitSha.length === 0
  ) {
    errors.push(`${path} must contain source and pinned commitSha`);
  }
}

function validateSource(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined || typeof record.path !== "string" || record.path.length === 0) {
    errors.push(`${path} must contain a path`);
  }
}

function validateNativeEvidence(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (record === undefined || typeof record.id !== "string" || record.id.length === 0) {
    errors.push("nativeEvidence must contain a stable id");
    return;
  }
  validateProvider(record.provider, "nativeEvidence.provider", errors);
  validateSource(record.source, "nativeEvidence.source", errors);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}
