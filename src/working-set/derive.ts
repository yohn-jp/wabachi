import {
  compareFactSets,
  type FactComparison,
  type FactEntityReference,
  type FactEnvelope,
  type FactNormalizationResult,
  type FactObject,
} from "../runtime/facts.js";
import type { CanonicalEntity, CanonicalEntityMember } from "../runtime/correlation.js";
import type { ArchitectureDocumentV1 } from "../architecture/canon/document.js";
import type { RepositoryMapping, RepositoryPathMapping } from "../architecture/canon/repository-mappings.js";
import {
  CANDIDATE_WORKING_SET_LIMITS,
  createCandidateWorkingSet,
  type CandidateWorkingSet,
  type CandidateWorkingSetState,
  type RepositoryIdentity,
  type WorkingSetEvidenceReference,
  type WorkingSetTarget,
} from "./model.js";
import {
  authorizationEntries,
  conflictToWorkingSetEntry,
  createWorkingSetConflict,
  type WorkingSetAuthorizationInput,
  type WorkingSetConflictKind,
  workingSetTargetKey,
} from "./conflicts.js";
import type {
  ResolvedWorkingSetSeed,
  WorkingSetSeed,
  WorkingSetSeedResolution,
  WorkingSetSeedResolutionResult,
} from "./seeds.js";

/** Canon relationship classes admitted by the V1 derivation boundary. */
export const CANON_V1_RELATIONSHIP_CLASSES = ["depends-on", "calls", "uses", "data", "control"] as const;
export type CanonV1RelationshipClass = (typeof CANON_V1_RELATIONSHIP_CLASSES)[number];

/** Provider predicates admitted by the V1 derivation boundary. */
export const PROVIDER_V1_RELATIONSHIP_CLASSES = ["depends-on", "imports", "calls", "references"] as const;
export type ProviderV1RelationshipClass = (typeof PROVIDER_V1_RELATIONSHIP_CLASSES)[number];

export interface CandidateWorkingSetDerivationInput {
  /** Seed resolutions are already bound to the task repository and revision. */
  readonly seeds: WorkingSetSeedResolutionResult;
  /** Existing normalized provider evidence and its correlation projection. */
  readonly providerEvidence: FactNormalizationResult;
  /** Existing read-only Architecture Canon. */
  readonly canon: ArchitectureDocumentV1;
  /** Optional artifact identity; the task identity is used when omitted. */
  readonly workingSetId?: string;
  /** Optional external authorization boundary used only as comparison evidence. */
  readonly authorization?: WorkingSetAuthorizationInput;
}

interface PendingEntry {
  state: CandidateWorkingSetState;
  target: WorkingSetTarget;
  reason: { id: string; summary: string };
  evidence: WorkingSetEvidenceReference[];
}

interface MappingIndex {
  readonly byId: ReadonlyMap<string, readonly RepositoryMapping[]>;
  readonly mappings: readonly RepositoryMapping[];
}

interface EntityIndex {
  readonly byId: ReadonlyMap<string, CanonicalEntity>;
  readonly entities: readonly CanonicalEntity[];
}

interface SymbolLocator {
  readonly path: string;
  readonly symbol: string;
  readonly exportName?: string;
}

const CANON_STATE: Readonly<Record<CanonV1RelationshipClass, CandidateWorkingSetState>> = Object.freeze({
  "depends-on": "required",
  calls: "supporting",
  uses: "supporting",
  data: "supporting",
  control: "supporting",
});

const PROVIDER_STATE: Readonly<Record<ProviderV1RelationshipClass, CandidateWorkingSetState>> = Object.freeze({
  "depends-on": "supporting",
  imports: "supporting",
  calls: "supporting",
  references: "supporting",
});

const STATE_PRIORITY: Readonly<Record<CandidateWorkingSetState, number>> = Object.freeze({
  unresolved: 0,
  verification: 1,
  supporting: 2,
  required: 3,
});

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableId(...parts: readonly string[]): string {
  return parts.join(":").slice(0, 240);
}

function stableLocator(...parts: readonly string[]): string {
  return parts.join(":").slice(0, 1024);
}

function evidenceKey(reference: WorkingSetEvidenceReference): string {
  return `${reference.artifact}\u0000${reference.reference}`;
}

