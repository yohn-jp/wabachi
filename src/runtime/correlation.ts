import { createHash } from "node:crypto";
import type { Observation, ObservationEntity, SourceEvidence } from "./observation.js";
import type { ProviderIdentity, ResolvedRepository } from "./provider.js";

/** The only outcomes a canonical entity can have. */
export type CorrelationStatus = "matched" | "probable" | "ambiguous" | "unmatched";

/** Relationship cardinality is retained instead of being hidden by grouping. */
export type CorrelationCardinality = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many" | "unmatched";

export type RangeBase = "zero-based" | "one-based";

/** A source range uses one-based lines and columns after normalization. */
export interface NormalizedSourceRange {
  readonly startLine: number;
  readonly startColumn?: number;
  readonly endLine: number;
  readonly endColumn?: number;
}

export type SourceRangeInput = string | readonly number[] | NormalizedSourceRange;

/**
 * One provider-native entity to be correlated. `id` is never replaced: it is
 * the provider's native identity and is retained in every output member.
 */
export interface ProviderEntityInput {
  readonly provider: ProviderIdentity;
  readonly repository: ResolvedRepository;
  readonly id: string;
  readonly kind: string;
  readonly path?: string;
  readonly span?: string;
  readonly range?: SourceRangeInput;
  readonly rangeBase?: RangeBase;
  readonly source?: SourceEvidence;
  readonly name?: string;
  readonly qualifiedName?: string;
  readonly signature?: string;
  readonly aliases?: readonly string[];
  readonly providerNative?: unknown;
}

export interface ProviderEntityReference {
  readonly provider: ProviderIdentity;
  readonly nativeId: string;
  readonly kind: string;
  readonly path?: string;
  readonly range?: NormalizedSourceRange;
}

export interface CanonicalEntityMember extends ProviderEntityReference {
  readonly repository: ResolvedRepository;
  readonly canonicalKind: string;
  readonly name?: string;
  readonly qualifiedName?: string;
  readonly signature?: string;
  readonly aliases: readonly string[];
  /** Lossless provider-native evidence supplied for this member. */
  readonly providerNative: unknown;
}

export type CorrelationRule =
  | "same-repository-revision"
  | "same-path"
  | "same-range"
  | "same-kind"
  | "same-qualified-name"
  | "same-alias"
  | "same-name"
  | "same-signature";

export interface CorrelationEvidence {
  readonly left: ProviderEntityReference;
  readonly right: ProviderEntityReference;
  readonly score: number;
  readonly rules: readonly CorrelationRule[];
}

export interface CorrelationRationale {
  readonly method: "deterministic-rules";
  readonly reason:
    | "deterministic-evidence"
    | "probable-evidence"
    | "competing-evidence"
    | "provider-cardinality-conflict"
    | "no-cross-provider-evidence";
  readonly cardinality: CorrelationCardinality;
  readonly rules: readonly CorrelationRule[];
  readonly evidence: readonly CorrelationEvidence[];
}

export interface CanonicalEntity {
  /** Stable identity derived from the pinned repository and member set. */
  readonly canonicalId: string;
  /** Alias for consumers that call the record's identity simply `identity`. */
  readonly identity: string;
  readonly repository: ResolvedRepository;
  readonly kind: string;
  readonly status: CorrelationStatus;
  readonly members: readonly CanonicalEntityMember[];
  /** Canonical IDs of unresolved competing candidates. */
  readonly candidateCanonicalIds: readonly string[];
  readonly rationale: CorrelationRationale;
}

export interface CorrelationLink {
  readonly left: ProviderEntityReference;
  readonly right: ProviderEntityReference;
  readonly score: number;
  readonly strength: "matched" | "probable";
  readonly cardinality: CorrelationCardinality;
  readonly rules: readonly CorrelationRule[];
}

export interface ProviderCorrelationMetrics {
  readonly provider: ProviderIdentity;
  readonly total: number;
  readonly canonicalEntityCount: number;
  readonly candidateCount: number;
  readonly matched: number;
  readonly probable: number;
  readonly ambiguous: number;
  readonly unmatched: number;
}

export interface CorrelationCandidateKeyDiagnostic {
  readonly keyClass: string;
  readonly keyCount: number;
  readonly potentialPairCount: number;
}

export interface CorrelationDiagnostics {
  /** Safety bound on candidate materialization; it is not a provider score. */
  readonly maxCandidatePairsPerKey: number;
  readonly indexedKeyCount: number;
  readonly skippedKeyCount: number;
  /** Potential pairs under skipped keys, before provider/kind filtering. */
  readonly skippedPotentialPairCount: number;
  readonly skippedKeys: readonly CorrelationCandidateKeyDiagnostic[];
}

export interface CorrelationResult {
  readonly canonicalEntities: readonly CanonicalEntity[];
  /** All deterministic candidate links, including links rejected by cardinality. */
  readonly links: readonly CorrelationLink[];
  /** Metrics are keyed by provider id; versions remain in each metric value. */
  readonly metrics: Readonly<Record<string, ProviderCorrelationMetrics>>;
  readonly diagnostics: CorrelationDiagnostics;
}

interface NormalizedEntity {
  readonly input: ProviderEntityInput;
  readonly providerKey: string;
  readonly repositoryKey: string;
  readonly id: string;
  readonly kind: string;
  readonly kindFamily: string;
  readonly path?: string;
  readonly range?: NormalizedSourceRange;
  readonly name?: string;
  readonly qualifiedName?: string;
  readonly signature?: string;
  readonly aliases: readonly string[];
  readonly qualifiedKeys: readonly string[];
  readonly aliasKeys: readonly string[];
  readonly nameKeys: readonly string[];
  readonly signatureKey?: string;
  readonly key: string;
  /** Cached once at normalization time; avoids re-serializing in hot comparators. */
  readonly providerNativeSerialized: string;
}

interface CandidateEdge {
  readonly left: number;
  readonly right: number;
  readonly score: number;
  readonly strength: "matched" | "probable";
  readonly rules: readonly CorrelationRule[];
}

interface EdgeIndex {
  readonly incident: ReadonlyMap<number, readonly CandidateEdge[]>;
  readonly targets: ReadonlyMap<number, ReadonlyMap<string, ReadonlySet<number>>>;
}

