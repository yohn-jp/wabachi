import {
  createArchitectureId,
  createObjectId,
  normalizeIdentityId,
  type ArchitectureId,
  type ObjectId,
} from "./identity.js";

declare const responsibilityIdBrand: unique symbol;

export type ResponsibilityId = string & {
  readonly [responsibilityIdBrand]: never;
};

export interface ResponsibilityTargetInput {
  readonly kind: "architecture" | "object";
  readonly id: string;
  readonly displayName?: string;
}

export type ResponsibilityTarget =
  | {
      readonly kind: "architecture";
      readonly id: ArchitectureId;
    }
  | {
      readonly kind: "object";
      readonly id: ObjectId;
    };

export interface ResponsibilityInput {
  readonly id: string;
  readonly target: ResponsibilityTargetInput;
  readonly concern: string;
  readonly displayName?: string;
}

export interface ResponsibilityFact {
  readonly kind: "responsibility";
  readonly id: ResponsibilityId;
  readonly target: ResponsibilityTarget;
  readonly concern: string;
}

export interface ResponsibilitySetInput {
  readonly responsibilities?: readonly ResponsibilityInput[];
}

export interface ResponsibilitySet {
  readonly responsibilities: readonly ResponsibilityFact[];
}

function assertRecord(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeConcern(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("responsibility concern must be a string");
  }

  const normalized = value.normalize("NFC");
  if (normalized.trim().length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError("responsibility concern is malformed");
  }

  return normalized;
}

export function normalizeResponsibilityId(value: string): string {
  return normalizeIdentityId(value);
}

export function createResponsibilityId(value: string): ResponsibilityId {
  return normalizeResponsibilityId(value) as ResponsibilityId;
}

function createTarget(input: unknown): ResponsibilityTarget {
  assertRecord(input, "responsibility target");

  const candidate = input as {
    kind?: unknown;
    id?: unknown;
    displayName?: unknown;
  };
  if (candidate.kind !== "architecture" && candidate.kind !== "object") {
    throw new TypeError("responsibility target kind is invalid");
  }
  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    throw new TypeError("responsibility target displayName must be a string");
  }

  if (candidate.kind === "architecture") {
    return Object.freeze({
      kind: "architecture" as const,
      id: createArchitectureId(candidate.id as string),
    });
  }

  return Object.freeze({
    kind: "object" as const,
    id: createObjectId(candidate.id as string),
  });
}

export function createResponsibility(input: ResponsibilityInput): ResponsibilityFact {
  assertRecord(input, "responsibility");

  const candidate = input as {
    id?: unknown;
    target?: unknown;
    concern?: unknown;
    displayName?: unknown;
  };
  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    throw new TypeError("responsibility displayName must be a string");
  }

  return Object.freeze({
    kind: "responsibility" as const,
    id: createResponsibilityId(candidate.id as string),
    target: createTarget(candidate.target),
    concern: normalizeConcern(candidate.concern),
  });
}

function compareResponsibility(left: ResponsibilityFact, right: ResponsibilityFact): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function declarationKey(fact: ResponsibilityFact): string {
  return `${fact.target.kind}:${fact.target.id}\u0000${fact.concern}`;
}

export function createResponsibilitySet(input: ResponsibilitySetInput): ResponsibilitySet {
  assertRecord(input, "responsibility set");

  const candidate = input as { responsibilities?: unknown };
  if (candidate.responsibilities !== undefined && !Array.isArray(candidate.responsibilities)) {
    throw new TypeError("responsibility set responsibilities must be an array");
  }

  const responsibilities = (candidate.responsibilities ?? []).map((item) =>
    createResponsibility(item as ResponsibilityInput),
  );
  const ids = new Set<string>();
  const declarations = new Set<string>();
  for (const responsibility of responsibilities) {
    if (ids.has(responsibility.id)) {
      throw new Error(`duplicate responsibility id: ${responsibility.id}`);
    }
    ids.add(responsibility.id);

    const key = declarationKey(responsibility);
    if (declarations.has(key)) {
      throw new Error(
        `duplicate responsibility declaration: ${responsibility.target.kind}:${responsibility.target.id}`,
      );
    }
    declarations.add(key);
  }

  responsibilities.sort(compareResponsibility);
  return Object.freeze({ responsibilities: Object.freeze(responsibilities) });
}
