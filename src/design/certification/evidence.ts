import { isFactEnvelope, type FactEnvelope, type FactEntityReference, type FactObject } from "../../runtime/facts.js";
import { normalizeRepositoryPath } from "../../architecture/canon/repository-mappings.js";
import type { ProviderIdentity, ResolvedRepository } from "../../runtime/provider.js";
import type { RepositoryRevisionReference } from "../contracts.js";

/** Evidence completeness is explicit because an omitted observation is not proof of absence. */
export type EvidenceCompleteness = "complete" | "partial";

export interface RepositoryTreeEvidence {
  readonly paths: readonly string[];
  readonly completeness?: EvidenceCompleteness;
  readonly complete?: boolean;
  readonly repository?: RepositoryRevisionReference | ResolvedRepository;
}

/**
 * Input accepted by {@link admitRepositoryEvidence}. The aliases are useful at
 * transport boundaries: providers commonly call the repository snapshot a
 * tree, while persisted artifacts use treePaths/factsCompleteness.
 */
export interface RepositoryEvidenceInput {
  readonly repository?: RepositoryRevisionReference | ResolvedRepository;
  readonly expectedRepository?: RepositoryRevisionReference | ResolvedRepository;
  readonly provider?: ProviderIdentity;
  readonly providers?: readonly ProviderIdentity[];
  readonly facts?: readonly unknown[];
  readonly tree?: RepositoryTreeEvidence | readonly string[];
  readonly treePaths?: readonly string[];
  readonly treeCompleteness?: EvidenceCompleteness;
  readonly treeComplete?: boolean;
  readonly factsCompleteness?: EvidenceCompleteness;
  readonly factsComplete?: boolean;
  readonly completeness?: EvidenceCompleteness;
  readonly complete?: boolean;
  readonly [key: string]: unknown;
}

export interface EvidenceRejection {
  readonly index: number;
  readonly reason:
    "invalid-fact" | "repository-mismatch" | "provider-mismatch" | "provenance-mismatch" | "mixed-repository";
  readonly detail: string;
}

export interface AdmittedRepositoryEvidence {
  readonly accepted: boolean;
  readonly repository?: RepositoryRevisionReference;
  readonly providers: readonly ProviderIdentity[];
  readonly facts: readonly FactEnvelope[];
  readonly rejectedFacts: readonly EvidenceRejection[];
  readonly treePaths: readonly string[];
  readonly treeCompleteness: EvidenceCompleteness;
  readonly factsCompleteness: EvidenceCompleteness;
  readonly reasons: readonly string[];
}

interface Revision {
  readonly repository: string;
  readonly revision: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toRevision(value: unknown): Revision | undefined {
  const record = asRecord(value);
  if (
    record !== undefined &&
    typeof record.repository === "string" &&
    record.repository.length > 0 &&
    typeof record.revision === "string" &&
    record.revision.length > 0
  ) {
    return { repository: record.repository, revision: record.revision };
  }
  if (
    record !== undefined &&
    typeof record.source === "string" &&
    record.source.length > 0 &&
    typeof record.commitSha === "string" &&
    record.commitSha.length > 0
  ) {
    return { repository: record.source, revision: record.commitSha };
  }
  return undefined;
}

function sameRevision(left: Revision, right: Revision): boolean {
  return left.repository === right.repository && left.revision === right.revision;
}

function sameProvider(left: ProviderIdentity, right: ProviderIdentity): boolean {
  return left.id === right.id && left.version === right.version && left.determinism === right.determinism;
}

function providerList(value: unknown): ProviderIdentity[] {
  const record = asRecord(value);
  const providers: ProviderIdentity[] = [];
  if (record !== undefined && record.provider !== undefined) {
    const provider = asProvider(record.provider);
    if (provider !== undefined) providers.push(provider);
  }
  if (record !== undefined && Array.isArray(record.providers)) {
    for (const candidate of record.providers) {
      const provider = asProvider(candidate);
      if (provider !== undefined) providers.push(provider);
    }
  }
  const unique = new Map<string, ProviderIdentity>();
  for (const provider of providers) unique.set(providerKey(provider), provider);
  return [...unique.values()].sort(compareProviders);
}

function asProvider(value: unknown): ProviderIdentity | undefined {
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    typeof record.version !== "string" ||
    record.version.length === 0 ||
    (record.determinism !== "deterministic" && record.determinism !== "non-deterministic")
  ) {
    return undefined;
  }
  return {
    id: record.id,
    version: record.version,
    determinism: record.determinism,
  };
}

