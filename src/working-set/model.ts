/** Version of the Wabachi-owned Candidate Working Set artifact. */
export const CANDIDATE_WORKING_SET_SCHEMA_VERSION = 1 as const;
export type CandidateWorkingSetSchemaVersion = typeof CANDIDATE_WORKING_SET_SCHEMA_VERSION;

export const CANDIDATE_WORKING_SET_KIND = "candidate-working-set" as const;

export const CANDIDATE_WORKING_SET_STATES = ["required", "supporting", "verification", "unresolved"] as const;
export type CandidateWorkingSetState = (typeof CANDIDATE_WORKING_SET_STATES)[number];

export const CANDIDATE_WORKING_SET_TARGET_KINDS = ["file", "symbol", "test", "unresolved"] as const;
export type CandidateWorkingSetTargetKind = (typeof CANDIDATE_WORKING_SET_TARGET_KINDS)[number];

/** Maximum sizes keep the semantic artifact bounded and exclude payload storage. */
export const CANDIDATE_WORKING_SET_LIMITS = Object.freeze({
  maxEntries: 1024,
  maxEvidenceReferencesPerEntry: 16,
  maxWorkingSetIdLength: 256,
  maxRepositoryFieldLength: 256,
  maxRevisionLength: 64,
  maxTargetLocatorLength: 1024,
  maxReasonIdLength: 256,
  maxReasonSummaryLength: 512,
  maxEvidenceArtifactLength: 256,
  maxEvidenceReferenceLength: 1024,
});

export interface RepositoryIdentity {
  readonly repositoryHost: string;
  readonly repositoryId: string;
  readonly repository: string;
}

export interface WorkingSetTarget {
  /** `unresolved` is an explicit semantic target and is never a file path. */
  readonly kind: CandidateWorkingSetTargetKind;
  readonly locator: string;
}

export interface WorkingSetReasonReference {
  /** Stable reference identity owned by the evidence-producing boundary. */
  readonly id: string;
  /** Human-readable bounded explanation; it is not provider payload. */
  readonly summary: string;
}

export interface WorkingSetEvidenceReference {
  /** Opaque source-artifact name, such as a provider evidence artifact or Canon. */
  readonly artifact: string;
  /** Bounded locator within the source artifact. */
  readonly reference: string;
}

export interface CandidateWorkingSetEntry {
  readonly state: CandidateWorkingSetState;
  readonly target: WorkingSetTarget;
  readonly reason: WorkingSetReasonReference;
  readonly evidence: readonly WorkingSetEvidenceReference[];
}

export interface CandidateWorkingSet {
  readonly kind: typeof CANDIDATE_WORKING_SET_KIND;
  readonly schemaVersion: CandidateWorkingSetSchemaVersion;
  readonly workingSetId: string;
  readonly repository: RepositoryIdentity;
  /** Full immutable revision identifier; branches and mutable refs are rejected. */
  readonly revision: string;
  readonly entries: readonly CandidateWorkingSetEntry[];
}

export interface RepositoryIdentityInput {
  readonly repositoryHost: string;
  readonly repositoryId: string;
  readonly repository: string;
}

export interface WorkingSetTargetInput {
  readonly kind: CandidateWorkingSetTargetKind;
  readonly locator: string;
}

export interface WorkingSetReasonReferenceInput {
  readonly id: string;
  readonly summary: string;
}

export interface WorkingSetEvidenceReferenceInput {
  readonly artifact: string;
  readonly reference: string;
}

export interface CandidateWorkingSetEntryInput {
  readonly state: CandidateWorkingSetState;
  readonly target: WorkingSetTargetInput;
  readonly reason: WorkingSetReasonReferenceInput;
  readonly evidence: readonly WorkingSetEvidenceReferenceInput[];
}

export interface CandidateWorkingSetInput {
  readonly kind?: typeof CANDIDATE_WORKING_SET_KIND;
  readonly schemaVersion?: CandidateWorkingSetSchemaVersion;
  readonly workingSetId: string;
  readonly repository: RepositoryIdentityInput;
  readonly revision: string;
  readonly entries: readonly CandidateWorkingSetEntryInput[];
}

const stateOrder: Readonly<Record<CandidateWorkingSetState, number>> = Object.freeze({
  required: 0,
  supporting: 1,
  verification: 2,
  unresolved: 3,
});

