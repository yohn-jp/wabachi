import type { DesignReviewDecision, DesignReviewEvidence, EvidenceReference } from "../contracts.js";
import type { Digest } from "../digest.js";

export const DESIGN_REVIEW_DECISIONS = ["approved", "changes-requested", "rejected"] as const;

export const DESIGN_REVIEW_HISTORY_SCHEMA_VERSION = 1 as const;

export type DesignReviewEvidenceInput = {
  readonly reviewId: string;
  readonly changeId: string;
  readonly proposalDigest: string;
  readonly proposalRevision: string;
  readonly decision: DesignReviewDecision;
  readonly actor: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly evidence: readonly EvidenceReference[];
};

export interface DesignReviewHistory {
  readonly schemaVersion: typeof DESIGN_REVIEW_HISTORY_SCHEMA_VERSION;
  readonly reviews: readonly DesignReviewEvidence[];
}

export interface DesignReviewHistoryInput {
  readonly schemaVersion?: typeof DESIGN_REVIEW_HISTORY_SCHEMA_VERSION;
  readonly reviews: readonly DesignReviewEvidenceInput[];
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

function normalizeText(value: unknown, label: string, options: { allowWhitespace?: boolean } = {}): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized) ||
    (!options.allowWhitespace && /\p{White_Space}/u.test(normalized))
  ) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

function normalizeReason(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("review reason must be a string");
  const normalized = value.normalize("NFC");
  if (normalized.length === 0 || normalized.trim().length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError("review reason must not be empty");
  }
  return normalized;
}

function normalizeNonEmptyText(value: unknown, label: string, options: { allowWhitespace?: boolean } = {}): string {
  const normalized = normalizeText(value, label, options);
  if (normalized.trim().length === 0) throw new TypeError(`${label} must not be empty`);
  return normalized;
}

function normalizeDigest(value: unknown): Digest {
  const digest = normalizeText(value, "proposal digest");
  if (!/^[0-9a-f]{64}$/iu.test(digest)) {
    throw new TypeError("proposal digest must be a 64-character hexadecimal SHA-256 digest");
  }
  return digest.toLowerCase() as Digest;
}

function normalizeRevision(value: unknown): string {
  const revision = normalizeText(value, "proposal revision");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(revision)) {
    throw new TypeError("proposal revision must be a full immutable hexadecimal revision");
  }
  return revision.toLowerCase();
}

function normalizeTimestamp(value: unknown): string {
  const timestamp = normalizeText(value, "review timestamp");
  // Require an ISO-8601 date-time with an explicit timezone. Date.parse alone
  // accepts locale-like strings and silently normalizes invalid input.
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u);
  if (match === null) {
    throw new TypeError("review timestamp must be an ISO-8601 date-time with a timezone");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[7];
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))
  ) {
    throw new TypeError("review timestamp is invalid");
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new TypeError("review timestamp is invalid");
  return new Date(parsed).toISOString();
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeEvidence(value: unknown): readonly EvidenceReference[] {
  if (!Array.isArray(value)) throw new TypeError("review evidence must be an array");
  const references = value.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`review evidence ${index} must be an object`);
    assertAllowedKeys(entry, ["provider", "reference"], `review evidence ${index}`);
    return {
      provider: normalizeText(entry.provider, `review evidence ${index} provider`),
      reference: normalizeNonEmptyText(entry.reference, `review evidence ${index} reference`, {
        allowWhitespace: true,
      }),
    };
  });

  references.sort(
    (left, right) => compareText(left.provider, right.provider) || compareText(left.reference, right.reference),
  );
  const unique: EvidenceReference[] = [];
  for (const reference of references) {
    const previous = unique[unique.length - 1];
    if (previous?.provider === reference.provider && previous.reference === reference.reference) continue;
    unique.push(reference);
  }
  return Object.freeze(unique.map((reference) => Object.freeze(reference)));
}

function normalizeReview(input: unknown): DesignReviewEvidence {
  if (!isRecord(input)) throw new TypeError("design review evidence must be an object");
  assertAllowedKeys(
    input,
    [
      "reviewId",
      "changeId",
      "proposalDigest",
      "proposalRevision",
      "decision",
      "actor",
      "reason",
      "timestamp",
      "evidence",
    ],
    "design review evidence",
  );

  if (!DESIGN_REVIEW_DECISIONS.includes(input.decision as DesignReviewDecision)) {
    throw new TypeError("design review decision is unsupported");
  }

  const review = {
    reviewId: normalizeText(input.reviewId, "review id"),
    changeId: normalizeText(input.changeId, "change id"),
    proposalDigest: normalizeDigest(input.proposalDigest),
    proposalRevision: normalizeRevision(input.proposalRevision),
    decision: input.decision as DesignReviewDecision,
    actor: normalizeNonEmptyText(input.actor, "review actor", { allowWhitespace: true }),
    reason: normalizeReason(input.reason),
    timestamp: normalizeTimestamp(input.timestamp),
    evidence: normalizeEvidence(input.evidence),
  } satisfies DesignReviewEvidence;

  return Object.freeze(review);
}

