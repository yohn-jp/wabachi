import { normalizeIdentityId } from "./identity.js";
import type {
  CodeIntent,
  CodeIntentStatement,
  CodeIntentVerificationObligation,
  CodeIntentContract,
} from "./code-intent-contract.js";

/** Verification modes understood by the Canon Code Intent leaf. */
export const CODE_INTENT_VERIFICATION_MODES = ["machine", "review"] as const;

export type CodeIntentVerificationMode = (typeof CODE_INTENT_VERIFICATION_MODES)[number];

export interface CodeIntentInput {
  readonly id: string;
  readonly ownerId: string;
  readonly responsibilityIds?: readonly string[];
  readonly decisionIds?: readonly string[];
  readonly invariants?: readonly CodeIntentStatementInput[];
  readonly prohibitions?: readonly CodeIntentStatementInput[];
  readonly verificationObligations?: readonly CodeIntentVerificationObligationInput[];
}

export interface CodeIntentStatementInput {
  readonly id: string;
  readonly text: string;
}

export interface CodeIntentVerificationObligationInput {
  readonly id: string;
  readonly statementId: string;
  readonly mode: string;
  readonly predicate: string;
}

export interface CodeIntentContractInput {
  readonly entries?: readonly CodeIntentInput[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new TypeError(`${label} has unsupported field: ${key}`);
  }
}

function normalizeId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  try {
    return normalizeIdentityId(value);
  } catch {
    throw new TypeError(`${label} is malformed`);
  }
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC");
  if (normalized.trim().length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeIdSet(values: unknown, label: string): readonly string[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const normalized = values.map((value) => normalizeId(value, label)).sort(compareStrings);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1] === normalized[index]) {
      throw new Error(`duplicate ${label}: ${normalized[index]}`);
    }
  }
  return Object.freeze(normalized);
}

function normalizeStatement(value: unknown, label: string): CodeIntentStatement {
  assertRecord(value, label);
  rejectUnknownFields(value, ["id", "text"], label);
  return Object.freeze({
    id: normalizeId(value.id, `${label} id`),
    text: normalizeText(value.text, `${label} text`),
  });
}

function normalizeStatements(values: unknown, label: string): readonly CodeIntentStatement[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  // Statement order is semantic. Do not sort or deduplicate this collection.
  return Object.freeze(values.map((value, index) => normalizeStatement(value, `${label}[${index}]`)));
}

function normalizeMode(value: unknown, label: string): CodeIntentVerificationMode {
  if (typeof value !== "string" || !(CODE_INTENT_VERIFICATION_MODES as readonly string[]).includes(value)) {
    throw new TypeError(`${label} is unsupported: ${String(value)}`);
  }
  return value as CodeIntentVerificationMode;
}

function normalizeObligation(value: unknown, label: string): CodeIntentVerificationObligation {
  assertRecord(value, label);
  rejectUnknownFields(value, ["id", "statementId", "mode", "predicate"], label);
  return Object.freeze({
    id: normalizeId(value.id, `${label} id`),
    statementId: normalizeId(value.statementId, `${label} statementId`),
    mode: normalizeMode(value.mode, `${label} mode`),
    predicate: normalizeText(value.predicate, `${label} predicate`),
  });
}

function compareObligations(left: CodeIntentVerificationObligation, right: CodeIntentVerificationObligation): number {
  return (
    compareStrings(left.id, right.id) ||
    compareStrings(left.statementId, right.statementId) ||
    compareStrings(left.mode, right.mode) ||
    compareStrings(left.predicate, right.predicate)
  );
}

function normalizeObligations(
  values: unknown,
  statements: readonly CodeIntentStatement[],
  label: string,
): readonly CodeIntentVerificationObligation[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const obligations = values
    .map((value, index) => normalizeObligation(value, `${label}[${index}]`))
    .sort(compareObligations);
  const statementIds = new Set(statements.map((statement) => statement.id));
  const obligationIds = new Set<string>();
  for (const obligation of obligations) {
    if (obligationIds.has(obligation.id)) throw new Error(`duplicate verification obligation id: ${obligation.id}`);
    obligationIds.add(obligation.id);
    if (!statementIds.has(obligation.statementId)) {
      throw new Error(`verification obligation references unknown statement: ${obligation.statementId}`);
    }
  }
  return Object.freeze(obligations);
}

/** Normalize one Canon-owned source-level intent without resolving Canon references. */
export function createCodeIntent(input: CodeIntentInput): CodeIntent {
  assertRecord(input, "code intent");
  rejectUnknownFields(
    input,
    ["id", "ownerId", "responsibilityIds", "decisionIds", "invariants", "prohibitions", "verificationObligations"],
    "code intent",
  );

  const invariants = normalizeStatements(input.invariants ?? [], "code intent invariants");
  const prohibitions = normalizeStatements(input.prohibitions ?? [], "code intent prohibitions");
  const statements = [...invariants, ...prohibitions];
  const statementIds = new Set<string>();
  for (const statement of statements) {
    if (statementIds.has(statement.id)) throw new Error(`duplicate code intent statement id: ${statement.id}`);
    statementIds.add(statement.id);
  }

  return Object.freeze({
    id: normalizeId(input.id, "code intent id"),
    ownerId: normalizeId(input.ownerId, "code intent ownerId"),
    responsibilityIds: normalizeIdSet(input.responsibilityIds ?? [], "code intent responsibility id"),
    decisionIds: normalizeIdSet(input.decisionIds ?? [], "code intent decision id"),
    invariants,
    prohibitions,
    verificationObligations: normalizeObligations(
      input.verificationObligations ?? [],
      statements,
      "code intent verification obligations",
    ),
  });
}

function compareIntents(left: CodeIntent, right: CodeIntent): number {
  return compareStrings(left.id, right.id);
}

/** Normalize a collection of intents in stable identity order. */
export function createCodeIntents(inputs: readonly CodeIntentInput[]): readonly CodeIntent[] {
  if (!Array.isArray(inputs)) throw new TypeError("code intents must be an array");
  const intents = inputs.map(createCodeIntent).sort(compareIntents);
  const ids = new Set<string>();
  for (const intent of intents) {
    if (ids.has(intent.id)) throw new Error(`duplicate code intent id: ${intent.id}`);
    ids.add(intent.id);
  }
  return Object.freeze(intents);
}

/** Normalize the transport contract that embeds Code Intent entries. */
export function createCodeIntentContract(
  input: CodeIntentContractInput | CodeIntentContract | readonly CodeIntentInput[] = {},
): CodeIntentContract {
  const entries = Array.isArray(input) ? input : ((input as CodeIntentContractInput).entries ?? []);
  if (!Array.isArray(entries)) throw new TypeError("code intent entries must be an array");
  return Object.freeze({ entries: createCodeIntents(entries) });
}

/** Canonical JSON serialization of a Code Intent contract. */
export function serializeCodeIntentContract(
  input: CodeIntentContractInput | CodeIntentContract | readonly CodeIntentInput[],
): string {
  return JSON.stringify(createCodeIntentContract(input));
}

export const normalizeCodeIntent = createCodeIntent;
export const normalizeCodeIntents = createCodeIntents;
export const normalizeCodeIntentContract = createCodeIntentContract;
export const serializeCodeIntents = serializeCodeIntentContract;