const targetKindOrder: Readonly<Record<CandidateWorkingSetTargetKind, number>> = Object.freeze({
  file: 0,
  symbol: 1,
  test: 2,
  unresolved: 3,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
}

function normalizeText(
  value: unknown,
  label: string,
  maxLength: number,
  options: { allowWhitespace?: boolean } = {},
): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized) ||
    (!options.allowWhitespace && /\p{White_Space}/u.test(normalized))
  ) {
    throw new TypeError(`${label} is malformed or exceeds its bound`);
  }
  return normalized;
}

function normalizeSummary(value: unknown): string {
  return normalizeText(value, "reason summary", CANDIDATE_WORKING_SET_LIMITS.maxReasonSummaryLength, {
    allowWhitespace: true,
  });
}

function normalizeRepository(value: unknown): RepositoryIdentity {
  if (!isRecord(value)) throw new TypeError("repository must be an object");
  assertAllowedKeys(value, ["repositoryHost", "repositoryId", "repository"], "repository");
  return Object.freeze({
    repositoryHost: normalizeText(
      value.repositoryHost,
      "repository repositoryHost",
      CANDIDATE_WORKING_SET_LIMITS.maxRepositoryFieldLength,
    ),
    repositoryId: normalizeText(
      value.repositoryId,
      "repository repositoryId",
      CANDIDATE_WORKING_SET_LIMITS.maxRepositoryFieldLength,
    ),
    repository: normalizeText(
      value.repository,
      "repository repository",
      CANDIDATE_WORKING_SET_LIMITS.maxRepositoryFieldLength,
    ),
  });
}

function normalizeRevision(value: unknown): string {
  const revision = normalizeText(value, "revision", CANDIDATE_WORKING_SET_LIMITS.maxRevisionLength);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision)) {
    throw new TypeError("revision must be a full immutable hexadecimal revision");
  }
  return revision.toLowerCase();
}

function normalizeTarget(value: unknown): WorkingSetTarget {
  if (!isRecord(value)) throw new TypeError("entry target must be an object");
  assertAllowedKeys(value, ["kind", "locator"], "entry target");
  if (!CANDIDATE_WORKING_SET_TARGET_KINDS.includes(value.kind as CandidateWorkingSetTargetKind)) {
    throw new TypeError("entry target kind is unsupported");
  }
  return Object.freeze({
    kind: value.kind as CandidateWorkingSetTargetKind,
    locator: normalizeText(value.locator, "entry target locator", CANDIDATE_WORKING_SET_LIMITS.maxTargetLocatorLength, {
      allowWhitespace: true,
    }),
  });
}

function normalizeReason(value: unknown): WorkingSetReasonReference {
  if (!isRecord(value)) throw new TypeError("entry reason must be an object");
  assertAllowedKeys(value, ["id", "summary"], "entry reason");
  return Object.freeze({
    id: normalizeText(value.id, "reason id", CANDIDATE_WORKING_SET_LIMITS.maxReasonIdLength),
    summary: normalizeSummary(value.summary),
  });
}

function normalizeEvidence(value: unknown): readonly WorkingSetEvidenceReference[] {
  if (!Array.isArray(value)) throw new TypeError("entry evidence must be an array");
  if (value.length > CANDIDATE_WORKING_SET_LIMITS.maxEvidenceReferencesPerEntry) {
    throw new TypeError("entry evidence exceeds its bound");
  }

  const evidence = value.map((reference, index) => {
    if (!isRecord(reference)) throw new TypeError(`entry evidence ${index} must be an object`);
    assertAllowedKeys(reference, ["artifact", "reference"], `entry evidence ${index}`);
    return {
      artifact: normalizeText(
        reference.artifact,
        `entry evidence ${index} artifact`,
        CANDIDATE_WORKING_SET_LIMITS.maxEvidenceArtifactLength,
      ),
      reference: normalizeText(
        reference.reference,
        `entry evidence ${index} reference`,
        CANDIDATE_WORKING_SET_LIMITS.maxEvidenceReferenceLength,
        { allowWhitespace: true },
      ),
    };
  });
  evidence.sort(compareEvidence);
  return Object.freeze(evidence.map((reference) => Object.freeze(reference)));
}