function targetKey(target: WorkingSetTarget): string {
  return `${target.kind}\u0000${target.locator}`;
}

function seedKey(seed: WorkingSetSeed): string {
  if (seed.kind === "path") return `path:${seed.path}`;
  if (seed.kind === "symbol-export") {
    return `symbol-export:${seed.path}#${seed.symbol}${seed.exportName === undefined ? "" : `@${seed.exportName}`}`;
  }
  return `architecture-component:${seed.componentId}`;
}

function symbolLocator(target: WorkingSetTarget): SymbolLocator | undefined {
  if (target.kind !== "symbol") return undefined;
  const hash = target.locator.indexOf("#");
  if (hash < 1 || hash === target.locator.length - 1) return undefined;
  const path = target.locator.slice(0, hash);
  const symbolPart = target.locator.slice(hash + 1);
  const at = symbolPart.indexOf("@");
  return at < 1
    ? { path, symbol: symbolPart }
    : { path, symbol: symbolPart.slice(0, at), exportName: symbolPart.slice(at + 1) };
}

function symbolTarget(path: string, symbol: string): WorkingSetTarget {
  return { kind: "symbol", locator: `${path}#${symbol}` };
}

function testTarget(path: string, selector: string): WorkingSetTarget {
  return { kind: "test", locator: `${path}#${selector}` };
}

function mappingTestTarget(path: string, selector: string): WorkingSetTarget {
  return testTarget(path, selector);
}

function mappingEvidence(mapping: RepositoryMapping, kind: string, locator: string): WorkingSetEvidenceReference {
  return { artifact: "canon", reference: `${mapping.canonId}:${kind}:${locator}` };
}

function relationshipEvidence(
  source: string,
  kind: CanonV1RelationshipClass,
  target: string,
  interfaceId?: string,
): WorkingSetEvidenceReference {
  return {
    artifact: "canon",
    reference: `${source}->${target}:${kind}${interfaceId === undefined ? "" : `:${interfaceId}`}`,
  };
}

function providerFactEvidence(fact: FactEnvelope): WorkingSetEvidenceReference {
  return { artifact: "provider-fact", reference: fact.factId };
}

function canonicalEntityEvidence(entity: CanonicalEntity): WorkingSetEvidenceReference {
  return { artifact: "provider-correlation", reference: entity.canonicalId };
}

function isProviderRelationship(value: string): value is ProviderV1RelationshipClass {
  return (PROVIDER_V1_RELATIONSHIP_CLASSES as readonly string[]).includes(value);
}

function isCanonRelationship(value: string): value is CanonV1RelationshipClass {
  return (CANON_V1_RELATIONSHIP_CLASSES as readonly string[]).includes(value);
}

function createMappingIndex(mappings: readonly RepositoryMapping[]): MappingIndex {
  const grouped = new Map<string, RepositoryMapping[]>();
  for (const mapping of mappings) {
    const values = grouped.get(mapping.canonId) ?? [];
    values.push(mapping);
    grouped.set(mapping.canonId, values);
  }
  for (const values of grouped.values())
    values.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  return { byId: grouped, mappings };
}

function createEntityIndex(entities: readonly CanonicalEntity[], revision?: string): EntityIndex {
  const currentEntities =
    revision === undefined
      ? entities
      : entities.filter((entity) => entity.repository.commitSha.toLowerCase() === revision.toLowerCase());
  const byId = new Map<string, CanonicalEntity>();
  for (const entity of currentEntities) byId.set(entity.canonicalId, entity);
  return { byId, entities: currentEntities };
}

function pathMatches(path: RepositoryPathMapping, candidate: string): boolean {
  return path.scope === "file"
    ? path.path === candidate
    : candidate === path.path || candidate.startsWith(`${path.path}/`);
}

function componentIdsForTarget(index: MappingIndex, target: WorkingSetTarget): readonly string[] {
  const components = new Set<string>();
  const symbol = symbolLocator(target);
  for (const mapping of index.mappings) {
    if (target.kind === "file" && mapping.paths.some((path) => pathMatches(path, target.locator))) {
      components.add(mapping.canonId);
    }
    if (target.kind === "test") {
      if (mapping.tests.some((test) => mappingTestTarget(test.path, test.selector).locator === target.locator)) {
        components.add(mapping.canonId);
      }
    }
    if (symbol !== undefined) {
      if (
        mapping.symbols.some(
          (candidate) =>
            candidate.path === symbol.path &&
            candidate.symbol === symbol.symbol &&
            (candidate.exportName ?? "") === (symbol.exportName ?? ""),
        ) ||
        mapping.paths.some((path) => pathMatches(path, symbol.path))
      ) {
        components.add(mapping.canonId);
      }
    }
  }
  return [...components].sort(compareText);
}

