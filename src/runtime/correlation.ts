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

export interface CorrelationResult {
  readonly canonicalEntities: readonly CanonicalEntity[];
  /** All deterministic candidate links, including links rejected by cardinality. */
  readonly links: readonly CorrelationLink[];
  /** Metrics are keyed by provider id; versions remain in each metric value. */
  readonly metrics: Readonly<Record<string, ProviderCorrelationMetrics>>;
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
}

interface CandidateEdge {
  readonly left: number;
  readonly right: number;
  readonly score: number;
  readonly strength: "matched" | "probable";
  readonly rules: readonly CorrelationRule[];
}

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
  const edges = buildCandidateEdges(entities);
  const groups = buildGroups(entities, edges);
  const entityGroup = new Map<number, EntityGroup>();
  for (const group of groups) {
    for (const index of group.indices) entityGroup.set(index, group);
  }

  const canonicalIds = new Map<EntityGroup, string>();
  for (const group of groups) {
    canonicalIds.set(group, makeCanonicalId(group, entities));
  }

  const links = edges.map((edge) => toCorrelationLink(edge, entities, edges)).sort(compareLinks);

  const canonicalEntities = groups
    .map((group) => {
      const canonicalId = canonicalIds.get(group);
      if (canonicalId === undefined) throw new Error("internal correlation group has no identity");
      return toCanonicalEntity(group, canonicalId, entities, edges, entityGroup, canonicalIds);
    })
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));

  return {
    canonicalEntities,
    links,
    metrics: buildMetrics(entities, edges, groups, entityGroup, canonicalIds),
  };
}

/** Short alias for callers that already have provider entities. */
export const correlateEntities = correlateProviderEntities;

/** Extracts definition/structural entities from the existing Observation envelope. */
export function providerEntitiesFromObservations(observations: readonly Observation[]): ProviderEntityInput[] {
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
      if (hasDefinitions && observation.predicate !== "defines") continue;

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
  const nativeRecord = nativeNode ?? native;
  const nativeId = stringValue(nativeRecord?.id);
  const endpointIsNode = nativeId === endpoint.id;
  const pathValue =
    (endpointIsNode ? stringValue(nativeRecord?.path) : undefined) ??
    stringValue(nativeRecord?.path) ??
    observation.source.path;
  const spanValue =
    (endpointIsNode ? stringValue(nativeRecord?.span) : undefined) ??
    stringValue(nativeRecord?.span) ??
    observation.source.span;
  const nativeName = stringValue(nativeRecord?.name);
  const nativeQualifiedName = stringValue(nativeRecord?.qualifiedName);
  const nativeSignature = stringValue(nativeRecord?.signature) ?? stringValue(nativeRecord?.type);
  const nativeAliases = stringArray(nativeRecord?.aliases);
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
    if (stableSerialize(entity.input.providerNative) < stableSerialize(previous.input.providerNative)) {
      deduplicated[deduplicated.length - 1] = entity;
    }
  }
  return deduplicated;
}

function compareEntities(left: NormalizedEntity, right: NormalizedEntity): number {
  const keyCompare = left.key.localeCompare(right.key);
  if (keyCompare !== 0) return keyCompare;
  return stableSerialize(left.input.providerNative).localeCompare(stableSerialize(right.input.providerNative));
}

function buildCandidateEdges(entities: readonly NormalizedEntity[]): CandidateEdge[] {
  const edges: CandidateEdge[] = [];
  for (let left = 0; left < entities.length; left += 1) {
    for (let right = left + 1; right < entities.length; right += 1) {
      const edge = compareEntityPair(left, right, entities[left], entities[right]);
      if (edge !== undefined) edges.push(edge);
    }
  }
  return edges.sort(compareEdges);
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

function buildGroups(entities: readonly NormalizedEntity[], edges: readonly CandidateEdge[]): EntityGroup[] {
  const assigned = new Set<number>();
  const blocked = new Set<number>();
  const groups: EntityGroup[] = [];

  // Consume evidence from strongest to weakest. This preserves overloads:
  // exact declaration locations are grouped before a shared qualified name
  // can connect every overload to every other overload.
  const scores = [...new Set(edges.map((edge) => edge.score))].sort((left, right) => right - left);
  for (const score of scores) {
    const eligible = new Set<number>();
    for (let index = 0; index < entities.length; index += 1) {
      if (!assigned.has(index) && !blocked.has(index)) eligible.add(index);
    }
    const scoreEdges = edges.filter(
      (edge) => edge.score === score && eligible.has(edge.left) && eligible.has(edge.right),
    );
    for (const component of connectedComponents(entities.length, scoreEdges, eligible)) {
      if (component.length < 2) continue;
      if (hasProviderCollision(component, entities)) {
        for (const index of component) blocked.add(index);
        continue;
      }
      const group: EntityGroup = { indices: component, strength: score >= 80 ? "matched" : "probable" };
      groups.push(group);
      for (const index of component) assigned.add(index);
    }
  }

  for (let index = 0; index < entities.length; index += 1) {
    if (!assigned.has(index)) {
      groups.push({ indices: [index], strength: "probable" });
    }
  }
  return groups.sort((left, right) => entities[left.indices[0]].key.localeCompare(entities[right.indices[0]].key));
}

function connectedComponents(
  entityCount: number,
  edges: readonly CandidateEdge[],
  eligible: ReadonlySet<number>,
): number[][] {
  const adjacency = Array.from({ length: entityCount }, () => [] as number[]);
  for (const edge of edges) {
    adjacency[edge.left].push(edge.right);
    adjacency[edge.right].push(edge.left);
  }
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const start of [...eligible].sort((left, right) => left - right)) {
    if (visited.has(start) || adjacency[start].length === 0) continue;
    const stack = [start];
    const component: number[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const next of adjacency[current].slice().sort((left, right) => right - left)) {
        if (!visited.has(next)) stack.push(next);
      }
    }
    components.push(component.sort((left, right) => left - right));
  }
  return components.sort((left, right) => left[0] - right[0]);
}

