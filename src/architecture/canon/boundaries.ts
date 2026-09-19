import { normalizeIdentityId } from "./identity.js";

declare const boundaryIdBrand: unique symbol;
declare const canonMemberIdBrand: unique symbol;

export type BoundaryId = string & { readonly [boundaryIdBrand]: never };
export type CanonMemberId = string & { readonly [canonMemberIdBrand]: never };

export const BOUNDARY_KINDS = ["semantic", "trust", "ownership"] as const;
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];

export interface BoundaryInput {
  readonly id: string;
  readonly kind: BoundaryKind;
  readonly memberIds: readonly string[];
}

export interface Boundary {
  readonly id: BoundaryId;
  readonly kind: BoundaryKind;
  readonly memberIds: readonly CanonMemberId[];
}

function normalizeBoundaryId(value: unknown): BoundaryId {
  return normalizeIdentityId(value as string) as BoundaryId;
}

function normalizeMemberId(value: unknown): CanonMemberId {
  return normalizeIdentityId(value as string) as CanonMemberId;
}

function isBoundaryKind(value: unknown): value is BoundaryKind {
  return typeof value === "string" && (BOUNDARY_KINDS as readonly string[]).includes(value);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertBoundaryInput(input: unknown): asserts input is BoundaryInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("boundary must be an object");
  }

  const candidate = input as {
    id?: unknown;
    kind?: unknown;
    memberIds?: unknown;
  };

  normalizeBoundaryId(candidate.id);
  if (!isBoundaryKind(candidate.kind)) {
    throw new TypeError("boundary kind is malformed");
  }
  if (!Array.isArray(candidate.memberIds)) {
    throw new TypeError("boundary memberIds must be an array");
  }
}

/**
 * Creates a declarative boundary record. Member IDs are retained as references;
 * this module does not resolve or synthesize the referenced Canon records.
 */
export function createBoundary(input: BoundaryInput): Boundary {
  assertBoundaryInput(input);

  const id = normalizeBoundaryId(input.id);
  const memberIds = input.memberIds.map((memberId) => normalizeMemberId(memberId));
  const seenMemberIds = new Set<string>();
  for (const memberId of memberIds) {
    if (seenMemberIds.has(memberId)) {
      throw new Error(`duplicate boundary member id: ${memberId}`);
    }
    seenMemberIds.add(memberId);
  }

  memberIds.sort(compareStrings);

  return Object.freeze({
    id,
    kind: input.kind,
    memberIds: Object.freeze(memberIds),
  });
}

/**
 * Creates a deterministic collection of boundaries and rejects duplicate
 * boundary identities rather than silently selecting one definition.
 */
export function createBoundaries(inputs: readonly BoundaryInput[]): readonly Boundary[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("boundaries must be an array");
  }

  const boundaries = inputs.map((input) => createBoundary(input));
  const seenBoundaryIds = new Set<string>();
  for (const boundary of boundaries) {
    if (seenBoundaryIds.has(boundary.id)) {
      throw new Error(`duplicate boundary id: ${boundary.id}`);
    }
    seenBoundaryIds.add(boundary.id);
  }

  boundaries.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(boundaries);
}