function memberMatchesSymbol(member: CanonicalEntityMember, symbol: SymbolLocator): boolean {
  const values = [member.nativeId, member.name, member.qualifiedName, ...member.aliases].filter(
    (value): value is string => value !== undefined,
  );
  return member.path === symbol.path && values.includes(symbol.symbol);
}

function entityMatchesTarget(entity: CanonicalEntity, target: WorkingSetTarget): boolean {
  const symbol = symbolLocator(target);
  return entity.members.some((member) => {
    if (target.kind === "file") return member.path === target.locator;
    if (symbol !== undefined) return memberMatchesSymbol(member, symbol);
    return false;
  });
}

function entityTargetMembers(entity: CanonicalEntity): readonly WorkingSetTarget[] {
  const targets = entity.members
    .filter((member) => member.path !== undefined)
    .map((member) => symbolTarget(member.path as string, member.nativeId));
  const unique = new Map<string, WorkingSetTarget>();
  for (const target of targets) unique.set(targetKey(target), target);
  return [...unique.values()].sort((left, right) => compareText(targetKey(left), targetKey(right)));
}

function boundaryMembership(canon: ArchitectureDocumentV1): ReadonlyMap<string, readonly string[]> {
  const memberships = new Map<string, string[]>();
  for (const boundary of canon.boundaries) {
    for (const memberId of boundary.memberIds) {
      const values = memberships.get(memberId) ?? [];
      values.push(boundary.id);
      memberships.set(memberId, values);
    }
  }
  for (const values of memberships.values()) values.sort(compareText);
  return memberships;
}

function sameDeclaredBoundary(
  memberships: ReadonlyMap<string, readonly string[]>,
  source: string,
  target: string,
): boolean {
  const sourceBoundaries = memberships.get(source) ?? [];
  const targetBoundaries = memberships.get(target) ?? [];
  if (sourceBoundaries.length === 0 || sourceBoundaries.length !== targetBoundaries.length) return false;
  return sourceBoundaries.every((boundaryId, index) => boundaryId === targetBoundaries[index]);
}

function addEvidence(target: PendingEntry, references: readonly WorkingSetEvidenceReference[]): void {
  const values = new Map<string, WorkingSetEvidenceReference>();
  for (const reference of [...target.evidence, ...references]) values.set(evidenceKey(reference), reference);
  target.evidence = [...values.values()]
    .sort((left, right) => compareText(left.artifact, right.artifact) || compareText(left.reference, right.reference))
    .slice(0, CANDIDATE_WORKING_SET_LIMITS.maxEvidenceReferencesPerEntry);
}

function addEntry(
  entries: Map<string, PendingEntry>,
  state: CandidateWorkingSetState,
  target: WorkingSetTarget,
  reason: { id: string; summary: string },
  evidence: readonly WorkingSetEvidenceReference[],
): void {
  const key = targetKey(target);
  const existing = entries.get(key);
  if (existing === undefined) {
    entries.set(key, { state, target, reason, evidence: [...evidence] });
    return;
  }

  if (
    STATE_PRIORITY[state] > STATE_PRIORITY[existing.state] ||
    (STATE_PRIORITY[state] === STATE_PRIORITY[existing.state] &&
      (compareText(reason.id, existing.reason.id) < 0 ||
        (reason.id === existing.reason.id && compareText(reason.summary, existing.reason.summary) < 0)))
  ) {
    existing.state = state;
    existing.reason = reason;
  }
  addEvidence(existing, evidence);
}

function addConflict(
  entries: Map<string, PendingEntry>,
  kind: WorkingSetConflictKind,
  locator: string,
  evidence: readonly WorkingSetEvidenceReference[],
): void {
  const conflict = createWorkingSetConflict({ kind, locator, evidence });
  const entry = conflictToWorkingSetEntry(conflict);
  addEntry(entries, entry.state, entry.target, entry.reason, entry.evidence);
}

