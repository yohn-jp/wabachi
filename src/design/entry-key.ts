import type { RelationshipKind } from "../architecture/canon/relationships.js";

declare const semanticEntryKeyBrand: unique symbol;

/** A stable, collection-qualified identity for one semantic entry. */
export type SemanticEntryKey = string & { readonly [semanticEntryKeyBrand]: never };

export const SEMANTIC_ENTRY_COLLECTIONS = [
  "architecture",
  "element",
  "interface",
  "relationship",
  "responsibility",
  "authority",
  "boundary",
  "constraint",
  "flow",
  "deployment",
  "repository-mapping",
  "decision",
  "view",
  "code-intent",
] as const;

export type SemanticEntryCollection = (typeof SEMANTIC_ENTRY_COLLECTIONS)[number];

export interface SemanticEntryKeyInput {
  readonly collection: SemanticEntryCollection;
  readonly identity: readonly string[];
}

export interface RelationshipEntryKeyInput {
  readonly source: string;
  readonly target: string;
  readonly kind: RelationshipKind;
  readonly interfaceId?: string;
}

/**
 * Decode and re-encode a semantic key so consumers share the same canonical
 * tuple validation as the producer.  The returned tuple excludes the
 * collection envelope; its order is the collection's semantic contract.
 */
export function parseSemanticEntryKey(value: unknown): {
  readonly collection: SemanticEntryCollection;
  readonly identity: readonly string[];
  readonly encoded: SemanticEntryKey;
} {
  if (typeof value !== "string") throw new TypeError("semantic entry key must be a string");

  let tuple: unknown;
  try {
    tuple = JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError(`semantic entry key is not a JSON tuple: ${String(error)}`);
  }
  if (!Array.isArray(tuple) || tuple.length < 2 || typeof tuple[0] !== "string") {
    throw new TypeError("semantic entry key must contain a collection and identity tuple");
  }

  const collection = tuple[0];
  const identity = tuple.slice(1);
  if (identity.some((part) => typeof part !== "string")) {
    throw new TypeError("semantic entry key identity must contain strings");
  }
  const encoded = createSemanticEntryKey({
    collection: collection as SemanticEntryCollection,
    identity: identity as string[],
  });
  if (encoded !== value) throw new TypeError("semantic entry key is not canonically encoded");
  return { collection: collection as SemanticEntryCollection, identity: identity as string[], encoded };
}

function normalizeIdentityPart(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.normalize("NFC");
  if (normalized.length === 0 || /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

/** Encodes the collection and its ordered identity tuple as JSON to avoid delimiter collisions. */
export function createSemanticEntryKey(input: SemanticEntryKeyInput): SemanticEntryKey {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("semantic entry key input must be an object");
  }
  if (!SEMANTIC_ENTRY_COLLECTIONS.includes(input.collection)) {
    throw new TypeError("semantic entry key collection is unsupported");
  }
  if (!Array.isArray(input.identity) || input.identity.length === 0) {
    throw new TypeError("semantic entry key identity must be a non-empty tuple");
  }

  const identity = input.identity.map((part, index) => normalizeIdentityPart(part, `identity[${index}]`));
  return JSON.stringify([input.collection, ...identity]) as SemanticEntryKey;
}

/** Builds the relationship tuple in its fixed source/target/kind/interface order. */
export function createRelationshipEntryKey(input: RelationshipEntryKeyInput): SemanticEntryKey {
  const identity = [input.source, input.target, input.kind];
  if (input.interfaceId !== undefined) identity.push(input.interfaceId);
  return createSemanticEntryKey({ collection: "relationship", identity });
}
