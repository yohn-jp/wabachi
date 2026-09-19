import { normalizeIdentityId } from "./identity.js";

const DECISION_STATUSES = ["proposed", "accepted", "rejected", "superseded"] as const;
const DECISION_TYPES = ["architecture", "constraint", "policy"] as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type DecisionType = (typeof DECISION_TYPES)[number];

export interface ArchitectureReferenceInput {
  readonly id: string;
  readonly label: string;
  readonly uri: string;
  readonly description?: string;
}

export interface ArchitectureReference {
  readonly id: string;
  readonly label: string;
  readonly uri: string;
  readonly description?: string;
}

export interface ArchitectureDecisionInput {
  readonly id: string;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly type: DecisionType;
  readonly rationale: string;
  readonly targetIds?: readonly string[];
  readonly referenceIds?: readonly string[];
  readonly supersedes?: readonly string[];
}

export interface ArchitectureDecision {
  readonly id: string;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly type: DecisionType;
  readonly rationale: string;
  /** Canon IDs are intentionally opaque until complete-document validation. */
  readonly targetIds: readonly string[];
  readonly referenceIds: readonly string[];
  readonly supersedes: readonly string[];
}

export interface ArchitectureReferenceAttachmentInput {
  /** The target may be a canonical object or a document ID. Its existence is not checked here. */
  readonly targetId: string;
  readonly referenceIds: readonly string[];
}

export interface ArchitectureReferenceAttachment {
  readonly targetId: string;
  readonly referenceIds: readonly string[];
}

export interface ArchitectureDecisionsInput {
  readonly decisions?: readonly ArchitectureDecisionInput[];
  readonly references?: readonly ArchitectureReferenceInput[];
  readonly referenceAttachments?: readonly ArchitectureReferenceAttachmentInput[];
}

export interface ArchitectureDecisions {
  readonly decisions: readonly ArchitectureDecision[];
  readonly references: readonly ArchitectureReference[];
  readonly referenceAttachments: readonly ArchitectureReferenceAttachment[];
}

function normalizeText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.normalize("NFC");
  if ((!allowEmpty && normalized.trim().length === 0) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }

  return normalized;
}

function normalizeCanonId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  try {
    return normalizeIdentityId(value);
  } catch {
    throw new TypeError(`${label} is malformed`);
  }
}

function compareCanonical(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortStrings(values: readonly string[]): readonly string[] {
  return [...values].sort(compareCanonical);
}

function uniqueSortedIds(values: readonly unknown[], label: string): readonly string[] {
  const normalized = values.map((value) => normalizeCanonId(value, label));
  const result = sortStrings(normalized);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) {
      throw new Error(`duplicate ${label}: ${result[index]}`);
    }
  }
  return Object.freeze(result);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
}

function normalizeStatus(value: unknown): DecisionStatus {
  if (typeof value !== "string" || !(DECISION_STATUSES as readonly string[]).includes(value)) {
    throw new TypeError(`decision status must be one of: ${DECISION_STATUSES.join(", ")}`);
  }
  return value as DecisionStatus;
}

function normalizeType(value: unknown): DecisionType {
  if (typeof value !== "string" || !(DECISION_TYPES as readonly string[]).includes(value)) {
    throw new TypeError(`decision type must be one of: ${DECISION_TYPES.join(", ")}`);
  }
  return value as DecisionType;
}

function normalizeReference(input: unknown): ArchitectureReference {
  assertRecord(input, "reference");
  const description =
    input.description === undefined ? undefined : normalizeText(input.description, "reference description", true);

  return Object.freeze({
    id: normalizeCanonId(input.id, "reference id"),
    label: normalizeText(input.label, "reference label"),
    uri: normalizeText(input.uri, "reference uri"),
    ...(description === undefined ? {} : { description }),
  });
}

function normalizeDecision(input: unknown): ArchitectureDecision {
  assertRecord(input, "decision");
  const targets = input.targetIds === undefined ? [] : input.targetIds;
  const references = input.referenceIds === undefined ? [] : input.referenceIds;
  const supersedes = input.supersedes === undefined ? [] : input.supersedes;
  assertStringArray(targets, "decision targetIds");
  assertStringArray(references, "decision referenceIds");
  assertStringArray(supersedes, "decision supersedes");

  return Object.freeze({
    id: normalizeCanonId(input.id, "decision id"),
    title: normalizeText(input.title, "decision title"),
    status: normalizeStatus(input.status),
    type: normalizeType(input.type),
    rationale: normalizeText(input.rationale, "decision rationale"),
    targetIds: uniqueSortedIds(targets, "decision target id"),
    referenceIds: uniqueSortedIds(references, "decision reference id"),
    supersedes: uniqueSortedIds(supersedes, "superseded decision id"),
  });
}

