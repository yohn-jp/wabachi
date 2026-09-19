import { createObjectId, type ObjectId } from "./identity.js";

/** The deliberately small set of declarative architecture constraints. */
export const CONSTRAINT_KINDS = [
  "may-depend-on",
  "must-not-depend-on",
  "may-call",
  "must-go-through",
  "single-authority",
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export interface MayDependOnConstraint {
  readonly kind: "may-depend-on";
  readonly source: ObjectId;
  readonly target: ObjectId;
}

export interface MustNotDependOnConstraint {
  readonly kind: "must-not-depend-on";
  readonly source: ObjectId;
  readonly target: ObjectId;
}

export interface MayCallConstraint {
  readonly kind: "may-call";
  readonly source: ObjectId;
  readonly target: ObjectId;
}

export interface MustGoThroughConstraint {
  readonly kind: "must-go-through";
  readonly source: ObjectId;
  readonly target: ObjectId;
  readonly through: ObjectId;
}

export interface SingleAuthorityConstraint {
  readonly kind: "single-authority";
  readonly concern: ObjectId;
}

export type ArchitectureConstraint =
  | MayDependOnConstraint
  | MustNotDependOnConstraint
  | MayCallConstraint
  | MustGoThroughConstraint
  | SingleAuthorityConstraint;

export interface MayDependOnConstraintInput {
  readonly kind: "may-depend-on";
  readonly source: string;
  readonly target: string;
}

export interface MustNotDependOnConstraintInput {
  readonly kind: "must-not-depend-on";
  readonly source: string;
  readonly target: string;
}

export interface MayCallConstraintInput {
  readonly kind: "may-call";
  readonly source: string;
  readonly target: string;
}

export interface MustGoThroughConstraintInput {
  readonly kind: "must-go-through";
  readonly source: string;
  readonly target: string;
  readonly through: string;
}

export interface SingleAuthorityConstraintInput {
  readonly kind: "single-authority";
  readonly concern: string;
}

export type ArchitectureConstraintInput =
  | MayDependOnConstraintInput
  | MustNotDependOnConstraintInput
  | MayCallConstraintInput
  | MustGoThroughConstraintInput
  | SingleAuthorityConstraintInput;

function assertRecord(input: unknown, label: string): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function readObjectId(record: Record<string, unknown>, field: string, label: string): ObjectId {
  const value = record[field];
  if (typeof value !== "string") {
    throw new TypeError(`${label} ${field} must be a string`);
  }
  return createObjectId(value);
}

function isConstraintKind(value: unknown): value is ConstraintKind {
  return typeof value === "string" && (CONSTRAINT_KINDS as readonly string[]).includes(value);
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareConstraints(left: ArchitectureConstraint, right: ArchitectureConstraint): number {
  const kindOrder = compareIds(left.kind, right.kind);
  if (kindOrder !== 0) return kindOrder;

  switch (left.kind) {
    case "single-authority":
      return compareIds(left.concern, (right as SingleAuthorityConstraint).concern);
    case "must-go-through": {
      const rightConstraint = right as MustGoThroughConstraint;
      return (
        compareIds(left.source, rightConstraint.source) ||
        compareIds(left.target, rightConstraint.target) ||
        compareIds(left.through, rightConstraint.through)
      );
    }
    default: {
      const rightConstraint = right as MayDependOnConstraint | MustNotDependOnConstraint | MayCallConstraint;
      return compareIds(left.source, rightConstraint.source) || compareIds(left.target, rightConstraint.target);
    }
  }
}

function constraintKey(constraint: ArchitectureConstraint): string {
  switch (constraint.kind) {
    case "single-authority":
      return `${constraint.kind}\u0000${constraint.concern}`;
    case "must-go-through":
      return `${constraint.kind}\u0000${constraint.source}\u0000${constraint.target}\u0000${constraint.through}`;
    default:
      return `${constraint.kind}\u0000${constraint.source}\u0000${constraint.target}`;
  }
}

/** Create one typed, stable-ID constraint declaration without evaluating it. */
export function createConstraint(input: ArchitectureConstraintInput): ArchitectureConstraint {
  assertRecord(input, "constraint");

  if (!isConstraintKind(input.kind)) {
    throw new TypeError(`constraint kind is unsupported: ${String(input.kind)}`);
  }

  switch (input.kind) {
    case "may-depend-on":
      return Object.freeze({
        kind: input.kind,
        source: readObjectId(input, "source", "may-depend-on constraint"),
        target: readObjectId(input, "target", "may-depend-on constraint"),
      });
    case "must-not-depend-on":
      return Object.freeze({
        kind: input.kind,
        source: readObjectId(input, "source", "must-not-depend-on constraint"),
        target: readObjectId(input, "target", "must-not-depend-on constraint"),
      });
    case "may-call":
      return Object.freeze({
        kind: input.kind,
        source: readObjectId(input, "source", "may-call constraint"),
        target: readObjectId(input, "target", "may-call constraint"),
      });
    case "must-go-through":
      return Object.freeze({
        kind: input.kind,
        source: readObjectId(input, "source", "must-go-through constraint"),
        target: readObjectId(input, "target", "must-go-through constraint"),
        through: readObjectId(input, "through", "must-go-through constraint"),
      });
    case "single-authority":
      return Object.freeze({
        kind: input.kind,
        concern: readObjectId(input, "concern", "single-authority constraint"),
      });
  }
}

/** Normalize declarative constraints into a frozen, deterministic set. */
export function createConstraints(inputs: readonly ArchitectureConstraintInput[]): readonly ArchitectureConstraint[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("constraints must be an array");
  }

  const constraints = inputs.map(createConstraint).sort(compareConstraints);
  const seen = new Set<string>();
  for (const constraint of constraints) {
    const key = constraintKey(constraint);
    if (seen.has(key)) {
      throw new Error(`duplicate constraint: ${key.replaceAll("\u0000", " -> ")}`);
    }
    seen.add(key);
  }

  return Object.freeze(constraints);
}
