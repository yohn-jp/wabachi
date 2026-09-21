import type { DesignChangeSet, EvidenceReference, ExternalIssueReference, ImplementationLink } from "../contracts.js";
import { SEMANTIC_ENTRY_COLLECTIONS, createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";
import type { Digest } from "../digest.js";

type JsonRecord = Record<string, unknown>;

/** The proposal identity a linkage must be attached to. */
export type ProposalRevision =
  | Pick<DesignChangeSet, "changeId" | "digest">
  | {
      readonly changeId: string;
      readonly changeDigest: Digest;
    };

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readRecord(value: unknown, label: string, allowed: readonly string[]): JsonRecord {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const allowedFields = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
  return value;
}

function readRequired(record: JsonRecord, field: string, label: string): unknown {
  if (!Object.hasOwn(record, field) || record[field] === undefined) {
    throw new TypeError(`${label} is missing required field: ${field}`);
  }
  return record[field];
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeText(value: unknown, label: string, allowWhitespace = false): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized) ||
    (!allowWhitespace && /\p{White_Space}/u.test(normalized))
  ) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

function normalizeIdentifier(value: unknown, label: string): string {
  return normalizeText(value, label);
}

function normalizeDigest(value: unknown, label: string): Digest {
  const digest = normalizeText(value, label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return digest as Digest;
}

function normalizeRepositoryHost(value: unknown): string {
  const host = normalizeText(value, "implementation repositoryHost");
  if (host.includes("/")) throw new TypeError("implementation repositoryHost is malformed");
  return host;
}

function normalizeRepositoryId(value: unknown): string {
  return normalizeText(value, "implementation repositoryId");
}

function normalizeRepositoryLocator(value: unknown): string {
  const repository = normalizeText(value, "implementation repository");
  const separator = repository.indexOf("/");
  if (separator <= 0 || separator === repository.length - 1 || repository.indexOf("/", separator + 1) !== -1) {
    throw new TypeError("implementation repository must be an owner/name locator");
  }
  return repository;
}

function normalizeIssueNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("implementation number must be a positive safe integer");
  }
  return value;
}

/**
 * Decodes the provider-neutral IssueReference tuple. The optional repository
 * name is retained only as a locator; it is not part of its identity.
 */
export function decodeExternalIssueReference(value: unknown): ExternalIssueReference {
  const record = readRecord(value, "implementation", ["repositoryHost", "repositoryId", "repository", "number"]);
  const repository = Object.hasOwn(record, "repository") ? normalizeRepositoryLocator(record.repository) : undefined;
  return Object.freeze({
    repositoryHost: normalizeRepositoryHost(readRequired(record, "repositoryHost", "implementation")),
    repositoryId: normalizeRepositoryId(readRequired(record, "repositoryId", "implementation")),
    ...(repository === undefined ? {} : { repository }),
    number: normalizeIssueNumber(readRequired(record, "number", "implementation")),
  });
}

/** A stable identity key that deliberately excludes the optional repository locator. */
export function externalIssueIdentityKey(value: ExternalIssueReference): string {
  const reference = decodeExternalIssueReference(value);
  return JSON.stringify([reference.repositoryHost, reference.repositoryId, reference.number]);
}

/** Compares only the provider identity fields, never the owner/name locator. */
export function sameExternalIssueIdentity(left: ExternalIssueReference, right: ExternalIssueReference): boolean {
  return externalIssueIdentityKey(left) === externalIssueIdentityKey(right);
}

function readJsonArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${label} must not contain sparse entries`);
  }
  return value;
}

function normalizeSemanticEntryKey(value: unknown, label: string): SemanticEntryKey {
  const key = normalizeText(value, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(key) as unknown;
  } catch {
    throw new TypeError(`${label} is not a canonical EntryRef`);
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length < 2 ||
    typeof parsed[0] !== "string" ||
    !SEMANTIC_ENTRY_COLLECTIONS.includes(parsed[0] as (typeof SEMANTIC_ENTRY_COLLECTIONS)[number]) ||
    parsed.slice(1).some((part) => typeof part !== "string")
  ) {
    throw new TypeError(`${label} is not a canonical EntryRef`);
  }

  try {
    const canonical = createSemanticEntryKey({
      collection: parsed[0] as (typeof SEMANTIC_ENTRY_COLLECTIONS)[number],
      identity: parsed.slice(1) as string[],
    });
    if (canonical !== key) throw new TypeError(`${label} is not a canonical EntryRef`);
    return canonical;
  } catch {
    throw new TypeError(`${label} is not a canonical EntryRef`);
  }
}

function normalizeTargetEntryKeys(value: unknown): readonly SemanticEntryKey[] {
  const entries = readJsonArray(value, "implementation targetEntryKeys");
  if (entries.length === 0) throw new TypeError("implementation targetEntryKeys must not be empty");

  const keys = entries.map((entry, index) =>
    normalizeSemanticEntryKey(entry, `implementation targetEntryKeys ${index}`),
  );
  keys.sort(compareOrdinal);
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index] === keys[index - 1]) {
      throw new TypeError(`implementation targetEntryKeys contains duplicate target: ${keys[index]}`);
    }
  }
  return Object.freeze(keys);
}

function normalizeEvidence(value: unknown): readonly EvidenceReference[] {
  const references = readJsonArray(value, "implementation evidence").map((entry, index) => {
    const record = readRecord(entry, `implementation evidence ${index}`, ["provider", "reference"]);
    return {
      provider: normalizeIdentifier(
        readRequired(record, "provider", `implementation evidence ${index}`),
        "implementation evidence provider",
      ),
      reference: normalizeText(
        readRequired(record, "reference", `implementation evidence ${index}`),
        "implementation evidence reference",
        true,
      ),
    } satisfies EvidenceReference;
  });
  references.sort(
    (left, right) => compareOrdinal(left.provider, right.provider) || compareOrdinal(left.reference, right.reference),
  );
  for (let index = 1; index < references.length; index += 1) {
    const previous = references[index - 1];
    const current = references[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.provider === current.provider &&
      previous.reference === current.reference
    ) {
      throw new TypeError("implementation evidence contains duplicate reference");
    }
  }
  return Object.freeze(references.map((reference) => Object.freeze(reference)));
}

function normalizeExpectedProposal(value: ProposalRevision): {
  readonly changeId: string;
  readonly changeDigest: Digest;
} {
  if (!isRecord(value)) throw new TypeError("proposal revision must be an object");
  const record = value as JsonRecord;
  const changeId = normalizeIdentifier(
    readRequired(record, "changeId", "proposal revision"),
    "proposal revision changeId",
  );
  const digestValue = Object.hasOwn(record, "digest")
    ? record["digest"]
    : readRequired(record, "changeDigest", "proposal revision");
  return { changeId, changeDigest: normalizeDigest(digestValue, "proposal revision digest") };
}

function assertProposalRevision(
  link: Pick<ImplementationLink, "changeId" | "changeDigest">,
  expectedProposal: ProposalRevision | undefined,
): void {
  if (expectedProposal === undefined) return;
  const expected = normalizeExpectedProposal(expectedProposal);
  if (link.changeId !== expected.changeId || link.changeDigest !== expected.changeDigest) {
    throw new Error("implementation link does not match the expected proposal revision");
  }
}

/** Strictly decodes one linkage record and optionally binds it to a proposal revision. */
export function decodeImplementationLink(value: unknown, expectedProposal?: ProposalRevision): ImplementationLink {
  const record = readRecord(value, "implementation link", [
    "linkId",
    "changeId",
    "changeDigest",
    "implementation",
    "targetEntryKeys",
    "evidence",
  ]);
  const evidence = Object.hasOwn(record, "evidence") ? normalizeEvidence(record.evidence) : undefined;
  const link = Object.freeze({
    linkId: normalizeIdentifier(readRequired(record, "linkId", "implementation link"), "implementation link linkId"),
    changeId: normalizeIdentifier(
      readRequired(record, "changeId", "implementation link"),
      "implementation link changeId",
    ),
    changeDigest: normalizeDigest(
      readRequired(record, "changeDigest", "implementation link"),
      "implementation link changeDigest",
    ),
    implementation: decodeExternalIssueReference(readRequired(record, "implementation", "implementation link")),
    targetEntryKeys: normalizeTargetEntryKeys(readRequired(record, "targetEntryKeys", "implementation link")),
    ...(evidence === undefined ? {} : { evidence }),
  });
  assertProposalRevision(link, expectedProposal);
  return link;
}

/** Strictly decodes a JSON array of linkage records against one proposal revision. */
export function decodeImplementationLinks(
  value: unknown,
  expectedProposal?: ProposalRevision,
): readonly ImplementationLink[] {
  const links = readJsonArray(value, "implementation links").map((entry) =>
    decodeImplementationLink(entry, expectedProposal),
  );
  return Object.freeze(links);
}

/** Deterministic JSON serialization of one external IssueReference. */
export function serializeExternalIssueReference(value: ExternalIssueReference): string {
  return JSON.stringify(decodeExternalIssueReference(value));
}

/** Deterministic JSON serialization of one linkage record. */
export function serializeImplementationLink(value: ImplementationLink, expectedProposal?: ProposalRevision): string {
  return JSON.stringify(decodeImplementationLink(value, expectedProposal));
}

/** Deterministic JSON serialization of linkage records. */
export function serializeImplementationLinks(
  value: readonly ImplementationLink[],
  expectedProposal?: ProposalRevision,
): string {
  return JSON.stringify(decodeImplementationLinks(value, expectedProposal));
}

function parseJson(source: string, label: string): unknown {
  if (typeof source !== "string") throw new TypeError(`${label} JSON must be a string`);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new SyntaxError(`invalid ${label} JSON`);
  }
}

export function parseExternalIssueReference(source: string): ExternalIssueReference {
  return decodeExternalIssueReference(parseJson(source, "external IssueReference"));
}

export function parseImplementationLink(source: string, expectedProposal?: ProposalRevision): ImplementationLink {
  return decodeImplementationLink(parseJson(source, "implementation link"), expectedProposal);
}

export function parseImplementationLinks(
  source: string,
  expectedProposal?: ProposalRevision,
): readonly ImplementationLink[] {
  return decodeImplementationLinks(parseJson(source, "implementation links"), expectedProposal);
}

export const encodeExternalIssueReference = serializeExternalIssueReference;
export const encodeImplementationLink = serializeImplementationLink;
export const encodeImplementationLinks = serializeImplementationLinks;
