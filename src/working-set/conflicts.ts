import {
  CANDIDATE_WORKING_SET_LIMITS,
  type CandidateWorkingSetEntry,
  type RepositoryIdentity,
  type WorkingSetEvidenceReference,
  type WorkingSetTarget,
} from "./model.js";

/** V1 diagnostics that must remain visible instead of being resolved implicitly. */
export const WORKING_SET_CONFLICT_KINDS = [
  "ambiguity",
  "disagreement",
  "stale-evidence",
  "mapping-gap",
  "required-but-unauthorized",
  "insufficient-evidence",
] as const;
export type WorkingSetConflictKind = (typeof WORKING_SET_CONFLICT_KINDS)[number];

const CONFLICT_SUMMARIES: Readonly<Record<WorkingSetConflictKind, string>> = Object.freeze({
  ambiguity: "candidate evidence has multiple possible interpretations",
  disagreement: "provider evidence disagrees about the candidate context",
  "stale-evidence": "evidence is not pinned to the current repository revision",
  "mapping-gap": "required evidence has no unique Canon repository mapping",
  "required-but-unauthorized": "required context is outside the supplied authorization comparison",
  "insufficient-evidence": "available evidence is insufficient for a current derivation",
});

export interface WorkingSetConflict {
  readonly kind: WorkingSetConflictKind;
  /** Unresolved target used to preserve the conflict in the Candidate Working Set artifact. */
  readonly target: WorkingSetTarget;
  readonly reason: {
    readonly id: string;
    readonly summary: string;
  };
  readonly evidence: readonly WorkingSetEvidenceReference[];
}

export interface WorkingSetAuthorizationEntry {
  readonly target: WorkingSetTarget;
  readonly evidence?: readonly WorkingSetEvidenceReference[];
}

/**
 * External authorization is intentionally only an input to comparison. It is
 * never copied into the Candidate Working Set as authority and never widened
 * by Wabachi.
 */
export interface WorkingSetAuthorizationInput {
  readonly repository?: RepositoryIdentity;
  readonly revision?: string;
  readonly targets?: readonly (WorkingSetTarget | WorkingSetAuthorizationEntry)[];
  readonly entries?: readonly WorkingSetAuthorizationEntry[];
  readonly authorizedTargets?: readonly (WorkingSetTarget | WorkingSetAuthorizationEntry)[];
}

export interface WorkingSetConflictInput {
  readonly kind: WorkingSetConflictKind;
  /** Stable conflict-local locator, not provider payload. */
  readonly locator: string;
  readonly evidence?: readonly WorkingSetEvidenceReference[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function evidenceKey(reference: WorkingSetEvidenceReference): string {
  return `${reference.artifact}\u0000${reference.reference}`;
}

function boundedEvidence(references: readonly WorkingSetEvidenceReference[]): readonly WorkingSetEvidenceReference[] {
  const unique = new Map<string, WorkingSetEvidenceReference>();
  for (const reference of references) unique.set(evidenceKey(reference), reference);
  return [...unique.values()]
    .sort((left, right) => compareText(left.artifact, right.artifact) || compareText(left.reference, right.reference))
    .slice(0, CANDIDATE_WORKING_SET_LIMITS.maxEvidenceReferencesPerEntry);
}

function boundedLocator(value: string): string {
  const normalized = value.normalize("NFC");
  return normalized.length === 0 ? "unknown" : normalized.slice(0, CANDIDATE_WORKING_SET_LIMITS.maxTargetLocatorLength);
}

/** Creates one deterministic, unresolved conflict record from bounded evidence. */
export function createWorkingSetConflict(input: WorkingSetConflictInput): WorkingSetConflict {
  const locator = boundedLocator(input.locator);
  const kind = input.kind;
  return Object.freeze({
    kind,
    target: Object.freeze({ kind: "unresolved" as const, locator: boundedLocator(`conflict:${kind}:${locator}`) }),
    reason: Object.freeze({ id: `conflict:${kind}`, summary: CONFLICT_SUMMARIES[kind] }),
    evidence: Object.freeze(boundedEvidence(input.evidence ?? [])),
  });
}

/** Converts the semantic conflict record into the existing artifact entry shape. */
export function conflictToWorkingSetEntry(conflict: WorkingSetConflict): CandidateWorkingSetEntry {
  return {
    state: "unresolved",
    target: conflict.target,
    reason: conflict.reason,
    evidence: conflict.evidence,
  };
}

/** Returns the machine-readable conflict class carried by an unresolved entry. */
export function getWorkingSetConflictKind(entry: CandidateWorkingSetEntry): WorkingSetConflictKind | undefined {
  if (entry.state !== "unresolved" || entry.target.kind !== "unresolved") return undefined;
  const kind = entry.reason.id.startsWith("conflict:") ? entry.reason.id.slice("conflict:".length) : undefined;
  return WORKING_SET_CONFLICT_KINDS.includes(kind as WorkingSetConflictKind)
    ? (kind as WorkingSetConflictKind)
    : undefined;
}

function isAuthorizationEntry(
  value: WorkingSetTarget | WorkingSetAuthorizationEntry,
): value is WorkingSetAuthorizationEntry {
  return "target" in value;
}

/** Canonicalizes the supported authorization comparison shapes without issuing authority. */
export function authorizationEntries(input: WorkingSetAuthorizationInput): readonly WorkingSetAuthorizationEntry[] {
  const values = [...(input.targets ?? []), ...(input.entries ?? []), ...(input.authorizedTargets ?? [])].map(
    (value) => (isAuthorizationEntry(value) ? value : { target: value }),
  );
  const unique = new Map<string, WorkingSetAuthorizationEntry>();
  for (const value of values) {
    const key = `${value.target.kind}\u0000${value.target.locator}`;
    const existing = unique.get(key);
    if (existing === undefined) {
      unique.set(key, value);
      continue;
    }
    unique.set(key, {
      target: existing.target,
      evidence: boundedEvidence([...(existing.evidence ?? []), ...(value.evidence ?? [])]),
    });
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.target.kind, right.target.kind) || compareText(left.target.locator, right.target.locator),
  );
}

export function workingSetTargetKey(target: WorkingSetTarget): string {
  return `${target.kind}\u0000${target.locator}`;
}

export function conflictSummary(kind: WorkingSetConflictKind): string {
  return CONFLICT_SUMMARIES[kind];
}