interface CandidateEdgeBuild {
  readonly edges: readonly CandidateEdge[];
  readonly diagnostics: CorrelationDiagnostics;
}

const MAX_CANDIDATE_PAIRS_PER_KEY = 100_000;
/** Safety valve for the sum of materialized pairs across every candidate key. */
const MAX_TOTAL_CANDIDATE_PAIRS = 2_000_000;
/**
 * Weak key classes (bare name/alias matches with no path, kind, or
 * signature narrowing them) are evidence, not near-unique identity —
 * `compareEntityPair` only ever scores them 45-48. A single such bucket
 * with hundreds of members on each side is realistic (a common name shared
 * across a large codebase) and every one of those pairs would be
 * individually valid, so the per-key cap alone does not bound the
 * aggregate: many small buckets can still sum to millions of low-value
 * edges. Weak buckets get a much tighter per-key bound than strong
 * (near-unique) evidence, and buckets that exceed it are recorded in
 * diagnostics rather than expanded — this is a recall/cost trade-off
 * specific to low-information evidence, not a general correctness bound.
 */
const MAX_WEAK_CANDIDATE_PAIRS_PER_KEY = 2_000;
const WEAK_KEY_CLASSES: ReadonlySet<string> = new Set(["name-exact", "path-name-exact", "path-kind"]);

interface EntityGroup {
  readonly indices: readonly number[];
  readonly strength: "matched" | "probable";
}

const RULE_ORDER: readonly CorrelationRule[] = [
  "same-repository-revision",
  "same-path",
  "same-range",
  "same-kind",
  "same-qualified-name",
  "same-alias",
  "same-name",
  "same-signature",
];

/**
 * Converts provider paths to a repository-relative, slash-separated form.
 * This intentionally does not consult the host filesystem.
 */
export function normalizeRepositoryPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.trim().replaceAll("\\", "/").split("/")) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || ".";
}

/**
 * Converts common TypeScript/Graft (`L1C1-L1C4`), SCIP (`0:0-0:3`), and
 * packed SCIP ranges to the same one-based representation.
 */
export function normalizeSourceRange(
  value: SourceRangeInput | undefined,
  providerId = "",
  rangeBase?: RangeBase,
): NormalizedSourceRange | undefined {
  if (value === undefined) return undefined;

  if (isNumberArray(value)) {
    if (value.length !== 3 && value.length !== 4) return undefined;
    const numbers = value.map((part) => Number(part));
    if (numbers.some((part) => !Number.isInteger(part) || part < 0)) return undefined;
    const zeroBased = (rangeBase ?? defaultRangeBase(providerId)) === "zero-based";
    const [startLine, startColumn, endLine, endColumn] =
      numbers.length === 3 ? [numbers[0], numbers[1], numbers[0], numbers[2]] : numbers;
    return makeRange(startLine, startColumn, endLine, endColumn, zeroBased);
  }

  if (typeof value === "object") {
    if (
      !Number.isInteger(value.startLine) ||
      value.startLine < 1 ||
      !Number.isInteger(value.endLine) ||
      value.endLine < 1 ||
      (value.startColumn !== undefined && (!Number.isInteger(value.startColumn) || value.startColumn < 1)) ||
      (value.endColumn !== undefined && (!Number.isInteger(value.endColumn) || value.endColumn < 1))
    ) {
      return undefined;
    }
    return { ...value };
  }

  const text = value.trim();
  const labelled = /^L(\d+)(?:C(\d+))?(?:-L?(\d+)(?:C(\d+))?)?$/iu.exec(text);
  if (labelled) {
    const startLine = Number(labelled[1]);
    const startColumn = labelled[2] === undefined ? undefined : Number(labelled[2]);
    const endLine = labelled[3] === undefined ? startLine : Number(labelled[3]);
    const endColumn = labelled[4] === undefined ? undefined : Number(labelled[4]);
    return makeRange(startLine, startColumn, endLine, endColumn, false);
  }

  const numeric = /^(\d+):(\d+)-(\d+):(\d+)$/u.exec(text);
  if (numeric) {
    const zeroBased = (rangeBase ?? defaultRangeBase(providerId)) === "zero-based";
    return makeRange(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]), Number(numeric[4]), zeroBased);
  }

  return undefined;
}

function defaultRangeBase(providerId: string): RangeBase {
  return providerId === "scip-typescript" || providerId === "scip" ? "zero-based" : "one-based";
}

function makeRange(
  startLine: number,
  startColumn: number | undefined,
  endLine: number,
  endColumn: number | undefined,
  zeroBased: boolean,
): NormalizedSourceRange | undefined {
  const lineOffset = zeroBased ? 1 : 0;
  const columnOffset = zeroBased ? 1 : 0;
  const normalized: NormalizedSourceRange = {
    startLine: startLine + lineOffset,
    endLine: endLine + lineOffset,
    ...(startColumn === undefined ? {} : { startColumn: startColumn + columnOffset }),
    ...(endColumn === undefined ? {} : { endColumn: endColumn + columnOffset }),
  };
  if (normalized.startLine > normalized.endLine) return undefined;
  if (
    normalized.startLine === normalized.endLine &&
    normalized.startColumn !== undefined &&
    normalized.endColumn !== undefined &&
    normalized.startColumn > normalized.endColumn
  ) {
    return undefined;
  }
  return normalized;
}

/** Correlates provider-native entities using only deterministic local rules. */
export function correlateProviderEntities(inputs: readonly ProviderEntityInput[]): CorrelationResult {
  const entities = normalizeEntities(inputs);
  const candidateBuild = buildCandidateEdges(entities);
  const edges = candidateBuild.edges;
  const edgeIndex = indexEdges(edges, entities);
  const groups = buildGroups(entities, edges);
  const entityGroup = new Map<number, EntityGroup>();
  for (const group of groups) {
    for (const index of group.indices) entityGroup.set(index, group);
  }

  const canonicalIds = new Map<EntityGroup, string>();
  for (const group of groups) {
    canonicalIds.set(group, makeCanonicalId(group, entities));
  }

  const links = edges.map((edge) => toCorrelationLink(edge, entities, edgeIndex)).sort(compareLinks);

  const canonicalEntities = groups
    .map((group) => {
      const canonicalId = canonicalIds.get(group);
      if (canonicalId === undefined) throw new Error("internal correlation group has no identity");
      return toCanonicalEntity(group, canonicalId, entities, edgeIndex, entityGroup, canonicalIds);
    })
    .sort((left, right) => compareCodeUnits(left.canonicalId, right.canonicalId));

  return {
    canonicalEntities,
    links,
    metrics: buildMetrics(entities, edgeIndex, groups, entityGroup, canonicalIds),
    diagnostics: candidateBuild.diagnostics,
  };
}