function normalizeAttachment(input: unknown): ArchitectureReferenceAttachment {
  assertRecord(input, "reference attachment");
  const references = input.referenceIds;
  assertStringArray(references, "reference attachment referenceIds");

  return Object.freeze({
    targetId: normalizeCanonId(input.targetId, "reference attachment target id"),
    referenceIds: uniqueSortedIds(references, "reference attachment reference id"),
  });
}

function assertUniqueIds<T extends { readonly id: string }>(records: readonly T[], label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`duplicate ${label}: ${record.id}`);
    }
    seen.add(record.id);
  }
}

function assertKnownReferences(
  decisions: readonly ArchitectureDecision[],
  references: readonly ArchitectureReference[],
  attachments: readonly ArchitectureReferenceAttachment[],
): void {
  const referenceIds = new Set(references.map((reference) => reference.id));
  for (const decision of decisions) {
    for (const referenceId of decision.referenceIds) {
      if (!referenceIds.has(referenceId)) {
        throw new Error(`decision ${decision.id} references unknown reference: ${referenceId}`);
      }
    }
  }
  for (const attachment of attachments) {
    for (const referenceId of attachment.referenceIds) {
      if (!referenceIds.has(referenceId)) {
        throw new Error(`reference attachment for ${attachment.targetId} references unknown reference: ${referenceId}`);
      }
    }
  }
}

function assertAcyclicSupersession(decisions: readonly ArchitectureDecision[]): void {
  const decisionIds = new Set(decisions.map((decision) => decision.id));
  const graph = new Map(decisions.map((decision) => [decision.id, decision.supersedes]));
  for (const decision of decisions) {
    for (const supersededId of decision.supersedes) {
      if (!decisionIds.has(supersededId)) {
        throw new Error(`decision ${decision.id} supersedes unknown decision: ${supersededId}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (decisionId: string): void => {
    if (visiting.has(decisionId)) {
      throw new Error(`decision supersession cycle includes: ${decisionId}`);
    }
    if (visited.has(decisionId)) return;

    visiting.add(decisionId);
    for (const supersededId of graph.get(decisionId) ?? []) visit(supersededId);
    visiting.delete(decisionId);
    visited.add(decisionId);
  };

  for (const decision of decisions) visit(decision.id);
}

/**
 * Creates deterministic governance metadata for architecture decisions.
 * Target IDs are normalized but deliberately not resolved against a canon document.
 */
export function createArchitectureDecisions(input: ArchitectureDecisionsInput = {}): ArchitectureDecisions {
  assertRecord(input, "architecture decisions");
  const rawDecisions = input.decisions === undefined ? [] : input.decisions;
  const rawReferences = input.references === undefined ? [] : input.references;
  const rawAttachments = input.referenceAttachments === undefined ? [] : input.referenceAttachments;
  assertStringArray(rawDecisions, "decisions");
  assertStringArray(rawReferences, "references");
  assertStringArray(rawAttachments, "referenceAttachments");

  const decisions = [...rawDecisions].map(normalizeDecision).sort((left, right) => compareCanonical(left.id, right.id));
  const references = [...rawReferences]
    .map(normalizeReference)
    .sort((left, right) => compareCanonical(left.id, right.id));
  const referenceAttachments = [...rawAttachments]
    .map(normalizeAttachment)
    .sort((left, right) => compareCanonical(left.targetId, right.targetId));

  assertUniqueIds(decisions, "decision id");
  assertUniqueIds(references, "reference id");
  for (let index = 1; index < referenceAttachments.length; index += 1) {
    if (referenceAttachments[index].targetId === referenceAttachments[index - 1].targetId) {
      throw new Error(`duplicate reference attachment target id: ${referenceAttachments[index].targetId}`);
    }
  }
  assertKnownReferences(decisions, references, referenceAttachments);
  assertAcyclicSupersession(decisions);

  return Object.freeze({
    decisions: Object.freeze(decisions),
    references: Object.freeze(references),
    referenceAttachments: Object.freeze(referenceAttachments),
  });
}
