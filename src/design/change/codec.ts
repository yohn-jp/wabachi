import {
  DESIGN_CHANGE_CONTRACT_VERSION,
  type CanonRevisionReference,
  type DesignChangeOperation,
  type DesignChangeSet,
  type DesignChangeSetPayload,
  type DesignChangeTarget,
} from "../contracts.js";
import { canonicalizeJson, digestJson, type Digest, type JsonValue } from "../digest.js";
import { createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";

type JsonRecord = Record<string, unknown>;

const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const CHANGE_ID = /^[^\s\p{Cc}\p{Cf}\p{Cs}]+$/u;

function assertRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonRecord;
}

function assertKnownFields(record: JsonRecord, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
}

function required(record: JsonRecord, key: string, label: string): unknown {
  if (!Object.hasOwn(record, key) || record[key] === undefined) {
    throw new TypeError(`${label} is missing required field: ${key}`);
  }
  return record[key];
}

function readString(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern !== undefined && !pattern.test(value))) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function readDigest(value: unknown, label: string): Digest {
  return readString(value, label, HEX_DIGEST) as Digest;
}

function readGitObjectId(value: unknown): string {
  return readString(value, "base.repositoryRevision", GIT_OBJECT_ID);
}

function readCanonVersion(value: unknown, label: string): 1 {
  if (value !== 1) throw new TypeError(`${label} is unsupported`);
  return 1;
}

function readJsonValue(value: unknown, label: string): JsonValue {
  try {
    // Besides checking JSON shape, this rejects undefined, non-finite numbers,
    // symbols, class instances, sparse arrays, and cyclic values.
    return JSON.parse(canonicalizeJson(value)) as JsonValue;
  } catch (error) {
    throw new TypeError(`${label} is not a JSON value: ${String(error)}`);
  }
}

function readSemanticEntryKey(value: unknown): SemanticEntryKey {
  const encoded = readString(value, "operation.entryKey");
  let tuple: unknown;
  try {
    tuple = JSON.parse(encoded) as unknown;
  } catch (error) {
    throw new TypeError(`operation.entryKey is invalid: ${String(error)}`);
  }
  if (!Array.isArray(tuple) || tuple.length < 2 || tuple.some((part) => typeof part !== "string")) {
    throw new TypeError("operation.entryKey is invalid");
  }
  try {
    return createSemanticEntryKey({
      collection: tuple[0] as never,
      identity: tuple.slice(1) as string[],
    });
  } catch (error) {
    throw new TypeError(`operation.entryKey is invalid: ${String(error)}`);
  }
}

function decodeOperation(value: unknown): DesignChangeOperation {
  const record = assertRecord(value, "Design Change operation");
  const kind = required(record, "kind", "Design Change operation");
  if (kind !== "added" && kind !== "modified" && kind !== "removed") {
    throw new TypeError("Design Change operation kind is invalid");
  }

  if (kind === "added") {
    assertKnownFields(record, ["kind", "entryKey", "value"], "added operation");
    return {
      kind,
      entryKey: readSemanticEntryKey(required(record, "entryKey", "added operation")),
      value: readJsonValue(required(record, "value", "added operation"), "added operation.value"),
    };
  }
  if (kind === "modified") {
    assertKnownFields(record, ["kind", "entryKey", "before", "after"], "modified operation");
    const before = readJsonValue(required(record, "before", "modified operation"), "modified operation.before");
    const after = readJsonValue(required(record, "after", "modified operation"), "modified operation.after");
    if (canonicalizeJson(before) === canonicalizeJson(after)) {
      throw new TypeError("modified operation must change the semantic value");
    }
    return {
      kind,
      entryKey: readSemanticEntryKey(required(record, "entryKey", "modified operation")),
      before,
      after,
    };
  }

  assertKnownFields(record, ["kind", "entryKey", "before"], "removed operation");
  return {
    kind,
    entryKey: readSemanticEntryKey(required(record, "entryKey", "removed operation")),
    before: readJsonValue(required(record, "before", "removed operation"), "removed operation.before"),
  };
}