/** Short alias for callers that already have provider entities. */
export const correlateEntities = correlateProviderEntities;

/** Extracts definition/structural entities from the existing Observation envelope. */
export function providerEntitiesFromObservations(observations: readonly Observation[]): ProviderEntityInput[] {
  return extractProviderEntities(observations, true);
}

/**
 * Extracts every endpoint represented by observations. Definitions are still
 * preferred by the fact normalizer, but relation-only endpoints (for example
 * call sites) must remain available when no definition observation exists.
 */
export function providerEntitiesFromAllObservations(observations: readonly Observation[]): ProviderEntityInput[] {
  return extractProviderEntities(observations, false);
}

function extractProviderEntities(
  observations: readonly Observation[],
  preferDefinitions: boolean,
): ProviderEntityInput[] {
  const byProvider = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = providerKey(observation.provider);
    const list = byProvider.get(key) ?? [];
    list.push(observation);
    byProvider.set(key, list);
  }

  const entities: ProviderEntityInput[] = [];
  for (const providerObservations of byProvider.values()) {
    const hasDefinitions = providerObservations.some((observation) => observation.predicate === "defines");
    for (const observation of providerObservations) {
      if (preferDefinitions && hasDefinitions && observation.predicate !== "defines") continue;

      const endpoints: ObservationEntity[] = [];
      if (observation.predicate === "defines") {
        if (isObservationEntity(observation.object)) {
          endpoints.push(observation.object);
        } else {
          endpoints.push(observation.subject);
        }
      } else {
        endpoints.push(observation.subject);
        if (isObservationEntity(observation.object)) endpoints.push(observation.object);
      }

      for (const endpoint of endpoints) {
        entities.push(toProviderEntityInput(observation, endpoint));
      }
    }
  }
  return entities;
}

/** Correlates the provider-native entities represented by observations. */
export function correlateObservations(observations: readonly Observation[]): CorrelationResult {
  return correlateProviderEntities(providerEntitiesFromObservations(observations));
}

function toProviderEntityInput(observation: Observation, endpoint: ObservationEntity): ProviderEntityInput {
  const native = asRecord(observation.providerNative);
  const nativeNode = asRecord(native?.node);
  const sourceNode = asRecord(native?.sourceNode);
  const targetNode = asRecord(native?.targetNode);
  const endpointNode = [sourceNode, targetNode, nativeNode].find(
    (candidate) => stringValue(candidate?.id) === endpoint.id,
  );
  const nativeRecord = endpointNode ?? nativeNode ?? native;
  const nativeId = stringValue(nativeRecord?.id);
  const endpointIsNode = nativeId === endpoint.id;
  const pathValue = (endpointIsNode ? stringValue(nativeRecord?.path) : undefined) ?? observation.source.path;
  const spanValue = (endpointIsNode ? stringValue(nativeRecord?.span) : undefined) ?? observation.source.span;
  const nativeName = endpointIsNode ? stringValue(nativeRecord?.name) : undefined;
  const nativeQualifiedName = endpointIsNode ? stringValue(nativeRecord?.qualifiedName) : undefined;
  const nativeSignature = endpointIsNode
    ? (stringValue(nativeRecord?.signature) ?? stringValue(nativeRecord?.type))
    : undefined;
  const nativeAliases = endpointIsNode ? stringArray(nativeRecord?.aliases) : [];
  const inferredName = nativeName ?? lastSymbolPart(nativeQualifiedName ?? endpoint.id);

  return {
    provider: observation.provider,
    repository: observation.repository,
    id: endpoint.id,
    kind: endpoint.kind,
    path: pathValue,
    span: spanValue,
    name: inferredName,
    qualifiedName: nativeQualifiedName ?? endpoint.id,
    signature: nativeSignature,
    aliases: nativeAliases,
    providerNative: observation.providerNative,
  };
}

function isObservationEntity(value: Observation["object"]): value is ObservationEntity {
  const record = asRecord(value);
  return record !== undefined && typeof record.id === "string" && typeof record.kind === "string";
}

