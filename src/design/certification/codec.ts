import type { EvidenceReference, RepositoryRevisionReference } from "../contracts.js";
import type { Digest } from "../digest.js";

/** The only certification data an external provider may submit. */
export interface ExternalCertificationInput {
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly references?: readonly EvidenceReference[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertKnownFields(record: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!fields.includes(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
}

function readRequiredString(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== "string") throw new TypeError(`${label} ${field} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} ${field} is malformed`);
  }
  return normalized;
}

function readDigest(record: Record<string, unknown>): Digest {
  const digest = readRequiredString(record, "changeDigest", "certification input");
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError("certification input changeDigest must be a SHA-256 hexadecimal digest");
  }
  return digest as Digest;
}

function readRevision(value: unknown): RepositoryRevisionReference {
  assertRecord(value, "certification input implementationRevision");
  assertKnownFields(value, ["repository", "revision"], "implementation revision");
  return Object.freeze({
    repository: readRequiredString(value, "repository", "implementation revision"),
    revision: readRequiredString(value, "revision", "implementation revision"),
  });
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function readReferences(value: unknown, label: string): readonly EvidenceReference[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const references = value.map((entry, index) => {
    assertRecord(entry, `${label}[${index}]`);
    assertKnownFields(entry, ["provider", "reference"], `${label}[${index}]`);
    return Object.freeze({
      provider: readRequiredString(entry, "provider", `${label}[${index}]`),
      reference: readRequiredString(entry, "reference", `${label}[${index}]`),
    });
  });
  references.sort(
    (left, right) => compareStrings(left.provider, right.provider) || compareStrings(left.reference, right.reference),
  );
  for (let index = 1; index < references.length; index += 1) {
    const previous = references[index - 1];
    const current = references[index];
    if (previous.provider === current.provider && previous.reference === current.reference) {
      throw new Error(`duplicate certification evidence reference: ${current.provider}/${current.reference}`);
    }
  }
  return Object.freeze(references);
}

/**
 * Decode provider evidence without allowing the provider to assert a
 * certification result. Result/check fields are intentionally not part of
 * this wire format; Wabachi derives them from the proof plan.
 */
export function decodeExternalCertificationInput(value: unknown): ExternalCertificationInput {
  assertRecord(value, "certification input");
  assertKnownFields(value, ["changeId", "changeDigest", "implementationRevision", "references"], "certification input");
  if (
    !Object.hasOwn(value, "changeId") ||
    !Object.hasOwn(value, "changeDigest") ||
    !Object.hasOwn(value, "implementationRevision")
  ) {
    throw new TypeError("certification input is missing a required binding field");
  }

  const references =
    value.references === undefined ? undefined : readReferences(value.references, "certification input references");
  return Object.freeze({
    changeId: readRequiredString(value, "changeId", "certification input"),
    changeDigest: readDigest(value),
    implementationRevision: readRevision(value.implementationRevision),
    ...(references === undefined ? {} : { references }),
  });
}

/** Canonical short name used by certification callers. */
export const decodeCertificationInput = decodeExternalCertificationInput;

/** Parse a JSON text payload through the same strict external boundary. */
export function parseExternalCertificationInput(source: string): ExternalCertificationInput {
  if (typeof source !== "string") throw new TypeError("certification input JSON must be a string");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new SyntaxError(`invalid certification input JSON: ${String(error)}`);
  }
  return decodeExternalCertificationInput(value);
}

export const parseCertificationInput = parseExternalCertificationInput;
