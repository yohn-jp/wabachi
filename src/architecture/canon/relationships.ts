import { normalizeIdentityId, type ObjectId } from "./identity.js";
import type { ElementRecord } from "./elements.js";

/** The intentionally small vocabulary of canonical directed relationships. */
export const RELATIONSHIP_KINDS = ["depends-on", "calls", "uses", "data", "control"] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export interface InterfaceInput {
  readonly id: string;
  readonly owner: string;
  readonly protocol?: string;
  readonly technology?: string;
}

export interface InterfaceRecord {
  readonly id: ObjectId;
  readonly owner: ObjectId;
  readonly protocol?: string;
  readonly technology?: string;
}

export interface RelationshipInput {
  readonly source: string;
  readonly target: string;
  readonly kind: RelationshipKind;
  readonly interfaceId?: string;
}

export interface RelationshipRecord {
  readonly source: ObjectId;
  readonly target: ObjectId;
  readonly kind: RelationshipKind;
  readonly interfaceId?: ObjectId;
}

export interface RelationshipValidationContext {
  readonly elements?: readonly ElementRecord[];
  readonly interfaces?: readonly InterfaceRecord[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }

  return normalized;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function readId(record: Record<string, unknown>, field: string, label: string): ObjectId {
  const value = record[field];
  if (typeof value !== "string") {
    throw new TypeError(`${label} ${field} must be a string`);
  }
  return normalizeIdentityId(value) as ObjectId;
}

function readRelationshipKind(value: unknown): RelationshipKind {
  if (typeof value !== "string" || !(RELATIONSHIP_KINDS as readonly string[]).includes(value)) {
    throw new TypeError(`relationship kind is unsupported: ${String(value)}`);
  }
  return value as RelationshipKind;
}

/** Create one interface/port declaration without resolving its owner. */
export function createInterface(input: InterfaceInput): InterfaceRecord {
  assertRecord(input, "interface");

  const id = readId(input, "id", "interface");
  const owner = readId(input, "owner", "interface");
  const protocol = input.protocol === undefined ? undefined : normalizeText(input.protocol, "interface protocol");
  const technology =
    input.technology === undefined ? undefined : normalizeText(input.technology, "interface technology");

  return Object.freeze({
    id,
    owner,
    ...(protocol === undefined ? {} : { protocol }),
    ...(technology === undefined ? {} : { technology }),
  });
}

/** Create one directed relationship declaration without resolving its references. */
export function createRelationship(input: RelationshipInput): RelationshipRecord {
  assertRecord(input, "relationship");

  const source = readId(input, "source", "relationship");
  const target = readId(input, "target", "relationship");
  const kind = readRelationshipKind(input.kind);
  const interfaceId = input.interfaceId === undefined ? undefined : readId(input, "interfaceId", "relationship");

  return Object.freeze({
    source,
    target,
    kind,
    ...(interfaceId === undefined ? {} : { interfaceId }),
  });
}

function elementIds(elements: readonly ElementRecord[] | undefined): Set<string> | undefined {
  if (elements === undefined) return undefined;
  if (!Array.isArray(elements)) {
    throw new TypeError("relationship validation elements must be an array");
  }

  const ids = new Set<string>();
  for (const element of elements) {
    assertRecord(element, "relationship validation element");
    const id = readId(element, "id", "relationship validation element");
    if (ids.has(id)) throw new Error(`duplicate relationship validation element id: ${id}`);
    ids.add(id);
  }
  return ids;
}

function interfaceById(interfaces: readonly InterfaceRecord[] | undefined): Map<string, InterfaceRecord> | undefined {
  if (interfaces === undefined) return undefined;
  if (!Array.isArray(interfaces)) {
    throw new TypeError("relationship validation interfaces must be an array");
  }

  const byId = new Map<string, InterfaceRecord>();
  for (const item of interfaces) {
    assertRecord(item, "relationship validation interface");
    const id = readId(item, "id", "relationship validation interface");
    if (byId.has(id)) throw new Error(`duplicate interface id: ${id}`);
    byId.set(id, item as unknown as InterfaceRecord);
  }
  return byId;
}

function interfaceKey(record: InterfaceRecord): string {
  return record.id;
}

function compareInterfaces(left: InterfaceRecord, right: InterfaceRecord): number {
  return compareStrings(left.id, right.id);
}

/** Normalize interfaces, rejecting duplicate IDs and optionally unknown owners. */
export function normalizeInterfaces(
  inputs: readonly InterfaceInput[],
  elements?: readonly ElementRecord[],
): readonly InterfaceRecord[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("interfaces must be an array");
  }

  const knownElements = elementIds(elements);
  const interfaces = inputs.map(createInterface);
  const seen = new Set<string>();
  for (const item of interfaces) {
    if (seen.has(interfaceKey(item))) throw new Error(`duplicate interface id: ${item.id}`);
    seen.add(interfaceKey(item));
    if (knownElements !== undefined && !knownElements.has(item.owner)) {
      throw new Error(`unknown interface owner: ${item.owner}`);
    }
  }

  interfaces.sort(compareInterfaces);
  return Object.freeze(interfaces);
}

/** Alias matching the single-record constructor naming used by the canon modules. */
export const createInterfaces = normalizeInterfaces;

function compareRelationships(left: RelationshipRecord, right: RelationshipRecord): number {
  return (
    compareStrings(left.source, right.source) ||
    compareStrings(left.target, right.target) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.interfaceId ?? "", right.interfaceId ?? "")
  );
}

function relationshipKey(record: RelationshipRecord): string {
  return `${record.source}\u0000${record.target}\u0000${record.kind}\u0000${record.interfaceId ?? ""}`;
}

/**
 * Normalize directed relationships. References are checked only against the
 * supplied canonical context; no missing element or interface is synthesized.
 */
export function normalizeRelationships(
  inputs: readonly RelationshipInput[],
  context: RelationshipValidationContext = {},
): readonly RelationshipRecord[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("relationships must be an array");
  }

  const knownElements = elementIds(context.elements);
  const knownInterfaces = interfaceById(context.interfaces);
  const relationships = inputs.map(createRelationship);
  const seen = new Set<string>();
  for (const relationship of relationships) {
    if (knownElements !== undefined) {
      if (!knownElements.has(relationship.source)) {
        throw new Error(`unknown relationship source: ${relationship.source}`);
      }
      if (!knownElements.has(relationship.target)) {
        throw new Error(`unknown relationship target: ${relationship.target}`);
      }
    }

    if (relationship.interfaceId !== undefined) {
      const contract = knownInterfaces?.get(relationship.interfaceId);
      if (contract === undefined) {
        throw new Error(`unknown relationship interface: ${relationship.interfaceId}`);
      }
      if (contract.owner !== relationship.source && contract.owner !== relationship.target) {
        throw new Error(`relationship interface owner is not an endpoint: ${relationship.interfaceId}`);
      }
    }

    const key = relationshipKey(relationship);
    if (seen.has(key)) {
      throw new Error(
        `duplicate relationship: ${relationship.source} -> ${relationship.target} (${relationship.kind})`,
      );
    }
    seen.add(key);
  }

  relationships.sort(compareRelationships);
  return Object.freeze(relationships);
}

/** Validate an already-created relationship set without changing its order. */
export function validateRelationships(
  relationships: readonly RelationshipRecord[],
  context: RelationshipValidationContext = {},
): void {
  if (!Array.isArray(relationships)) {
    throw new TypeError("relationships must be an array");
  }

  normalizeRelationships(relationships, context);
}