function normalizeEntities(inputs: readonly ProviderEntityInput[]): NormalizedEntity[] {
  const normalized = inputs.map((input) => {
    const pathValue = input.path ?? input.source?.path;
    const spanValue = input.range ?? input.span ?? input.source?.span;
    const pathNormalized = pathValue === undefined ? undefined : normalizeRepositoryPath(pathValue);
    const rangeNormalized = normalizeSourceRange(spanValue, input.provider.id, input.rangeBase);
    const aliases = uniqueSorted(
      (input.aliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    );
    const qualifiedName = cleanOptional(input.qualifiedName);
    const name = cleanOptional(input.name);
    const signature = cleanOptional(input.signature);
    const qualifiedKeys = uniqueSorted(qualifiedName === undefined ? [] : symbolKeys(qualifiedName));
    const aliasKeys = uniqueSorted(aliases.flatMap((alias) => symbolKeys(alias)));
    const nameKeys = uniqueSorted([
      ...(name === undefined ? [] : symbolKeys(name)),
      ...(qualifiedName === undefined ? [] : symbolKeys(qualifiedName)),
      ...aliasKeys,
    ]);
    const signatureKey = signature === undefined ? undefined : normalizeSignature(signature);
    const kind = cleanOptional(input.kind) ?? "unknown";
    const kindFamily = kindFamilyOf(kind);
    const providerKeyValue = providerKey(input.provider);
    const repositoryKeyValue = repositoryKey(input.repository);
    const id = input.id.trim();
    const providerNativeSerialized = stableSerialize(input.providerNative);
    const key = stableSerialize({
      provider: providerKeyValue,
      repository: repositoryKeyValue,
      id,
      kind: kindFamily,
      path: pathNormalized,
      range: rangeNormalized,
      name: nameKeys,
      qualifiedName: qualifiedKeys,
      aliases: aliasKeys,
      signature: signatureKey,
    });
    return {
      input,
      providerKey: providerKeyValue,
      repositoryKey: repositoryKeyValue,
      id,
      kind,
      kindFamily,
      path: pathNormalized,
      range: rangeNormalized,
      name,
      qualifiedName,
      signature,
      aliases,
      qualifiedKeys,
      aliasKeys,
      nameKeys,
      signatureKey,
      key,
      providerNativeSerialized,
    };
  });

  normalized.sort(compareEntities);
  const deduplicated: NormalizedEntity[] = [];
  for (const entity of normalized) {
    const previous = deduplicated[deduplicated.length - 1];
    if (previous?.key !== entity.key) {
      deduplicated.push(entity);
      continue;
    }
    // The provider-native payload is not part of identity. Choosing the
    // lexicographically first payload keeps duplicate observations stable.
    if (entity.providerNativeSerialized < previous.providerNativeSerialized) {
      deduplicated[deduplicated.length - 1] = entity;
    }
  }
  return deduplicated;
}

function compareEntities(left: NormalizedEntity, right: NormalizedEntity): number {
  const keyCompare = compareCodeUnits(left.key, right.key);
  if (keyCompare !== 0) return keyCompare;
  return compareCodeUnits(left.providerNativeSerialized, right.providerNativeSerialized);
}

/**
 * Builds candidate edges without ever materializing the full Cartesian
 * product of a large same-key bucket. The index is provider-aware (`key ->
 * provider -> entity indices`), so same-provider pairs are never candidates
 * and every bucket is inherently a multipartite graph across providers
 * rather than an undifferentiated clique.
 *
 * Buckets are split into two regimes:
 *  - "strong" key classes (path+range, normalized qualified identity,
 *    path+signature, exact signature) are evidence that is close to unique
 *    per entity; they are expanded directly since bucket sizes stay small
 *    in practice, and a bucket that is NOT small is still bounded by the
 *    per-key/global caps below.
 *  - "weak" key classes (bare name matches, path+kind fallbacks) commonly
 *    produce large multi-provider buckets (e.g. every overload named `get`).
 *    These are still fully compared pairwise (recall must not regress), but
 *    materialization is bounded by the same per-key/global pair caps so a
 *    single enormous bucket cannot dominate runtime; buckets that exceed the
 *    bound are recorded in diagnostics instead of silently truncated.
 */
function buildCandidateEdges(entities: readonly NormalizedEntity[]): CandidateEdgeBuild {
  const buckets = new Map<string, Map<string, number[]>>();
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    for (const key of candidateKeys(entity)) {
      const byProvider = buckets.get(key) ?? new Map<string, number[]>();
      const indices = byProvider.get(entity.providerKey) ?? [];
      indices.push(index);
      byProvider.set(entity.providerKey, indices);
      buckets.set(key, byProvider);
    }
  }

  const pairKeys = new Set<string>();
  const skippedByClass = new Map<string, { keyCount: number; potentialPairCount: number }>();
  let indexedKeyCount = 0;
  let totalMaterializedPairs = 0;

  const bucketKeys = [...buckets.keys()].sort(compareCodeUnits);
  for (const key of bucketKeys) {
    const byProvider = buckets.get(key);
    if (byProvider === undefined) continue;
    const providerKeys = [...byProvider.keys()].sort(compareCodeUnits);
    const totalEntities = providerKeys.reduce((sum, provider) => sum + (byProvider.get(provider)?.length ?? 0), 0);
    // Cross-provider potential pairs only: same-provider pairs never
    // generate a candidate edge, so they must not count against the cap.
    const potentialPairCount = crossProviderPairCount(providerKeys, byProvider);
    const perKeyLimit = WEAK_KEY_CLASSES.has(keyClassOf(key))
      ? MAX_WEAK_CANDIDATE_PAIRS_PER_KEY
      : MAX_CANDIDATE_PAIRS_PER_KEY;
    if (potentialPairCount > perKeyLimit || totalMaterializedPairs + potentialPairCount > MAX_TOTAL_CANDIDATE_PAIRS) {
      const keyClass = keyClassOf(key);
      const current = skippedByClass.get(keyClass) ?? { keyCount: 0, potentialPairCount: 0 };
      current.keyCount += 1;
      current.potentialPairCount += potentialPairCount;
      skippedByClass.set(keyClass, current);
      continue;
    }
    if (totalEntities < 2) continue;
    indexedKeyCount += 1;
    totalMaterializedPairs += potentialPairCount;
    for (let leftProvider = 0; leftProvider < providerKeys.length; leftProvider += 1) {
      const leftIndices = byProvider.get(providerKeys[leftProvider]) ?? [];
      for (let rightProvider = leftProvider + 1; rightProvider < providerKeys.length; rightProvider += 1) {
        const rightIndices = byProvider.get(providerKeys[rightProvider]) ?? [];
        for (const first of leftIndices) {
          for (const second of rightIndices) {
            const low = Math.min(first, second);
            const high = Math.max(first, second);
            pairKeys.add(`${low} ${high}`);
          }
        }
      }
    }
  }

  const edges: CandidateEdge[] = [];
  for (const pairKey of pairKeys) {
    const separator = pairKey.indexOf(" ");
    const left = Number(pairKey.slice(0, separator));
    const right = Number(pairKey.slice(separator + 1));
    const edge = compareEntityPair(left, right, entities[left], entities[right]);
    if (edge !== undefined) edges.push(edge);
  }
  const skippedKeys = [...skippedByClass.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([keyClass, value]) => ({ keyClass, ...value }));
  return {
    edges: edges.sort(compareEdges),
    diagnostics: {
      maxCandidatePairsPerKey: MAX_CANDIDATE_PAIRS_PER_KEY,
      indexedKeyCount,
      skippedKeyCount: skippedKeys.reduce((count, item) => count + item.keyCount, 0),
      skippedPotentialPairCount: skippedKeys.reduce((count, item) => count + item.potentialPairCount, 0),
      skippedKeys,
    },
  };
}

