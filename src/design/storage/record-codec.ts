import type {
  CertificationCheck,
  CertificationEvidence,
  DesignChangeLifecycleState,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  EvidenceReference,
  ImplementationLink,
  RepositoryRevisionReference,
} from "../contracts.js";
import { canonicalizeJson, type Digest } from "../digest.js";
import { createSemanticEntryKey, SEMANTIC_ENTRY_COLLECTIONS, type SemanticEntryKey } from "../entry-key.js";
import { decodeImplementationLink, decodeImplementationLinks } from "../linkage/codec.js";
import { validateDesignReviewEvidence } from "../review/codec.js";
import { decodeDesignChangeSet, serializeDesignChangeSet } from "../change/codec.js";
import type { DesignChangeSet } from "../contracts.js";

type JsonRecord = Record<string, unknown>;

const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[^\s\p{Cc}\p{Cf}\p{Cs}]+$/u;
const STATES: readonly DesignChangeLifecycleState[] = [
  "draft",
  "design-review",
  "approved",
  "implementing",
  "certification-review",
  "promoted",
];

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function fields(value: JsonRecord, allowed: readonly string[], label: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
}

function required(value: JsonRecord, name: string, label: string): unknown {
  if (!Object.hasOwn(value, name) || value[name] === undefined) {
    throw new TypeError(`${label} is missing required field: ${name}`);
  }
  return value[name];
}

function text(value: unknown, label: string, allowWhitespace = false): string {
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

function identifier(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!IDENTIFIER.test(normalized)) throw new TypeError(`${label} is malformed`);
  return normalized;
}

function digest(value: unknown, label: string): Digest {
  const normalized = text(value, label);
  if (!HEX_DIGEST.test(normalized)) throw new TypeError(`${label} must be a SHA-256 hexadecimal digest`);
  return normalized as Digest;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function semanticEntryKey(value: unknown, label: string): SemanticEntryKey {
  const encoded = text(value, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded) as unknown;
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
    if (canonical !== encoded) throw new TypeError(`${label} is not a canonical EntryRef`);
    return canonical;
  } catch {
    throw new TypeError(`${label} is not a canonical EntryRef`);
  }
}

function references(value: unknown, label: string): readonly EvidenceReference[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    fields(item, ["provider", "reference"], `${label}[${index}]`);
    return Object.freeze({
      provider: identifier(required(item, "provider", `${label}[${index}]`), `${label}[${index}].provider`),
      reference: text(required(item, "reference", `${label}[${index}]`), `${label}[${index}].reference`, true),
    });
  });
  result.sort(
    (left, right) => compareOrdinal(left.provider, right.provider) || compareOrdinal(left.reference, right.reference),
  );
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous.provider === current.provider && previous.reference === current.reference) {
      throw new TypeError(`${label} contains duplicate reference`);
    }
  }
  return Object.freeze(result);
}

function revision(value: unknown): RepositoryRevisionReference {
  const item = record(value, "implementation revision");
  fields(item, ["repository", "revision"], "implementation revision");
  return Object.freeze({
    repository: text(
      required(item, "repository", "implementation revision"),
      "implementation revision.repository",
      true,
    ),
    revision: text(required(item, "revision", "implementation revision"), "implementation revision.revision"),
  });
}

function certificationCheck(value: unknown, index: number): CertificationCheck {
  const item = record(value, `certification check ${index}`);
  fields(item, ["checkId", "targetEntryKey", "result", "detail"], `certification check ${index}`);
  const result = required(item, "result", `certification check ${index}`);
  if (result !== "match" && result !== "mismatch" && result !== "unresolved") {
    throw new TypeError(`certification check ${index} has an invalid result`);
  }
  const target =
    item.targetEntryKey === undefined
      ? undefined
      : semanticEntryKey(item.targetEntryKey, `certification check ${index}.targetEntryKey`);
  return Object.freeze({
    checkId: identifier(
      required(item, "checkId", `certification check ${index}`),
      `certification check ${index}.checkId`,
    ),
    ...(target === undefined ? {} : { targetEntryKey: target as CertificationCheck["targetEntryKey"] }),
    result,
    ...(item.detail === undefined ? {} : { detail: text(item.detail, `certification check ${index}.detail`, true) }),
  });
}