function decodeBase(value: unknown): CanonRevisionReference {
  const record = assertRecord(value, "Design Change base");
  assertKnownFields(record, ["repositoryRevision", "canonVersion", "canonDigest"], "Design Change base");
  return {
    repositoryRevision: readGitObjectId(required(record, "repositoryRevision", "Design Change base")),
    canonVersion: readCanonVersion(required(record, "canonVersion", "Design Change base"), "base.canonVersion"),
    canonDigest: readDigest(required(record, "canonDigest", "Design Change base"), "base.canonDigest"),
  };
}

function decodeTarget(value: unknown): DesignChangeTarget {
  const record = assertRecord(value, "Design Change target");
  assertKnownFields(record, ["canonVersion", "operations", "targetCanonDigest"], "Design Change target");
  const operationsValue = required(record, "operations", "Design Change target");
  if (!Array.isArray(operationsValue)) throw new TypeError("Design Change target.operations must be an array");

  const operations = operationsValue.map(decodeOperation).sort((left, right) => {
    if (left.entryKey < right.entryKey) return -1;
    if (left.entryKey > right.entryKey) return 1;
    return 0;
  });
  const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.entryKey)) throw new TypeError(`duplicate semantic entry: ${operation.entryKey}`);
    seen.add(operation.entryKey);
  }
  return {
    canonVersion: readCanonVersion(required(record, "canonVersion", "Design Change target"), "target.canonVersion"),
    operations,
    targetCanonDigest: readDigest(
      required(record, "targetCanonDigest", "Design Change target"),
      "target.targetCanonDigest",
    ),
  };
}

function decodePayload(value: unknown): DesignChangeSetPayload {
  const record = assertRecord(value, "Design Change Set");
  // The same record is used by the outer decoder; `digest` is checked there
  // and intentionally excluded from the payload returned here.
  assertKnownFields(record, ["contractVersion", "changeId", "base", "target", "digest"], "Design Change Set");
  if (required(record, "contractVersion", "Design Change Set") !== DESIGN_CHANGE_CONTRACT_VERSION) {
    throw new TypeError("Design Change contractVersion is unsupported");
  }
  const changeId = readString(required(record, "changeId", "Design Change Set"), "changeId", CHANGE_ID);
  return {
    contractVersion: DESIGN_CHANGE_CONTRACT_VERSION,
    changeId,
    base: decodeBase(required(record, "base", "Design Change Set")),
    target: decodeTarget(required(record, "target", "Design Change Set")),
  };
}

/** Strictly decodes a Design Change Set value and verifies its payload digest. */
export function decodeDesignChangeSet(value: unknown): DesignChangeSet {
  const record = assertRecord(value, "Design Change Set");
  assertKnownFields(record, ["contractVersion", "changeId", "base", "target", "digest"], "Design Change Set");
  const payload = decodePayload(record);
  const digest = readDigest(required(record, "digest", "Design Change Set"), "digest");
  const expected = digestJson(payload);
  if (digest !== expected) throw new Error("Design Change Set digest does not match its payload");
  return Object.freeze({ ...payload, digest });
}

/** Parses strict Design Change JSON text. */
export function parseDesignChangeSet(source: string): DesignChangeSet {
  if (typeof source !== "string") throw new TypeError("Design Change Set JSON must be a string");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new SyntaxError(`invalid Design Change Set JSON: ${String(error)}`);
  }
  return decodeDesignChangeSet(value);
}

/** Serializes a Design Change Set with deterministic object and operation ordering. */
export function serializeDesignChangeSet(change: DesignChangeSet): string {
  const decoded = decodeDesignChangeSet(change);
  return JSON.stringify(decoded);
}

export const encodeDesignChangeSet = serializeDesignChangeSet;
export const serializeDesignChange = serializeDesignChangeSet;
export const parseDesignChange = parseDesignChangeSet;