function unresolvedProviderTarget(subject: string, predicate: string): WorkingSetTarget {
  return { kind: "unresolved", locator: stableLocator("provider", predicate, subject) };
}

function seedEvidence(resolution: ResolvedWorkingSetSeed): readonly WorkingSetEvidenceReference[] {
  return resolution.evidence;
}

function seedReason(seed: WorkingSetSeed): { id: string; summary: string } {
  return { id: stableId("seed", seed.kind), summary: "validated working-set seed" };
}

function canonReason(kind: CanonV1RelationshipClass, source: string, target: string): { id: string; summary: string } {
  return {
    id: stableId("canon", kind, source, target),
    summary: `Architecture Canon ${kind} relationship`,
  };
}

function providerReason(predicate: ProviderV1RelationshipClass, fact: FactEnvelope): { id: string; summary: string } {
  return { id: stableId("provider", predicate, fact.factId), summary: "admitted provider relationship evidence" };
}

function isFactEntity(value: FactObject): value is FactEntityReference {
  return "nativeId" in value && "provider" in value;
}

function isPinnedRevision(fact: FactEnvelope, revision: string): boolean {
  return fact.repository.commitSha.toLowerCase() === revision;
}

function factSubjectKey(fact: FactEnvelope): string | undefined {
  return fact.subject.canonicalId;
}

function comparisonIndex(
  providerEvidence: FactNormalizationResult,
  revision: string,
): {
  readonly facts: readonly FactEnvelope[];
  readonly byFactId: ReadonlyMap<string, FactComparison>;
  readonly comparisons: readonly FactComparison[];
} {
  const facts = providerEvidence.facts.filter((fact) => isPinnedRevision(fact, revision));
  const unsupported = providerEvidence.unsupported.filter(
    (evidence) => evidence.repository.commitSha.toLowerCase() === revision.toLowerCase(),
  );
  const comparisons = compareFactSets(facts, { unsupported });
  const byFactId = new Map<string, FactComparison>();
  for (const comparison of comparisons) {
    for (const fact of comparison.facts) byFactId.set(fact.factId, comparison);
  }
  return { facts, byFactId, comparisons };
}

function activeEntitiesForSeeds(
  resolutions: readonly WorkingSetSeedResolution[],
  entityIndex: EntityIndex,
): Set<string> {
  const active = new Set<string>();
  for (const resolution of resolutions) {
    if (resolution.status !== "resolved") continue;
    for (const evidence of resolution.evidence) {
      if (evidence.artifact !== "provider-correlation") continue;
      const entity = entityIndex.byId.get(evidence.reference);
      if (entity !== undefined && (entity.status === "ambiguous" || entity.candidateCanonicalIds.length > 0)) continue;
      active.add(evidence.reference);
    }
    for (const target of resolution.targets) {
      for (const entity of entityIndex.entities) {
        if (
          entityMatchesTarget(entity, target) &&
          entity.status !== "ambiguous" &&
          entity.candidateCanonicalIds.length === 0
        ) {
          active.add(entity.canonicalId);
        }
      }
    }
  }
  return active;
}

function addUnresolvedSeed(
  entries: Map<string, PendingEntry>,
  resolution: Exclude<WorkingSetSeedResolution, ResolvedWorkingSetSeed>,
): void {
  const evidence = [
    ...resolution.evidence,
    { artifact: "working-set-seeds", reference: seedKey(resolution.seed) },
    { artifact: "working-set-seeds", reference: `reason:${resolution.reason}` },
    ...resolution.candidates.map((candidate) => ({ artifact: "working-set-seed-candidate", reference: candidate })),
  ];
  const kind: WorkingSetConflictKind =
    resolution.reason === "ambiguous"
      ? "ambiguity"
      : resolution.reason === "repository-mismatch"
        ? "stale-evidence"
        : "mapping-gap";
  addConflict(entries, kind, stableLocator("seed", seedKey(resolution.seed)), evidence);
}

