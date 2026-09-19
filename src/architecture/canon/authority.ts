import { createObjectId, type ObjectId } from "./identity.js";

/** A declaration of the canonical decision or truth owner for a concern. */
export interface AuthorityFact {
  readonly kind: "authority";
  readonly concern: ObjectId;
  readonly owner: ObjectId;
}

/** A declaration of the resource, contract, or lifecycle owner for a resource. */
export interface OwnershipFact {
  readonly kind: "ownership";
  readonly resource: ObjectId;
  readonly owner: ObjectId;
}

export type AuthorityOwnershipFact = AuthorityFact | OwnershipFact;

export interface AuthorityFactInput {
  readonly concern: string;
  readonly owner: string;
}

export interface OwnershipFactInput {
  readonly resource: string;
  readonly owner: string;
}

export interface AuthorityOwnershipFactsInput {
  readonly authority?: readonly AuthorityFactInput[];
  readonly ownership?: readonly OwnershipFactInput[];
}

export interface AuthorityOwnershipFacts {
  readonly authority: readonly AuthorityFact[];
  readonly ownership: readonly OwnershipFact[];
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }

  return input as Record<string, unknown>;
}

function readObjectId(record: Record<string, unknown>, field: string, label: string): ObjectId {
  const value = record[field];
  if (typeof value !== "string") {
    throw new TypeError(`${label} ${field} must be a string`);
  }

  return createObjectId(value);
}

export function createAuthorityFact(input: AuthorityFactInput): AuthorityFact {
  const record = asRecord(input, "authority fact");

  return Object.freeze({
    kind: "authority" as const,
    concern: readObjectId(record, "concern", "authority fact"),
    owner: readObjectId(record, "owner", "authority fact"),
  });
}

export function createOwnershipFact(input: OwnershipFactInput): OwnershipFact {
  const record = asRecord(input, "ownership fact");

  return Object.freeze({
    kind: "ownership" as const,
    resource: readObjectId(record, "resource", "ownership fact"),
    owner: readObjectId(record, "owner", "ownership fact"),
  });
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function createAuthorityFacts(inputs: readonly AuthorityFactInput[]): readonly AuthorityFact[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("authority facts must be an array");
  }

  const facts = inputs.map(createAuthorityFact);
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = `${fact.concern}\u0000${fact.owner}`;
    if (seen.has(key)) {
      throw new Error(`duplicate authority fact: ${fact.concern} -> ${fact.owner}`);
    }
    seen.add(key);
  }

  facts.sort((left, right) => compareIds(left.concern, right.concern) || compareIds(left.owner, right.owner));
  return Object.freeze(facts);
}

export function createOwnershipFacts(inputs: readonly OwnershipFactInput[]): readonly OwnershipFact[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("ownership facts must be an array");
  }

  const facts = inputs.map(createOwnershipFact);
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = `${fact.resource}\u0000${fact.owner}`;
    if (seen.has(key)) {
      throw new Error(`duplicate ownership fact: ${fact.resource} -> ${fact.owner}`);
    }
    seen.add(key);
  }

  facts.sort((left, right) => compareIds(left.resource, right.resource) || compareIds(left.owner, right.owner));
  return Object.freeze(facts);
}

export function createAuthorityOwnershipFacts(input: AuthorityOwnershipFactsInput): AuthorityOwnershipFacts {
  const record = asRecord(input, "authority/ownership facts");
  const authority = createAuthorityFacts((record.authority ?? []) as readonly AuthorityFactInput[]);
  const ownership = createOwnershipFacts((record.ownership ?? []) as readonly OwnershipFactInput[]);

  return Object.freeze({ authority, ownership });
}