function crossProviderPairCount(providerKeys: readonly string[], byProvider: ReadonlyMap<string, number[]>): number {
  let total = 0;
  let seenCount = 0;
  for (const provider of providerKeys) {
    const count = byProvider.get(provider)?.length ?? 0;
    total += seenCount * count;
    seenCount += count;
  }
  return total;
}

function keyClassOf(key: string): string {
  return key.split(":", 1)[0] ?? "unknown";
}

/**
 * Candidate generation is indexed by the same normalized keys
 * `compareEntityPair` uses for scoring (`qualifiedKeys`, `aliasKeys`,
 * `nameKeys`), not raw `qualifiedName`/`aliases` strings. Indexing raw
 * strings under-recalls: `ns.Type` and `Type` share the normalized key
 * `Type` and can score under `same-alias`/`same-qualified-name`, but their
 * raw strings never collide. Every normalized key that appears in
 * `compareEntityPair`'s scoring surface must appear here so the fast index
 * never silently drops a match the final comparator would have accepted.
 */
function candidateKeys(entity: NormalizedEntity): string[] {
  const keys = new Set<string>();
  if (entity.path !== undefined && entity.range !== undefined) {
    keys.add(`path-range:${entity.path}:${stableSerialize(entity.range)}`);
  }
  if (entity.path !== undefined && entity.signatureKey !== undefined) {
    keys.add(`path-signature:${entity.path}:${entity.signatureKey}`);
  }
  if (entity.signatureKey !== undefined) keys.add(`signature:${entity.signatureKey}`);
  for (const qualifiedKey of entity.qualifiedKeys) keys.add(`qualified-exact:${qualifiedKey}`);
  for (const aliasKey of entity.aliasKeys) keys.add(`alias-match-exact:${aliasKey}`);
  for (const qualifiedKey of entity.qualifiedKeys) keys.add(`alias-match-exact:${qualifiedKey}`);
  // A bare token such as "type" or "0" is not a useful cross-file
  // candidate key on its own. `nameKeys` normalization already folds
  // name/qualifiedName/aliases together; index it directly so cross-path
  // name matches (score 48 via `sameName`) are still generated, while
  // path-qualified variants remain additionally indexed for locality.
  for (const nameKey of entity.nameKeys) keys.add(`name-exact:${nameKey}`);
  if (entity.path !== undefined && entity.name !== undefined) {
    keys.add(`path-name-exact:${entity.path}:${entity.name}`);
  }
  if (
    entity.path !== undefined &&
    entity.name === undefined &&
    entity.qualifiedName === undefined &&
    entity.aliases.length === 0
  ) {
    keys.add(`path-kind:${entity.path}:${entity.kindFamily}`);
  }
  return [...keys].sort(compareCodeUnits);
}

function indexEdges(edges: readonly CandidateEdge[], entities: readonly NormalizedEntity[]): EdgeIndex {
  const incident = new Map<number, CandidateEdge[]>();
  const targets = new Map<number, Map<string, Set<number>>>();
  const addIncident = (index: number, edge: CandidateEdge): void => {
    const values = incident.get(index) ?? [];
    values.push(edge);
    incident.set(index, values);
  };
  const addTarget = (index: number, provider: string, target: number): void => {
    const byProvider = targets.get(index) ?? new Map<string, Set<number>>();
    const values = byProvider.get(provider) ?? new Set<number>();
    values.add(target);
    byProvider.set(provider, values);
    targets.set(index, byProvider);
  };
  for (const edge of edges) {
    addIncident(edge.left, edge);
    addIncident(edge.right, edge);
    addTarget(edge.left, entities[edge.right].providerKey, edge.right);
    addTarget(edge.right, entities[edge.left].providerKey, edge.left);
  }
  for (const values of incident.values()) values.sort(compareEdges);
  return { incident, targets };
}

function uniqueEdges(edges: readonly CandidateEdge[]): CandidateEdge[] {
  const byKey = new Map<string, CandidateEdge>();
  for (const edge of edges) byKey.set(`${edge.left} ${edge.right}`, edge);
  return [...byKey.values()].sort(compareEdges);
}

function compareEntityPair(
  left: number,
  right: number,
  first: NormalizedEntity,
  second: NormalizedEntity,
): CandidateEdge | undefined {
  if (first.providerKey === second.providerKey || first.repositoryKey !== second.repositoryKey) return undefined;
  if (!kindCompatible(first.kindFamily, second.kindFamily)) return undefined;

  const samePath = first.path !== undefined && first.path === second.path;
  const sameRange = rangesEqual(first.range, second.range);
  const sameKind = first.kindFamily === second.kindFamily;
  const sameQualifiedName = intersects(first.qualifiedKeys, second.qualifiedKeys);
  const sameAlias =
    intersects(first.aliasKeys, second.aliasKeys) ||
    intersects(first.aliasKeys, second.qualifiedKeys) ||
    intersects(first.qualifiedKeys, second.aliasKeys);
  const sameName = intersects(first.nameKeys, second.nameKeys);
  const sameSignature =
    first.signatureKey !== undefined && second.signatureKey !== undefined && first.signatureKey === second.signatureKey;

  const rules: CorrelationRule[] = ["same-repository-revision"];
  if (samePath) rules.push("same-path");
  if (sameRange) rules.push("same-range");
  if (sameKind) rules.push("same-kind");
  if (sameQualifiedName) rules.push("same-qualified-name");
  if (sameAlias) rules.push("same-alias");
  if (sameName) rules.push("same-name");
  if (sameSignature) rules.push("same-signature");

  let score: number | undefined;
  if (samePath && sameRange) {
    score = 100;
  } else if ((sameQualifiedName || sameAlias) && kindCompatible(first.kindFamily, second.kindFamily)) {
    score = 86 + (samePath ? 4 : 0) + (sameSignature ? 3 : 0);
  } else if (samePath && sameSignature && kindCompatible(first.kindFamily, second.kindFamily)) {
    score = 82;
  } else if (samePath && sameName && kindCompatible(first.kindFamily, second.kindFamily)) {
    score = 68;
  } else if (sameSignature && kindCompatible(first.kindFamily, second.kindFamily)) {
    score = 58;
  } else if (samePath && sameKind && first.nameKeys.length === 0 && second.nameKeys.length === 0) {
    score = 45;
  } else if (sameName && kindCompatible(first.kindFamily, second.kindFamily)) {
    score = 48;
  }

  if (score === undefined) return undefined;
  return {
    left,
    right,
    score,
    strength: score >= 80 ? "matched" : "probable",
    rules: sortRules(rules),
  };
}