function providerKey(provider: ProviderIdentity): string {
  return `${provider.id}\u0000${provider.version}\u0000${provider.determinism}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareProviders(left: ProviderIdentity, right: ProviderIdentity): number {
  return compareStrings(providerKey(left), providerKey(right));
}

function factRepository(fact: FactEnvelope): Revision {
  return { repository: fact.repository.source, revision: fact.repository.commitSha };
}

function entityProviderMatches(entity: FactEntityReference, provider: ProviderIdentity): boolean {
  return sameProvider(entity.provider, provider);
}

function objectProviderMatches(object: FactObject, provider: ProviderIdentity): boolean {
  return "provider" in object ? entityProviderMatches(object, provider) : true;
}

function validProvenance(fact: FactEnvelope): boolean {
  const native = fact.nativeEvidence;
  if (native === undefined || typeof native.id !== "string" || native.id.length === 0) return false;
  if (fact.repository.source.length === 0 || fact.repository.commitSha.length === 0) return false;
  if (fact.provider.id.length === 0 || fact.provider.version.length === 0) return false;
  if (!sameProvider(native.provider, fact.provider)) return false;
  if (native.source.path !== fact.source.path || native.source.span !== fact.source.span) return false;
  if (
    !sameRevision(factRepository(fact), {
      repository: native.observation.repository.source,
      revision: native.observation.repository.commitSha,
    })
  ) {
    return false;
  }
  if (native.observation.source.path !== fact.source.path || native.observation.source.span !== fact.source.span)
    return false;
  if (native.observation.predicate !== fact.predicate) return false;
  if (!sameProvider(native.observation.provider, fact.provider)) return false;
  if (!entityProviderMatches(fact.subject, fact.provider) || !objectProviderMatches(fact.object, fact.provider))
    return false;
  return (
    Object.prototype.hasOwnProperty.call(native, "providerNative") &&
    Object.prototype.hasOwnProperty.call(fact, "providerNative")
  );
}

function completeness(
  record: Record<string, unknown>,
  field: "tree" | "facts",
  fallback: EvidenceCompleteness,
): EvidenceCompleteness {
  const direct = record[`${field}Completeness`];
  if (direct === "complete" || direct === "partial") return direct;
  const complete = record[`${field}Complete`];
  if (typeof complete === "boolean") return complete ? "complete" : "partial";
  if (record.complete === true) return "complete";
  if (record.completeness === "complete" || record.completeness === "partial") return record.completeness;
  return fallback;
}

function treeInput(
  record: Record<string, unknown>,
): { paths: readonly unknown[]; completeness: EvidenceCompleteness; repository?: Revision } | undefined {
  const tree = record.tree;
  if (Array.isArray(tree)) {
    return {
      paths: tree,
      // A path list has no claim that the repository tree was exhaustively
      // enumerated. Absence is conclusive only with an explicit assertion.
      completeness: completeness(record, "tree", "partial"),
    };
  }
  const treeRecord = asRecord(tree);
  if (treeRecord !== undefined) {
    return {
      paths: Array.isArray(treeRecord.paths) ? treeRecord.paths : [],
      completeness:
        treeRecord.completeness === "complete" || treeRecord.completeness === "partial"
          ? treeRecord.completeness
          : typeof treeRecord.complete === "boolean"
            ? treeRecord.complete
              ? "complete"
              : "partial"
            : "partial",
      repository: toRevision(treeRecord.repository),
    };
  }
  if (Array.isArray(record.treePaths)) {
    return {
      paths: record.treePaths,
      // Bare treePaths are observations, not proof that no other path exists.
      completeness: completeness(record, "tree", "partial"),
    };
  }
  return undefined;
}

/**
 * Admit only normalized facts whose complete provenance still points at the
 * requested repository revision and provider. Invalid records are retained as
 * rejection metadata, never silently treated as an empty observation.
 */
export function admitRepositoryEvidence(input: RepositoryEvidenceInput | unknown): AdmittedRepositoryEvidence {
  const record = asRecord(input);
  const expected = toRevision(record?.expectedRepository) ?? toRevision(record?.repository);
  const expectedProviders = providerList(record);
  const rawFacts = Array.isArray(record?.facts) ? record.facts : [];
  const rejectedFacts: EvidenceRejection[] = [];
  const facts: FactEnvelope[] = [];
  let derivedRepository = expected;

  for (let index = 0; index < rawFacts.length; index += 1) {
    const candidate = rawFacts[index];
    if (!isFactEnvelope(candidate)) {
      rejectedFacts.push({ index, reason: "invalid-fact", detail: "fact is not a valid FactEnvelope" });
      continue;
    }
    const fact = candidate;
    const repository = factRepository(fact);
    if (derivedRepository === undefined) derivedRepository = repository;
    if (expected !== undefined && !sameRevision(repository, expected)) {
      rejectedFacts.push({
        index,
        reason: "repository-mismatch",
        detail: "fact repository revision differs from requested revision",
      });
      continue;
    }
    if (!sameRevision(repository, derivedRepository)) {
      rejectedFacts.push({
        index,
        reason: "mixed-repository",
        detail: "facts contain more than one repository revision",
      });
      continue;
    }
    if (expectedProviders.length > 0 && !expectedProviders.some((provider) => sameProvider(provider, fact.provider))) {
      rejectedFacts.push({
        index,
        reason: "provider-mismatch",
        detail: "fact provider differs from requested provider",
      });
      continue;
    }
    if (!validProvenance(fact)) {
      rejectedFacts.push({
        index,
        reason: "provenance-mismatch",
        detail: "fact native evidence does not preserve its provider provenance",
      });
      continue;
    }
    facts.push(fact);
  }

  const tree = record === undefined ? undefined : treeInput(record);
  const treePaths: string[] = [];
  const reasons: string[] = [];
  if (tree !== undefined) {
    const treeRepository = tree.repository;
    const requestedRepository = expected ?? derivedRepository;
    if (
      treeRepository !== undefined &&
      requestedRepository !== undefined &&
      !sameRevision(treeRepository, requestedRepository)
    ) {
      reasons.push("repository tree revision differs from requested revision");
    }
    if (derivedRepository === undefined && treeRepository !== undefined) derivedRepository = treeRepository;
    for (const value of tree.paths) {
      if (typeof value !== "string") {
        reasons.push("repository tree contains a non-string path");
        continue;
      }
      try {
        treePaths.push(normalizeRepositoryPath(value));
      } catch {
        reasons.push(`repository tree contains an invalid path: ${value}`);
      }
    }
  }
  const uniquePaths = [...new Set(treePaths)].sort(compareStrings);
  const factsCompleteness = record === undefined ? "partial" : completeness(record, "facts", "partial");
  const treeCompleteness =
    tree === undefined || reasons.some((reason) => reason.startsWith("repository tree"))
      ? "partial"
      : tree.completeness;
  if (record === undefined || derivedRepository === undefined) reasons.push("repository revision is required");
  if (rawFacts.length === 0 && tree === undefined) reasons.push("repository evidence is required");
  if (rejectedFacts.length > 0) reasons.push(`${rejectedFacts.length} fact record(s) were rejected`);
  const providers = [...new Map(facts.map((fact) => [providerKey(fact.provider), fact.provider])).values()].sort(
    compareProviders,
  );
  return Object.freeze({
    accepted: reasons.length === 0 && rejectedFacts.length === 0 && derivedRepository !== undefined,
    ...(derivedRepository === undefined ? {} : { repository: derivedRepository }),
    providers: Object.freeze(providers),
    facts: Object.freeze(facts),
    rejectedFacts: Object.freeze(rejectedFacts),
    treePaths: Object.freeze(uniquePaths),
    treeCompleteness,
    factsCompleteness,
    reasons: Object.freeze([...new Set(reasons)].sort(compareStrings)),
  });
}

/** Short alias for callers that already use the certification vocabulary. */
export const admitEvidence = admitRepositoryEvidence;