function certification(value: unknown): CertificationEvidence {
  const item = record(value, "certification evidence");
  fields(
    item,
    [
      "certificationId",
      "changeId",
      "changeDigest",
      "implementationRevision",
      "result",
      "checks",
      "recordedAt",
      "references",
    ],
    "certification evidence",
  );
  const result = required(item, "result", "certification evidence");
  if (result !== "match" && result !== "mismatch" && result !== "unresolved") {
    throw new TypeError("certification evidence has an invalid result");
  }
  if (!Array.isArray(item.checks) || item.checks.length === 0) {
    throw new TypeError("certification evidence checks must be a non-empty array");
  }
  const checks = item.checks.map(certificationCheck).sort((left, right) => compareOrdinal(left.checkId, right.checkId));
  for (let index = 1; index < checks.length; index += 1) {
    if (checks[index - 1].checkId === checks[index].checkId) {
      throw new TypeError(`certification evidence contains duplicate check: ${checks[index].checkId}`);
    }
  }
  return Object.freeze({
    certificationId: identifier(required(item, "certificationId", "certification evidence"), "certificationId"),
    changeId: identifier(required(item, "changeId", "certification evidence"), "certification changeId"),
    changeDigest: digest(required(item, "changeDigest", "certification evidence"), "certification changeDigest"),
    implementationRevision: revision(required(item, "implementationRevision", "certification evidence")),
    result,
    checks: Object.freeze(checks),
    recordedAt: text(required(item, "recordedAt", "certification evidence"), "certification recordedAt", true),
    ...(item.references === undefined ? {} : { references: references(item.references, "certification references") }),
  });
}

function lifecycle(value: unknown): DesignIntentLifecycleRecord {
  const item = record(value, "Design lifecycle record");
  fields(
    item,
    ["changeId", "changeDigest", "state", "review", "implementations", "certification"],
    "Design lifecycle record",
  );
  const state = required(item, "state", "Design lifecycle record");
  if (!STATES.includes(state as DesignChangeLifecycleState))
    throw new TypeError("Design lifecycle state is unsupported");
  const lifecycleState = state as DesignChangeLifecycleState;
  const implementationsValue = required(item, "implementations", "Design lifecycle record");
  if (!Array.isArray(implementationsValue)) throw new TypeError("Design lifecycle implementations must be an array");
  const implementations = implementationsValue
    .map((entry) => decodeImplementationLink(entry))
    .sort((left, right) => compareOrdinal(left.linkId, right.linkId));
  for (let index = 1; index < implementations.length; index += 1) {
    if (implementations[index - 1].linkId === implementations[index].linkId) {
      throw new TypeError(`Design lifecycle contains duplicate implementation link: ${implementations[index].linkId}`);
    }
  }
  const review = item.review === undefined ? undefined : validateDesignReviewEvidence(item.review);
  const certificationValue = item.certification === undefined ? undefined : certification(item.certification);
  return Object.freeze({
    changeId: identifier(required(item, "changeId", "Design lifecycle record"), "Design lifecycle changeId"),
    changeDigest: digest(required(item, "changeDigest", "Design lifecycle record"), "Design lifecycle changeDigest"),
    state: lifecycleState,
    ...(review === undefined ? {} : { review }),
    implementations: Object.freeze(implementations),
    ...(certificationValue === undefined ? {} : { certification: certificationValue }),
  });
}

/** Strictly validates a lifecycle record and returns its canonical immutable form. */
export function decodeDesignIntentLifecycleRecord(value: unknown): DesignIntentLifecycleRecord {
  return lifecycle(value);
}

/** Deterministic JSON representation of a lifecycle record. */
export function serializeDesignIntentLifecycleRecord(value: DesignIntentLifecycleRecord): string {
  return JSON.stringify(lifecycle(value));
}

/** Parses a lifecycle record after rejecting duplicate JSON object fields. */
export function parseDesignIntentLifecycleRecord(source: string): DesignIntentLifecycleRecord {
  return lifecycle(parseJsonWithoutDuplicateFields(source, "Design lifecycle record"));
}