function hasProviderCollision(indices: readonly number[], entities: readonly NormalizedEntity[]): boolean {
  const providers = new Set(indices.map((index) => entities[index].providerKey));
  return providers.size !== indices.length;
}

function makeCanonicalId(group: EntityGroup, entities: readonly NormalizedEntity[]): string {
  const repository = entities[group.indices[0]].repositoryKey;
  const members = group.indices.map((index) => entities[index].key).sort();
  const digest = createHash("sha256").update(stableSerialize({ repository, members })).digest("hex");
  return `ce_${digest}`;
}

function toCanonicalEntity(
  group: EntityGroup,
  canonicalId: string,
  entities: readonly NormalizedEntity[],
  edges: readonly CandidateEdge[],
  entityGroup: ReadonlyMap<number, EntityGroup>,
  canonicalIds: ReadonlyMap<EntityGroup, string>,
): CanonicalEntity {
  const members = group.indices.map((index) => toCanonicalMember(entities[index])).sort(compareMembers);
  const incidentEdges = edges.filter((edge) => group.indices.includes(edge.left) || group.indices.includes(edge.right));
  const internalEdges = incidentEdges.filter(
    (edge) => group.indices.includes(edge.left) && group.indices.includes(edge.right),
  );
  const candidateCanonicalIds = uniqueSorted(
    incidentEdges
      .flatMap((edge) => {
        const other = group.indices.includes(edge.left) ? edge.right : edge.left;
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
  const cardinality = groupCardinality(group, edges, entities);
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
  allEdges: readonly CandidateEdge[],
): CorrelationLink {
  return {
    left: toReference(entities[edge.left]),
    right: toReference(entities[edge.right]),
    score: edge.score,
    strength: edge.strength,
    cardinality: edgeCardinality(edge, allEdges, entities),
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
  allEdges: readonly CandidateEdge[],
  entities: readonly NormalizedEntity[],
): CorrelationCardinality {
  const leftTargets = new Set(
    allEdges
      .filter(
        (candidate) =>
          candidate.left === edge.left && entities[candidate.right].providerKey === entities[edge.right].providerKey,
      )
      .map((candidate) => candidate.right),
  );
  const rightTargets = new Set(
    allEdges
      .filter(
        (candidate) =>
          candidate.right === edge.right && entities[candidate.left].providerKey === entities[edge.left].providerKey,
      )
      .map((candidate) => candidate.left),
  );
  if (leftTargets.size > 1 && rightTargets.size > 1) return "many-to-many";
  if (leftTargets.size > 1) return "one-to-many";
  if (rightTargets.size > 1) return "many-to-one";
  return "one-to-one";
}

function groupCardinality(
  group: EntityGroup,
  incidentEdges: readonly CandidateEdge[],
  entities: readonly NormalizedEntity[],
): CorrelationCardinality {
  if (incidentEdges.length === 0) return "unmatched";
  let oneToMany = false;
  let manyToOne = false;
  let manyToMany = false;
  for (const edge of incidentEdges) {
    const cardinality = edgeCardinality(edge, incidentEdges, entities);
    if (cardinality === "many-to-many") manyToMany = true;
    if (cardinality === "one-to-many") {
      if (group.indices.includes(edge.left)) oneToMany = true;
      if (group.indices.includes(edge.right)) manyToOne = true;
    }
    if (cardinality === "many-to-one") {
      if (group.indices.includes(edge.left)) oneToMany = true;
      if (group.indices.includes(edge.right)) manyToOne = true;
    }
  }
  if (manyToMany || (oneToMany && manyToOne)) return "many-to-many";
  if (oneToMany) return "one-to-many";
  if (manyToOne) return "many-to-one";
  return "one-to-one";
}

function buildMetrics(
  entities: readonly NormalizedEntity[],
  edges: readonly CandidateEdge[],
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
  for (const key of [...providerEntries.keys()].sort()) {
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
      const incident = edges.filter((edge) => edge.left === index || edge.right === index);
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
  const providerCompare = providerReferenceKey(left.left).localeCompare(providerReferenceKey(right.left));
  if (providerCompare !== 0) return providerCompare;
  return providerReferenceKey(left.right).localeCompare(providerReferenceKey(right.right));
}

function compareEdges(left: CandidateEdge, right: CandidateEdge): number {
  if (left.left !== right.left) return left.left - right.left;
  if (left.right !== right.right) return left.right - right.right;
  return right.score - left.score;
}

function compareEvidence(left: CorrelationEvidence, right: CorrelationEvidence): number {
  const leftCompare = providerReferenceKey(left.left).localeCompare(providerReferenceKey(right.left));
  if (leftCompare !== 0) return leftCompare;
  return providerReferenceKey(left.right).localeCompare(providerReferenceKey(right.right));
}

function compareMembers(left: CanonicalEntityMember, right: CanonicalEntityMember): number {
  return providerReferenceKey(left).localeCompare(providerReferenceKey(right));
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
  return `${provider.id}\u0000${provider.version}\u0000${provider.determinism}`;
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
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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