function addMappingTargets(
  entries: Map<string, PendingEntry>,
  mapping: RepositoryMapping,
  state: CandidateWorkingSetState,
  reason: { id: string; summary: string },
  evidence: readonly WorkingSetEvidenceReference[],
): void {
  for (const path of mapping.paths) {
    addEntry(entries, state, { kind: "file", locator: path.path }, reason, [
      ...evidence,
      mappingEvidence(mapping, "path", path.path),
    ]);
  }
  for (const symbol of mapping.symbols) {
    const locator = `${symbol.path}#${symbol.symbol}${symbol.exportName === undefined ? "" : `@${symbol.exportName}`}`;
    addEntry(entries, state, { kind: "symbol", locator }, reason, [
      ...evidence,
      mappingEvidence(mapping, "symbol", locator),
    ]);
  }
  for (const test of mapping.tests) {
    const target = mappingTestTarget(test.path, test.selector);
    addEntry(
      entries,
      "verification",
      target,
      {
        id: stableId("verification", mapping.canonId, target.locator),
        summary: "Canon-mapped verification context",
      },
      [...evidence, mappingEvidence(mapping, "test", target.locator)],
    );
  }
}

function addComponentMapping(
  entries: Map<string, PendingEntry>,
  mappingIndex: MappingIndex,
  componentId: string,
  state: CandidateWorkingSetState,
  reason: { id: string; summary: string },
  evidence: readonly WorkingSetEvidenceReference[],
): boolean {
  const mappings = mappingIndex.byId.get(componentId) ?? [];
  if (mappings.length !== 1) return false;
  addMappingTargets(entries, mappings[0], state, reason, evidence);
  return mappings[0].paths.length > 0 || mappings[0].symbols.length > 0 || mappings[0].tests.length > 0;
}

function componentIdsForEntity(index: MappingIndex, entity: CanonicalEntity): readonly string[] {
  const components = new Set<string>();
  for (const member of entity.members) {
    if (member.path === undefined) continue;
    for (const componentId of componentIdsForTarget(index, { kind: "file", locator: member.path })) {
      components.add(componentId);
    }
    for (const componentId of componentIdsForTarget(index, symbolTarget(member.path, member.nativeId))) {
      components.add(componentId);
    }
  }
  return [...components].sort(compareText);
}

function providerEntityIsUnresolved(entity: CanonicalEntity, reference: FactEntityReference): boolean {
  return (
    reference.correlationStatus === "ambiguous" ||
    reference.candidateCanonicalIds.length > 0 ||
    entity.status === "ambiguous" ||
    entity.candidateCanonicalIds.length > 0
  );
}

function providerSourceIsActive(reference: FactEntityReference, activeEntities: ReadonlySet<string>): boolean {
  if (reference.canonicalId !== undefined && activeEntities.has(reference.canonicalId)) return true;
  return reference.candidateCanonicalIds.some((candidate) => activeEntities.has(candidate));
}

function addProviderUnresolved(
  entries: Map<string, PendingEntry>,
  fact: FactEnvelope,
  kind: Extract<WorkingSetConflictKind, "ambiguity" | "disagreement" | "insufficient-evidence">,
  evidence: readonly WorkingSetEvidenceReference[],
): void {
  const subject = fact.subject.canonicalId ?? fact.subject.nativeId;
  addConflict(entries, kind, unresolvedProviderTarget(subject, fact.predicate).locator, evidence);
}