function normalizeEntry(value: unknown): CandidateWorkingSetEntry {
  if (!isRecord(value)) throw new TypeError("working-set entry must be an object");
  assertAllowedKeys(value, ["state", "target", "reason", "evidence"], "working-set entry");
  if (!CANDIDATE_WORKING_SET_STATES.includes(value.state as CandidateWorkingSetState)) {
    throw new TypeError("working-set entry state is unsupported");
  }
  const state = value.state as CandidateWorkingSetState;
  const target = normalizeTarget(value.target);
  if (state === "unresolved" && target.kind !== "unresolved") {
    throw new TypeError("unresolved entries must use an unresolved target");
  }
  if (state !== "unresolved" && target.kind === "unresolved") {
    throw new TypeError("non-unresolved entries cannot use an unresolved target");
  }
  return Object.freeze({
    state,
    target,
    reason: normalizeReason(value.reason),
    evidence: normalizeEvidence(value.evidence),
  });
}

function compareEvidence(left: WorkingSetEvidenceReference, right: WorkingSetEvidenceReference): number {
  const artifact = left.artifact.localeCompare(right.artifact);
  if (artifact !== 0) return artifact;
  return left.reference.localeCompare(right.reference);
}

function compareEntries(left: CandidateWorkingSetEntry, right: CandidateWorkingSetEntry): number {
  const state = stateOrder[left.state] - stateOrder[right.state];
  if (state !== 0) return state;
  const targetKind = targetKindOrder[left.target.kind] - targetKindOrder[right.target.kind];
  if (targetKind !== 0) return targetKind;
  const locator = left.target.locator.localeCompare(right.target.locator);
  if (locator !== 0) return locator;
  const reasonId = left.reason.id.localeCompare(right.reason.id);
  if (reasonId !== 0) return reasonId;
  const summary = left.reason.summary.localeCompare(right.reason.summary);
  if (summary !== 0) return summary;
  const leftEvidence = left.evidence
    .map((reference) => `${reference.artifact}\u0000${reference.reference}`)
    .join("\u0001");
  const rightEvidence = right.evidence
    .map((reference) => `${reference.artifact}\u0000${reference.reference}`)
    .join("\u0001");
  return leftEvidence.localeCompare(rightEvidence);
}

function normalizeInput(input: unknown, requireVersion: boolean): CandidateWorkingSet {
  if (!isRecord(input)) throw new TypeError("candidate working set must be an object");
  assertAllowedKeys(
    input,
    ["kind", "schemaVersion", "workingSetId", "repository", "revision", "entries"],
    "candidate working set",
  );
  if (input.kind !== undefined && input.kind !== CANDIDATE_WORKING_SET_KIND) {
    throw new TypeError("candidate working set kind is unsupported");
  }
  if (requireVersion && input.schemaVersion !== CANDIDATE_WORKING_SET_SCHEMA_VERSION) {
    throw new TypeError("candidate working set schema version is unsupported");
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== CANDIDATE_WORKING_SET_SCHEMA_VERSION) {
    throw new TypeError("candidate working set schema version is unsupported");
  }
  if (!Array.isArray(input.entries)) throw new TypeError("candidate working set entries must be an array");
  if (input.entries.length > CANDIDATE_WORKING_SET_LIMITS.maxEntries) {
    throw new TypeError("candidate working set entries exceed their bound");
  }

  const entries = input.entries.map(normalizeEntry).sort(compareEntries);
  return Object.freeze({
    kind: CANDIDATE_WORKING_SET_KIND,
    schemaVersion: CANDIDATE_WORKING_SET_SCHEMA_VERSION,
    workingSetId: normalizeText(input.workingSetId, "workingSetId", CANDIDATE_WORKING_SET_LIMITS.maxWorkingSetIdLength),
    repository: normalizeRepository(input.repository),
    revision: normalizeRevision(input.revision),
    entries: Object.freeze(entries),
  });
}

/** Creates and canonicalizes a Candidate Working Set from trusted in-memory input. */
export function createCandidateWorkingSet(input: CandidateWorkingSetInput): CandidateWorkingSet {
  return normalizeInput(input, false);
}

/** Validates a serialized-shape artifact and returns its canonical immutable model. */
export function validateCandidateWorkingSet(input: unknown): CandidateWorkingSet {
  return normalizeInput(input, true);
}