/**
 * Union-Find (disjoint-set) grouping, processed one score band at a time
 * from strongest to weakest — overloads and other high-precision evidence
 * group before a shared weak key (e.g. `same-name`) could connect unrelated
 * entities. Within one score band, edges are evaluated together (as a
 * batch, matching the previous per-score connected-components pass) rather
 * than one at a time: every root touched by an edge in this band is grouped
 * by connectivity first, and a group whose members would collide two
 * entities from the same provider is entirely rejected and permanently
 * `blocked` from any further merge (in this band or any weaker one) —
 * matching the original semantics where a provider collision removes every
 * involved entity from further consideration rather than partially merging
 * around it. Groups that don't collide are committed via ordinary
 * union-find. This keeps the incremental structure (no full edge re-filter
 * across the whole edge set) while preserving the batch-collision
 * semantics a strictly incremental one-edge-at-a-time union cannot express.
 */
function buildGroups(entities: readonly NormalizedEntity[], edges: readonly CandidateEdge[]): EntityGroup[] {
  const parent = Array.from({ length: entities.length }, (_, index) => index);
  const rank = new Array<number>(entities.length).fill(0);
  const memberProviders = entities.map((entity) => new Set<string>([entity.providerKey]));
  const blocked = new Set<number>();

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };

  const commitUnion = (leftRoot: number, rightRoot: number): number => {
    if (leftRoot === rightRoot) return leftRoot;
    const leftProviders = memberProviders[leftRoot];
    const rightProviders = memberProviders[rightRoot];
    const [survivor, absorbed] = rank[leftRoot] >= rank[rightRoot] ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
    const survivorProviders = survivor === leftRoot ? leftProviders : rightProviders;
    const absorbedProviders = survivor === leftRoot ? rightProviders : leftProviders;
    parent[absorbed] = survivor;
    if (rank[leftRoot] === rank[rightRoot]) rank[survivor] += 1;
    for (const provider of absorbedProviders) survivorProviders.add(provider);
    return survivor;
  };

  const edgesByScore = new Map<number, CandidateEdge[]>();
  for (const edge of edges) {
    const group = edgesByScore.get(edge.score) ?? [];
    group.push(edge);
    edgesByScore.set(edge.score, group);
  }
  const scores = [...edgesByScore.keys()].sort((left, right) => right - left);
  for (const score of scores) {
    const bandEdges = (edgesByScore.get(score) ?? []).filter(
      (edge) => !blocked.has(find(edge.left)) && !blocked.has(find(edge.right)),
    );
    if (bandEdges.length === 0) continue;

    // Group this band's edges by root-level connectivity (a lightweight,
    // band-local union-find) before committing anything, so a collision
    // anywhere in a connected cluster blocks the whole cluster — matching
    // batch connected-components semantics.
    const bandParent = new Map<number, number>();
    const bandFind = (root: number): number => {
      let cursor = root;
      while (bandParent.has(cursor) && bandParent.get(cursor) !== cursor) cursor = bandParent.get(cursor) as number;
      if (!bandParent.has(cursor)) bandParent.set(cursor, cursor);
      let walk = root;
      while (bandParent.get(walk) !== cursor) {
        const next = bandParent.get(walk) as number;
        bandParent.set(walk, cursor);
        walk = next;
      }
      return cursor;
    };
    const bandUnion = (left: number, right: number): void => {
      const leftRoot = bandFind(left);
      const rightRoot = bandFind(right);
      if (leftRoot !== rightRoot) bandParent.set(leftRoot, rightRoot);
    };
    for (const edge of bandEdges) bandUnion(find(edge.left), find(edge.right));

    const clusters = new Map<number, Set<number>>();
    for (const edge of bandEdges) {
      for (const root of [find(edge.left), find(edge.right)]) {
        const clusterRoot = bandFind(root);
        const members = clusters.get(clusterRoot) ?? new Set<number>();
        members.add(root);
        clusters.set(clusterRoot, members);
      }
    }

    for (const roots of clusters.values()) {
      const sortedRoots = [...roots].sort((left, right) => left - right);
      const seenProviders = new Set<string>();
      let collides = false;
      for (const root of sortedRoots) {
        for (const provider of memberProviders[root]) {
          if (seenProviders.has(provider)) {
            collides = true;
            break;
          }
          seenProviders.add(provider);
        }
        if (collides) break;
      }
      if (collides) {
        for (const root of sortedRoots) blocked.add(root);
        continue;
      }
      let merged = sortedRoots[0];
      for (let index = 1; index < sortedRoots.length; index += 1) {
        merged = commitUnion(merged, sortedRoots[index]);
      }
    }
  }

  const rootOf = (index: number): number => find(index);

  const rootsByEntity = new Map<number, number[]>();
  for (let index = 0; index < entities.length; index += 1) {
    const root = rootOf(index);
    const members = rootsByEntity.get(root) ?? [];
    members.push(index);
    rootsByEntity.set(root, members);
  }

  const strongestScore = new Map<number, number>();
  for (const edge of edges) {
    const leftRoot = rootOf(edge.left);
    if (leftRoot !== rootOf(edge.right)) continue;
    const current = strongestScore.get(leftRoot) ?? 0;
    if (edge.score > current) strongestScore.set(leftRoot, edge.score);
  }

  const groups: EntityGroup[] = [];
  for (const [root, indices] of rootsByEntity) {
    const sortedIndices = indices.sort((left, right) => left - right);
    if (sortedIndices.length < 2) {
      groups.push({ indices: sortedIndices, strength: "probable" });
      continue;
    }
    const bestScore = strongestScore.get(root) ?? 0;
    groups.push({ indices: sortedIndices, strength: bestScore >= 80 ? "matched" : "probable" });
  }
  return groups.sort((left, right) => compareCodeUnits(entities[left.indices[0]].key, entities[right.indices[0]].key));
}

