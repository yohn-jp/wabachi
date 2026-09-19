import { normalizeIdentityId } from "./identity.js";

declare const flowIdBrand: unique symbol;

export type FlowId = string & { readonly [flowIdBrand]: never };

export interface FlowStepInput {
  /** An opaque canonical relationship identity resolved by complete-document validation. */
  readonly relationshipId?: string;
  /** An opaque canonical interface identity resolved by complete-document validation. */
  readonly interfaceId?: string;
  readonly operation?: string;
  readonly information?: string;
}

export interface FlowStep {
  readonly relationshipId?: string;
  readonly interfaceId?: string;
  readonly operation?: string;
  readonly information?: string;
}

export interface FlowInput {
  readonly id: string;
  readonly steps: readonly FlowStepInput[];
}

export interface Flow {
  readonly id: FlowId;
  /** Step order is semantic and is intentionally never sorted. */
  readonly steps: readonly FlowStep[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  try {
    return normalizeIdentityId(value);
  } catch {
    throw new TypeError(`${label} is malformed`);
  }
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.normalize("NFC");
  if (normalized.trim().length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeFlowStep(input: unknown): FlowStep {
  assertRecord(input, "flow step");
  const relationshipId =
    input.relationshipId === undefined ? undefined : normalizeId(input.relationshipId, "flow step relationshipId");
  const interfaceId =
    input.interfaceId === undefined ? undefined : normalizeId(input.interfaceId, "flow step interfaceId");
  if (relationshipId === undefined && interfaceId === undefined) {
    throw new TypeError("flow step must reference a relationship or interface");
  }

  const operation = input.operation === undefined ? undefined : normalizeText(input.operation, "flow step operation");
  const information =
    input.information === undefined ? undefined : normalizeText(input.information, "flow step information");

  return Object.freeze({
    ...(relationshipId === undefined ? {} : { relationshipId }),
    ...(interfaceId === undefined ? {} : { interfaceId }),
    ...(operation === undefined ? {} : { operation }),
    ...(information === undefined ? {} : { information }),
  });
}

export function createFlow(input: FlowInput): Flow {
  assertRecord(input, "flow");
  const id = normalizeId(input.id, "flow id") as FlowId;
  if (!Array.isArray(input.steps)) {
    throw new TypeError("flow steps must be an array");
  }

  const steps = input.steps.map(normalizeFlowStep);
  return Object.freeze({ id, steps: Object.freeze(steps) });
}

/**
 * Creates a deterministic flow collection. Flow identity order is canonical;
 * step order remains exactly the declared semantic sequence.
 *
 * Relationship and interface references are intentionally opaque here. Their
 * existence is checked only by complete-document validation.
 */
export function createFlows(inputs: readonly FlowInput[]): readonly Flow[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("flows must be an array");
  }

  const flows = inputs.map(createFlow);
  const seen = new Set<string>();
  for (const flow of flows) {
    if (seen.has(flow.id)) {
      throw new Error(`duplicate flow id: ${flow.id}`);
    }
    seen.add(flow.id);
  }

  flows.sort((left, right) => compareOrdinal(left.id, right.id));
  return Object.freeze(flows);
}