function expandCanon(
  entries: Map<string, PendingEntry>,
  canon: ArchitectureDocumentV1,
  mappingIndex: MappingIndex,
  resolutions: readonly WorkingSetSeedResolution[],
): Set<string> {
  const activeComponents = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  const memberships = boundaryMembership(canon);

  for (const resolution of resolutions) {
    if (resolution.status !== "resolved") continue;
    for (const target of resolution.targets) {
      const componentIds = componentIdsForTarget(mappingIndex, target);
      if (componentIds.length > 1) {
        addConflict(entries, "ambiguity", stableLocator("canon-mapping", target.locator), resolution.evidence);
        continue;
      }
      for (const componentId of componentIds) {
        if (!activeComponents.has(componentId)) activeComponents.add(componentId);
        if (!queued.has(componentId)) {
          queued.add(componentId);
          queue.push(componentId);
        }
      }
    }
    if (resolution.seed.kind === "architecture-component") {
      const componentId = resolution.seed.componentId;
      const mappings = mappingIndex.byId.get(componentId) ?? [];
      if (mappings.length === 1) {
        if (mappings[0].paths.length === 0 && mappings[0].symbols.length === 0 && mappings[0].tests.length === 0) {
          addConflict(entries, "mapping-gap", stableLocator("canon-component", componentId), resolution.evidence);
          continue;
        }
        activeComponents.add(componentId);
        if (!queued.has(componentId)) {
          queued.add(componentId);
          queue.push(componentId);
        }
      }
    }
  }

  while (queue.length > 0) {
    const source = queue.shift() as string;
    const relationships = canon.relationships
      .filter((relationship) => relationship.source === source && isCanonRelationship(relationship.kind))
      .sort(
        (left, right) =>
          compareText(left.target, right.target) ||
          compareText(left.kind, right.kind) ||
          compareText(left.interfaceId ?? "", right.interfaceId ?? ""),
      );

    for (const relationship of relationships) {
      const kind = relationship.kind as CanonV1RelationshipClass;
      const relationEvidence = relationshipEvidence(source, kind, relationship.target, relationship.interfaceId);
      const reason = canonReason(kind, source, relationship.target);
      const mappings = mappingIndex.byId.get(relationship.target) ?? [];
      if (mappings.length === 0) {
        addConflict(entries, "mapping-gap", stableLocator("canon-component", relationship.target), [relationEvidence]);
        continue;
      }
      if (mappings.length > 1) {
        addConflict(entries, "ambiguity", stableLocator("canon-component", relationship.target), [relationEvidence]);
        continue;
      }
      const mapped = addComponentMapping(entries, mappingIndex, relationship.target, CANON_STATE[kind], reason, [
        relationEvidence,
      ]);
      if (!mapped) {
        addConflict(entries, "mapping-gap", stableLocator("canon-component", relationship.target), [relationEvidence]);
        continue;
      }

      // Only Canon depends-on is a recursive V1 traversal class. The other
      // classes provide bounded context but never become a graph walk.
      if (
        kind === "depends-on" &&
        sameDeclaredBoundary(memberships, source, relationship.target) &&
        !queued.has(relationship.target)
      ) {
        queued.add(relationship.target);
        activeComponents.add(relationship.target);
        queue.push(relationship.target);
      }
    }
  }

  return activeComponents;
}