function makeCanonicalId(group: EntityGroup, entities: readonly NormalizedEntity[]): string {
  const repository = entities[group.indices[0]].repositoryKey;
  const members = group.indices.map((index) => entities[index].key).sort(compareCodeUnits);
  const digest = createHash("sha256").update(stableSerialize({ repository, members })).digest("hex");
  return `ce_${digest}`;
}

function toCanonicalEntity(
  group: EntityGroup,
  canonicalId: string,
  entities: readonly NormalizedEntity[],
  edgeIndex: EdgeIndex,
  entityGroup: ReadonlyMap<number, EntityGroup>,
  canonicalIds: ReadonlyMap<EntityGroup, string>,
): CanonicalEntity {
  const groupIndices = new Set(group.indices);
  const members = group.indices.map((index) => toCanonicalMember(entities[index])).sort(compareMembers);
  const incidentEdges = uniqueEdges(group.indices.flatMap((index) => edgeIndex.incident.get(index) ?? []));
  const internalEdges = incidentEdges.filter((edge) => groupIndices.has(edge.left) && groupIndices.has(edge.right));
  const candidateCanonicalIds = uniqueSorted(
    incidentEdges
      .flatMap((edge) => {
        const other = groupIndices.has(edge.left) ? edge.right : edge.left;
        const otherGroup = entityGroup.get(other);
        const otherId = otherGroup === undefined ? undefined : canonicalIds.get(otherGroup);
        return otherId === undefined || otherId === canonicalId ? [] : [otherId];
      })
      .filter((id): id is string => id !== undefined),
  );
  const status: CorrelationStatus =
    group.indices.length > 1
      ? group.strength === "matched"
        ? "matched"
        : "probable"
      : incidentEdges.length > 0
        ? "ambiguous"
        : "unmatched";
  const cardinality = groupCardinality(groupIndices, incidentEdges, edgeIndex, entities);
  const reason: CorrelationRationale["reason"] =
    status === "unmatched"
      ? "no-cross-provider-evidence"
      : status === "ambiguous"
        ? cardinality === "one-to-many" || cardinality === "many-to-one" || cardinality === "many-to-many"
          ? "provider-cardinality-conflict"
          : "competing-evidence"
        : status === "probable"
          ? "probable-evidence"
          : "deterministic-evidence";
  const evidence = internalEdges.length > 0 ? internalEdges : incidentEdges;
  const rules = sortRules(uniqueRules(evidence.flatMap((edge) => edge.rules)));
  const repository = entities[group.indices[0]].input.repository;

  return {
    canonicalId,
    identity: canonicalId,
    repository,
    kind: canonicalKind(group.indices.map((index) => entities[index].kindFamily)),
    status,
    members,
    candidateCanonicalIds,
    rationale: {
      method: "deterministic-rules",
      reason,
      cardinality,
      rules,
      evidence: evidence.map((edge) => toEvidence(edge, entities)).sort(compareEvidence),
    },
  };
}

function toCanonicalMember(entity: NormalizedEntity): CanonicalEntityMember {
  return {
    provider: entity.input.provider,
    nativeId: entity.id,
    kind: entity.kind,
    canonicalKind: entity.kindFamily,
    repository: entity.input.repository,
    ...(entity.path === undefined ? {} : { path: entity.path }),
    ...(entity.range === undefined ? {} : { range: entity.range }),
    ...(entity.name === undefined ? {} : { name: entity.name }),
    ...(entity.qualifiedName === undefined ? {} : { qualifiedName: entity.qualifiedName }),
    ...(entity.signature === undefined ? {} : { signature: entity.signature }),
    aliases: entity.aliases,
    providerNative: entity.input.providerNative,
  };
}

function toEvidence(edge: CandidateEdge, entities: readonly NormalizedEntity[]): CorrelationEvidence {
  return {
    left: toReference(entities[edge.left]),
    right: toReference(entities[edge.right]),
    score: edge.score,
    rules: edge.rules,
  };
}

function toCorrelationLink(
  edge: CandidateEdge,
  entities: readonly NormalizedEntity[],
  edgeIndex: EdgeIndex,
): CorrelationLink {
  return {
    left: toReference(entities[edge.left]),
    right: toReference(entities[edge.right]),
    score: edge.score,
    strength: edge.strength,
    cardinality: edgeCardinality(edge, edgeIndex, entities),
    rules: edge.rules,
  };
}

function toReference(entity: NormalizedEntity): ProviderEntityReference {
  return {
    provider: entity.input.provider,
    nativeId: entity.id,
    kind: entity.kind,
    ...(entity.path === undefined ? {} : { path: entity.path }),
    ...(entity.range === undefined ? {} : { range: entity.range }),
  };
}

function edgeCardinality(
  edge: CandidateEdge,
  edgeIndex: EdgeIndex,
  entities: readonly NormalizedEntity[],
): CorrelationCardinality {
  const leftTargets = edgeIndex.targets.get(edge.left)?.get(entities[edge.right].providerKey) ?? new Set<number>();
  const rightTargets = edgeIndex.targets.get(edge.right)?.get(entities[edge.left].providerKey) ?? new Set<number>();
  if (leftTargets.size > 1 && rightTargets.size > 1) return "many-to-many";
  if (leftTargets.size > 1) return "one-to-many";
  if (rightTargets.size > 1) return "many-to-one";
  return "one-to-one";
}

function groupCardinality(
  groupIndices: ReadonlySet<number>,
  incidentEdges: readonly CandidateEdge[],
  edgeIndex: EdgeIndex,
  entities: readonly NormalizedEntity[],
): CorrelationCardinality {
  if (incidentEdges.length === 0) return "unmatched";
  let oneToMany = false;
  let manyToOne = false;
  let manyToMany = false;
  for (const edge of incidentEdges) {
    const cardinality = edgeCardinality(edge, edgeIndex, entities);
    if (cardinality === "many-to-many") manyToMany = true;
    if (cardinality === "one-to-many") {
      if (groupIndices.has(edge.left)) oneToMany = true;
      if (groupIndices.has(edge.right)) manyToOne = true;
    }
    if (cardinality === "many-to-one") {
      if (groupIndices.has(edge.left)) oneToMany = true;
      if (groupIndices.has(edge.right)) manyToOne = true;
    }
  }
  if (manyToMany || (oneToMany && manyToOne)) return "many-to-many";
  if (oneToMany) return "one-to-many";
  if (manyToOne) return "many-to-one";
  return "one-to-one";
}