function canonicalReview(review: DesignReviewEvidence): DesignReviewEvidence {
  return {
    reviewId: review.reviewId,
    changeId: review.changeId,
    proposalDigest: review.proposalDigest,
    proposalRevision: review.proposalRevision,
    decision: review.decision,
    actor: review.actor,
    reason: review.reason,
    timestamp: review.timestamp,
    evidence: review.evidence.map((reference) => ({
      provider: reference.provider,
      reference: reference.reference,
    })),
  };
}

/** Creates and validates one immutable, provider-neutral design review record. */
export function createDesignReviewEvidence(input: DesignReviewEvidenceInput): DesignReviewEvidence {
  return normalizeReview(input);
}

/** Validates a decoded review artifact and returns its canonical immutable form. */
export function validateDesignReviewEvidence(input: unknown): DesignReviewEvidence {
  return normalizeReview(input);
}

/** Deterministic JSON serialization of one design review record. */
export function serializeDesignReviewEvidence(input: DesignReviewEvidenceInput | DesignReviewEvidence): string {
  return JSON.stringify(canonicalReview(normalizeReview(input)));
}

/** Parses and validates one design review record. */
export function parseDesignReviewEvidence(serialized: string): DesignReviewEvidence {
  if (typeof serialized !== "string") throw new TypeError("design review serialization must be a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("design review serialization is malformed");
  }
  return normalizeReview(parsed);
}

/** Alias for callers that use decode terminology for JSON artifacts. */
export const decodeDesignReviewEvidence = parseDesignReviewEvidence;

function compareReviews(left: DesignReviewEvidence, right: DesignReviewEvidence): number {
  return compareText(left.reviewId, right.reviewId);
}

function reviewBytes(review: DesignReviewEvidence): string {
  return serializeDesignReviewEvidence(review);
}

function normalizeHistory(input: unknown): DesignReviewHistory {
  if (!isRecord(input)) throw new TypeError("design review history must be an object");
  assertAllowedKeys(input, ["schemaVersion", "reviews"], "design review history");
  if (input.schemaVersion !== DESIGN_REVIEW_HISTORY_SCHEMA_VERSION) {
    throw new TypeError("design review history schema version is unsupported");
  }
  if (!Array.isArray(input.reviews)) throw new TypeError("design review history reviews must be an array");

  const reviews = input.reviews.map(normalizeReview).sort(compareReviews);
  const unique: DesignReviewEvidence[] = [];
  for (const review of reviews) {
    const previous = unique[unique.length - 1];
    if (previous?.reviewId !== review.reviewId) {
      unique.push(review);
      continue;
    }
    if (reviewBytes(previous) !== reviewBytes(review)) {
      throw new Error(`design review history conflict for review ID: ${review.reviewId}`);
    }
  }

  return Object.freeze({
    schemaVersion: DESIGN_REVIEW_HISTORY_SCHEMA_VERSION,
    reviews: Object.freeze(unique),
  });
}

/** Creates an immutable review history and rejects conflicting duplicate IDs. */
export function createDesignReviewHistory(reviews: readonly DesignReviewEvidenceInput[] = []): DesignReviewHistory {
  return normalizeHistory({ schemaVersion: DESIGN_REVIEW_HISTORY_SCHEMA_VERSION, reviews });
}

/** Records one review without mutating history; an identical record is idempotent. */
export function recordDesignReviewEvidence(
  history: DesignReviewHistory,
  review: DesignReviewEvidenceInput | DesignReviewEvidence,
): DesignReviewHistory {
  const current = normalizeHistory(history);
  return normalizeHistory({
    schemaVersion: DESIGN_REVIEW_HISTORY_SCHEMA_VERSION,
    reviews: [...current.reviews, review],
  });
}

/** Alias describing the append-only operation more explicitly. */
export const appendDesignReviewEvidence = recordDesignReviewEvidence;

/** Deterministic JSON serialization of review history. */
export function serializeDesignReviewHistory(history: DesignReviewHistory): string {
  const normalized = normalizeHistory(history);
  return JSON.stringify({ schemaVersion: normalized.schemaVersion, reviews: normalized.reviews.map(canonicalReview) });
}

/** Parses and validates review history. */
export function parseDesignReviewHistory(serialized: string): DesignReviewHistory {
  if (typeof serialized !== "string") throw new TypeError("design review history serialization must be a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("design review history serialization is malformed");
  }
  return normalizeHistory(parsed);
}

export const decodeDesignReviewHistory = parseDesignReviewHistory;