function deriveProviderEvidence(
  entries: Map<string, PendingEntry>,
  providerEvidence: FactNormalizationResult,
  entityIndex: EntityIndex,
  staleEntityIds: ReadonlySet<string>,
  mappingIndex: MappingIndex,
  activeEntities: Set<string>,
  activeComponents: ReadonlySet<string>,
  revision: string,
): void {
  const { facts, byFactId } = comparisonIndex(providerEvidence, revision);
  for (const entity of entityIndex.entities) {
    if (componentIdsForEntity(mappingIndex, entity).some((componentId) => activeComponents.has(componentId))) {
      activeEntities.add(entity.canonicalId);
    }
  }
  const processedDisagreements = new Set<string>();

  for (const fact of facts) {
    if (!isProviderRelationship(fact.predicate)) continue;
    const staleObject =
      isFactEntity(fact.object) && fact.object.canonicalId !== undefined
        ? staleEntityIds.has(fact.object.canonicalId)
        : false;
    if ((fact.subject.canonicalId !== undefined && staleEntityIds.has(fact.subject.canonicalId)) || staleObject) {
      addConflict(entries, "stale-evidence", stableLocator("provider-fact", fact.factId), [providerFactEvidence(fact)]);
      continue;
    }
    const subjectKey = factSubjectKey(fact);
    if (!providerSourceIsActive(fact.subject, activeEntities)) continue;

    const comparison = byFactId.get(fact.factId);
    if (comparison?.state === "conflict") {
      if (!processedDisagreements.has(comparison.key)) {
        processedDisagreements.add(comparison.key);
        addProviderUnresolved(
          entries,
          fact,
          "disagreement",
          comparison.facts.flatMap((candidate) => [
            providerFactEvidence(candidate),
            ...(isFactEntity(candidate.object) && candidate.object.canonicalId !== undefined
              ? [{ artifact: "provider-correlation", reference: candidate.object.canonicalId }]
              : []),
            ...candidate.subject.candidateCanonicalIds.map((id) => ({
              artifact: "provider-correlation",
              reference: id,
            })),
          ]),
        );
      }
      continue;
    }

    const subjectEntity = subjectKey === undefined ? undefined : entityIndex.byId.get(subjectKey);
    if (!isFactEntity(fact.object)) {
      addProviderUnresolved(entries, fact, "ambiguity", [providerFactEvidence(fact)]);
      continue;
    }

    const targetEntity =
      fact.object.canonicalId === undefined ? undefined : entityIndex.byId.get(fact.object.canonicalId);
    if (
      subjectEntity === undefined ||
      providerEntityIsUnresolved(subjectEntity, fact.subject) ||
      targetEntity === undefined ||
      providerEntityIsUnresolved(targetEntity, fact.object) ||
      fact.subject.correlationStatus === "ambiguous" ||
      fact.subject.candidateCanonicalIds.length > 0
    ) {
      addProviderUnresolved(entries, fact, "ambiguity", [
        providerFactEvidence(fact),
        ...fact.object.candidateCanonicalIds.map((id) => ({ artifact: "provider-correlation", reference: id })),
      ]);
      continue;
    }

    const predicate = fact.predicate as ProviderV1RelationshipClass;
    const reason = providerReason(predicate, fact);
    const evidence = [providerFactEvidence(fact), canonicalEntityEvidence(targetEntity)];
    const targets = entityTargetMembers(targetEntity);
    if (targets.length === 0) {
      addProviderUnresolved(entries, fact, "insufficient-evidence", evidence);
      continue;
    }
    for (const target of targets) addEntry(entries, PROVIDER_STATE[predicate], target, reason, evidence);

    // Repository tests are verification context, never required execution
    // targets, even when their component is reached through provider evidence.
    const componentIds = componentIdsForEntity(mappingIndex, targetEntity);
    if (componentIds.length === 0) {
      addConflict(entries, "mapping-gap", stableLocator("provider-entity", targetEntity.canonicalId), evidence);
    }
    if (componentIds.length > 1) {
      addConflict(entries, "ambiguity", stableLocator("provider-entity", targetEntity.canonicalId), evidence);
    }
    if (componentIds.length !== 1) continue;
    for (const componentId of componentIds) {
      const mapping = mappingIndex.byId.get(componentId)?.[0];
      if (mapping === undefined) continue;
      for (const test of mapping.tests) {
        const target = mappingTestTarget(test.path, test.selector);
        addEntry(
          entries,
          "verification",
          target,
          { id: stableId("verification", componentId, target.locator), summary: "Canon-mapped verification context" },
          [...evidence, mappingEvidence(mapping, "test", target.locator)],
        );
      }
    }
  }
}

function addStaleEvidenceConflicts(
  entries: Map<string, PendingEntry>,
  providerEvidence: FactNormalizationResult,
  revision: string,
): Set<string> {
  const staleEntityIds = new Set<string>();
  for (const entity of providerEvidence.correlation.canonicalEntities) {
    if (entity.repository.commitSha.toLowerCase() !== revision.toLowerCase()) {
      staleEntityIds.add(entity.canonicalId);
      addConflict(entries, "stale-evidence", stableLocator("provider-correlation", entity.canonicalId), [
        canonicalEntityEvidence(entity),
      ]);
    }
  }
  for (const fact of providerEvidence.facts) {
    if (!isPinnedRevision(fact, revision)) {
      addConflict(entries, "stale-evidence", stableLocator("provider-fact", fact.factId), [providerFactEvidence(fact)]);
    }
  }
  for (const evidence of providerEvidence.unsupported) {
    if (evidence.repository.commitSha.toLowerCase() !== revision.toLowerCase()) {
      addConflict(entries, "stale-evidence", stableLocator("provider-evidence", evidence.nativeEvidence.id), [
        { artifact: "provider-evidence", reference: evidence.nativeEvidence.id },
      ]);
    }
  }
  return staleEntityIds;
}

function sameRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return (
    left.repositoryHost === right.repositoryHost &&
    left.repositoryId === right.repositoryId &&
    left.repository === right.repository
  );
}

function targetReference(target: WorkingSetTarget): string {
  return `${target.kind}:${target.locator}`;
}