/** Strictly decodes a stored Design Change Set. */
export function decodeStoredDesignChange(value: unknown): DesignChangeSet {
  return decodeDesignChangeSet(value);
}

export function serializeStoredDesignChange(value: DesignChangeSet): string {
  return serializeDesignChangeSet(value);
}

export function parseStoredDesignChange(source: string): DesignChangeSet {
  return decodeDesignChangeSet(parseJsonWithoutDuplicateFields(source, "Design Change Set"));
}

interface JsonParser {
  readonly source: string;
  index: number;
}

function whitespace(parser: JsonParser): void {
  while (parser.index < parser.source.length) {
    const code = parser.source.charCodeAt(parser.index);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
    parser.index += 1;
  }
}

function parseString(parser: JsonParser): string {
  const start = parser.index;
  parser.index += 1;
  let escaped = false;
  while (parser.index < parser.source.length) {
    const character = parser.source[parser.index];
    parser.index += 1;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return JSON.parse(parser.source.slice(start, parser.index)) as string;
    if (character.codePointAt(0)! < 0x20) throw new SyntaxError("invalid JSON string");
  }
  throw new SyntaxError("unterminated JSON string");
}

function parseValue(parser: JsonParser): unknown {
  whitespace(parser);
  const character = parser.source[parser.index];
  if (character === '"') return parseString(parser);
  if (character === "{") return parseObject(parser);
  if (character === "[") return parseArray(parser);
  const remaining = parser.source.slice(parser.index);
  const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(remaining);
  if (literal === null) throw new SyntaxError("invalid JSON value");
  parser.index += literal[0].length;
  return JSON.parse(literal[0]) as unknown;
}

function parseObject(parser: JsonParser): JsonRecord {
  parser.index += 1;
  const result: JsonRecord = {};
  const keys = new Set<string>();
  whitespace(parser);
  if (parser.source[parser.index] === "}") {
    parser.index += 1;
    return result;
  }
  while (parser.index < parser.source.length) {
    whitespace(parser);
    if (parser.source[parser.index] !== '"') throw new SyntaxError("JSON object key must be a string");
    const key = parseString(parser);
    if (keys.has(key)) throw new TypeError(`duplicate JSON object field: ${key}`);
    keys.add(key);
    whitespace(parser);
    if (parser.source[parser.index] !== ":") throw new SyntaxError("JSON object missing colon");
    parser.index += 1;
    result[key] = parseValue(parser);
    whitespace(parser);
    const next = parser.source[parser.index];
    if (next === "}") {
      parser.index += 1;
      return result;
    }
    if (next !== ",") throw new SyntaxError("JSON object missing comma");
    parser.index += 1;
  }
  throw new SyntaxError("unterminated JSON object");
}

function parseArray(parser: JsonParser): unknown[] {
  parser.index += 1;
  const result: unknown[] = [];
  whitespace(parser);
  if (parser.source[parser.index] === "]") {
    parser.index += 1;
    return result;
  }
  while (parser.index < parser.source.length) {
    result.push(parseValue(parser));
    whitespace(parser);
    const next = parser.source[parser.index];
    if (next === "]") {
      parser.index += 1;
      return result;
    }
    if (next !== ",") throw new SyntaxError("JSON array missing comma");
    parser.index += 1;
  }
  throw new SyntaxError("unterminated JSON array");
}

function parseJsonWithoutDuplicateFields(source: string, label: string): unknown {
  if (typeof source !== "string") throw new TypeError(`${label} JSON must be a string`);
  const parser: JsonParser = { source, index: 0 };
  try {
    const value = parseValue(parser);
    whitespace(parser);
    if (parser.index !== source.length) throw new SyntaxError("trailing JSON data");
    return value;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("duplicate JSON object field:")) throw error;
    throw new SyntaxError(`invalid ${label} JSON: ${String(error)}`);
  }
}

/** Shared helper for strict comparisons without exposing mutable input. */
export function canonicalRecordBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalizeJson(value), "utf8");
}