function buildMetrics(
  entities: readonly NormalizedEntity[],
  edgeIndex: EdgeIndex,
  groups: readonly EntityGroup[],
  entityGroup: ReadonlyMap<number, EntityGroup>,
  canonicalIds: ReadonlyMap<EntityGroup, string>,
): Readonly<Record<string, ProviderCorrelationMetrics>> {
  const providerEntries = new Map<string, { provider: ProviderIdentity; indices: number[] }>();
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    const key = entity.input.provider.id;
    const entry = providerEntries.get(key) ?? { provider: entity.input.provider, indices: [] };
    entry.indices.push(index);
    providerEntries.set(key, entry);
  }

  const result: Record<string, ProviderCorrelationMetrics> = {};
  for (const key of [...providerEntries.keys()].sort(compareCodeUnits)) {
    const entry = providerEntries.get(key);
    if (entry === undefined) continue;
    const statusCounts: Record<CorrelationStatus, number> = {
      matched: 0,
      probable: 0,
      ambiguous: 0,
      unmatched: 0,
    };
    const canonicalEntityIds = new Set<string>();
    let candidateCount = 0;
    for (const index of entry.indices) {
      const group = entityGroup.get(index);
      if (group !== undefined) {
        const canonicalId = canonicalIds.get(group);
        if (canonicalId !== undefined) canonicalEntityIds.add(canonicalId);
      }
      const incident = edgeIndex.incident.get(index) ?? [];
      candidateCount += incident.length;
      const status: CorrelationStatus =
        group === undefined
          ? "unmatched"
          : group.indices.length > 1
            ? group.strength
            : incident.length > 0
              ? "ambiguous"
              : "unmatched";
      statusCounts[status] += 1;
    }
    result[key] = {
      provider: entry.provider,
      total: entry.indices.length,
      canonicalEntityCount: canonicalEntityIds.size,
      candidateCount,
      matched: statusCounts.matched,
      probable: statusCounts.probable,
      ambiguous: statusCounts.ambiguous,
      unmatched: statusCounts.unmatched,
    };
  }
  return result;
}

function compareLinks(left: CorrelationLink, right: CorrelationLink): number {
  const providerCompare = compareCodeUnits(providerReferenceKey(left.left), providerReferenceKey(right.left));
  if (providerCompare !== 0) return providerCompare;
  return compareCodeUnits(providerReferenceKey(left.right), providerReferenceKey(right.right));
}

function compareEdges(left: CandidateEdge, right: CandidateEdge): number {
  if (left.left !== right.left) return left.left - right.left;
  if (left.right !== right.right) return left.right - right.right;
  return right.score - left.score;
}

function compareEvidence(left: CorrelationEvidence, right: CorrelationEvidence): number {
  const leftCompare = compareCodeUnits(providerReferenceKey(left.left), providerReferenceKey(right.left));
  if (leftCompare !== 0) return leftCompare;
  return compareCodeUnits(providerReferenceKey(left.right), providerReferenceKey(right.right));
}

function compareMembers(left: CanonicalEntityMember, right: CanonicalEntityMember): number {
  return compareCodeUnits(providerReferenceKey(left), providerReferenceKey(right));
}

function providerReferenceKey(reference: ProviderEntityReference): string {
  return stableSerialize({
    provider: providerKey(reference.provider),
    nativeId: reference.nativeId,
    kind: reference.kind,
    path: reference.path,
    range: reference.range,
  });
}

function providerKey(provider: ProviderIdentity): string {
  return `${provider.id} ${provider.version} ${provider.determinism}`;
}

function repositoryKey(repository: ResolvedRepository): string {
  return stableSerialize({ source: repository.source, commitSha: repository.commitSha });
}

function kindFamilyOf(kind: string): string {
  const normalized = kind.toLowerCase().replace(/[\s_-]/gu, "");
  if (/(function|method|callable)/u.test(normalized)) return "callable";
  if (/(class|constructor)/u.test(normalized)) return "class";
  if (/(interface)/u.test(normalized)) return "interface";
  if (/(typealias|typedef|type)/u.test(normalized)) return "type";
  if (/(enum)/u.test(normalized)) return "enum";
  if (/(variable|constant|const)/u.test(normalized)) return "variable";
  if (/(property|field|member)/u.test(normalized)) return "property";
  if (/(module|file|sourcefile)/u.test(normalized)) return "module";
  if (/(symbol|declaration|unknown)/u.test(normalized)) return "symbol";
  return normalized || "symbol";
}

function canonicalKind(kinds: readonly string[]): string {
  const unique = uniqueSorted(kinds);
  const specific = unique.filter((kind) => kind !== "symbol");
  if (specific.length === 1) return specific[0];
  return unique.length === 1 ? unique[0] : "symbol";
}

function kindCompatible(left: string, right: string): boolean {
  return left === right || left === "symbol" || right === "symbol";
}

function rangesEqual(left: NormalizedSourceRange | undefined, right: NormalizedSourceRange | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  return (
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn
  );
}

function normalizeSignature(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s*([(),:;<>[\]{}|&=])\s*/gu, "$1");
}

function symbolKeys(value: string): string[] {
  const normalized = value.trim().replace(/["']/gu, "");
  if (normalized.length === 0) return [];
  const keys = new Set<string>([normalized]);
  const parts = normalized.split(/[^A-Za-z0-9_$]+/u).filter((part) => part.length > 0);
  for (const part of parts) keys.add(part);
  return [...keys];
}

function lastSymbolPart(value: string): string | undefined {
  const keys = symbolKeys(value);
  return keys.length === 0 ? undefined : keys[keys.length - 1];
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function sortRules(rules: readonly CorrelationRule[]): CorrelationRule[] {
  const ruleSet = new Set(rules);
  return RULE_ORDER.filter((rule) => ruleSet.has(rule));
}

function uniqueRules(rules: readonly CorrelationRule[]): CorrelationRule[] {
  return [...new Set(rules)];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned.length === 0 ? undefined : cleaned;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === "string") : [];
}

function isNumberArray(value: SourceRangeInput): value is readonly number[] {
  return Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Deterministic ordering independent of host locale/ICU data. Artifact
 * ordering must reproduce identically across machines.
 */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