function addAuthorizationConflicts(
  entries: Map<string, PendingEntry>,
  authorization: WorkingSetAuthorizationInput | undefined,
  repository: RepositoryIdentity,
  revision: string,
): void {
  if (authorization === undefined) return;

  const comparisonEvidence = [
    {
      artifact: "authorization-comparison",
      reference: `revision:${authorization.revision ?? revision}`,
    },
  ];
  if (authorization.revision !== undefined && authorization.revision.toLowerCase() !== revision.toLowerCase()) {
    addConflict(entries, "stale-evidence", "authorization-revision", comparisonEvidence);
    return;
  }
  if (authorization.repository !== undefined && !sameRepository(authorization.repository, repository)) {
    addConflict(entries, "stale-evidence", "authorization-repository", comparisonEvidence);
    return;
  }

  const hasBoundary =
    authorization.targets !== undefined ||
    authorization.entries !== undefined ||
    authorization.authorizedTargets !== undefined;
  if (!hasBoundary) {
    addConflict(entries, "insufficient-evidence", "authorization-boundary", comparisonEvidence);
    return;
  }

  const authorized = new Set(authorizationEntries(authorization).map(({ target }) => workingSetTargetKey(target)));
  const requiredEntries = [...entries.values()]
    .filter((entry) => entry.state === "required" && entry.target.kind !== "unresolved")
    .sort((left, right) => workingSetTargetKey(left.target).localeCompare(workingSetTargetKey(right.target)));
  for (const entry of requiredEntries) {
    if (authorized.has(workingSetTargetKey(entry.target))) continue;
    addConflict(entries, "required-but-unauthorized", entry.target.locator, [
      ...entry.evidence,
      ...comparisonEvidence,
      { artifact: "authorization-comparison", reference: `not-listed:${targetReference(entry.target)}` },
    ]);
  }
}

/**
 * Derives one authorization-neutral Candidate Working Set from bounded seed
 * resolutions, normalized provider evidence, and the read-only Canon.
 *
 * The algorithm has two deliberate traversal boundaries: Canon `depends-on`
 * may recurse only while the source and target retain the same non-empty
 * boundary membership, and provider relationships are consumed only as a
 * single evidence hop. Other admitted relationship classes add context but
 * never create a transitive provider/repository graph.
 */
export function deriveCandidateWorkingSet(input: CandidateWorkingSetDerivationInput): CandidateWorkingSet {
  const mappingIndex = createMappingIndex(input.canon.repositoryMappings);
  const entityIndex = createEntityIndex(input.providerEvidence.correlation.canonicalEntities, input.seeds.revision);
  const entries = new Map<string, PendingEntry>();
  const staleEntityIds = addStaleEvidenceConflicts(entries, input.providerEvidence, input.seeds.revision);

  for (const resolution of input.seeds.resolutions) {
    if (resolution.status === "unresolved") {
      addUnresolvedSeed(entries, resolution);
      continue;
    }
    for (const target of resolution.targets) {
      const state: CandidateWorkingSetState = target.kind === "test" ? "verification" : "required";
      addEntry(entries, state, target, seedReason(resolution.seed), seedEvidence(resolution));
    }
  }

  if (input.seeds.binding !== "matched") {
    addAuthorizationConflicts(entries, input.authorization, input.seeds.repository, input.seeds.revision);
    return createCandidateWorkingSet({
      workingSetId: input.workingSetId ?? input.seeds.task.taskId,
      repository: input.seeds.repository,
      revision: input.seeds.revision,
      entries: [...entries.values()],
    });
  }

  const activeComponents = expandCanon(entries, input.canon, mappingIndex, input.seeds.resolutions);
  const activeEntities = activeEntitiesForSeeds(input.seeds.resolutions, entityIndex);
  deriveProviderEvidence(
    entries,
    input.providerEvidence,
    entityIndex,
    staleEntityIds,
    mappingIndex,
    activeEntities,
    activeComponents,
    input.seeds.revision,
  );
  addAuthorizationConflicts(entries, input.authorization, input.seeds.repository, input.seeds.revision);

  return createCandidateWorkingSet({
    workingSetId: input.workingSetId ?? input.seeds.task.taskId,
    repository: input.seeds.repository,
    revision: input.seeds.revision,
    entries: [...entries.values()],
  });
}
