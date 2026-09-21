import type {
  CertificationEvidence,
  DesignChangeLifecycleState,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
} from "../contracts.js";
import type { Digest, JsonValue } from "../digest.js";
import { canonicalizeJson, digestJson } from "../digest.js";

/** The first event in a stream is linked to the proposal that created the stream. */
export const LIFECYCLE_EVENT_SEQUENCE_START = 0 as const;

export type LifecycleEventKind = "AMEND" | "REVIEW" | "IMPLEMENTATION" | "CERTIFICATION" | "TRANSITION";

/**
 * An event is immutable once recorded.  The event payload is deliberately
 * transport-neutral: repositories may store evidence inline or store a typed
 * reference which is resolved by an EvidencePort during replay.
 */
export interface DesignChangeEvent {
  readonly changeId: string;
  readonly sequence: number;
  readonly previousEventDigest: Digest;
  readonly recordedAt: string;
  readonly kind?: LifecycleEventKind | string;
  readonly type?: string;
  readonly event?: string;
  readonly payload?: JsonValue;
  readonly eventDigest: Digest;
}

export type DesignChangeEventInput = Omit<DesignChangeEvent, "eventDigest"> & {
  readonly eventDigest?: Digest;
};

export interface MachineTransitionContext {
  readonly changeId: string;
  readonly proposalDigest: Digest;
  readonly review?: DesignReviewEvidence;
  readonly implementations: readonly ImplementationLink[];
  readonly certification?: CertificationEvidence;
}

export interface MachineTransitionRequest {
  readonly state: DesignChangeLifecycleState;
  readonly event: DesignChangeEvent;
  readonly context: MachineTransitionContext;
}

export interface MachineTransitionResult {
  readonly state: DesignChangeLifecycleState;
}

/**
 * Adapter boundary for the lifecycle machine.  The runtime machine owns the
 * legal transition table; this module owns persistence/replay only.
 *
 * `transition` accepts the request object.  The implementation also accepts a
 * three-argument function at runtime so a small adapter can bridge an existing
 * machine without introducing a second transition authority.
 */
export interface MachinePort {
  readonly transition:
    | ((request: MachineTransitionRequest) => MachineTransitionResult | DesignChangeLifecycleState)
    | ((
        state: DesignChangeLifecycleState,
        event: DesignChangeEvent,
        context: MachineTransitionContext,
      ) => MachineTransitionResult | DesignChangeLifecycleState);
}

export interface LifecycleEvidencePort {
  readonly review?: (reference: string) => DesignReviewEvidence | undefined;
  readonly implementation?: (reference: string) => ImplementationLink | undefined;
  readonly certification?: (reference: string) => CertificationEvidence | undefined;
}

export interface LifecycleEvidenceSnapshot {
  readonly reviews?: Readonly<Record<string, DesignReviewEvidence>>;
  readonly implementations?: Readonly<Record<string, ImplementationLink>>;
  readonly certifications?: Readonly<Record<string, CertificationEvidence>>;
}

export interface LifecycleReplayOptions {
  readonly changeId: string;
  readonly initialProposalDigest: Digest;
  readonly events: readonly DesignChangeEvent[];
  readonly machine: MachinePort;
  readonly evidence?: LifecycleEvidencePort | LifecycleEvidenceSnapshot;
  readonly cached?: DesignIntentLifecycleRecord;
}

export interface LifecycleProjection extends DesignIntentLifecycleRecord {
  readonly initialProposalDigest: Digest;
  readonly lastEventDigest: Digest;
  /** All resolved evidence, including evidence made stale by a later AMEND. */
  readonly history: {
    readonly reviews: readonly DesignReviewEvidence[];
    readonly implementations: readonly ImplementationLink[];
    readonly certifications: readonly CertificationEvidence[];
  };
}

function invalid(message: string): never {
  throw new Error(`invalid Design Change event stream: ${message}`);
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) invalid(`${name} must be a non-empty string`);
}

function assertDigest(value: unknown, name: string): asserts value is Digest {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) invalid(`${name} must be a SHA-256 digest`);
}

function assertLifecycleState(value: unknown): asserts value is DesignChangeLifecycleState {
  if (
    value !== "draft" &&
    value !== "design-review" &&
    value !== "approved" &&
    value !== "implementing" &&
    value !== "certification-review" &&
    value !== "promoted"
  ) {
    invalid(`machine returned an unsupported state: ${String(value)}`);
  }
}

function payloadOf(event: DesignChangeEvent): Record<string, unknown> {
  if (event.payload === undefined) return {};
  if (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    invalid(`event ${event.sequence} payload must be an object`);
  }
  return event.payload as Record<string, unknown>;
}

function eventDigestInput(event: DesignChangeEventInput): Record<string, unknown> {
  const { eventDigest: _eventDigest, ...withoutDigest } = event;
  return withoutDigest;
}

/** Create an immutable event and compute its digest over every non-digest field. */
export function createDesignChangeEvent(input: DesignChangeEventInput): DesignChangeEvent {
  assertNonEmptyString(input.changeId, "event changeId");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < LIFECYCLE_EVENT_SEQUENCE_START) {
    invalid("event sequence must be a non-negative safe integer");
  }
  assertDigest(input.previousEventDigest, "event previousEventDigest");
  assertNonEmptyString(input.recordedAt, "event recordedAt");
  assertNonEmptyString(input.kind ?? input.type ?? input.event, "event kind");

  const eventDigest = digestJson(eventDigestInput(input));
  if (input.eventDigest !== undefined && input.eventDigest !== eventDigest) {
    invalid(`event ${input.sequence} digest does not match its content`);
  }

  return Object.freeze({ ...input, eventDigest });
}

/** Alias matching the append-only repository terminology. */
export const createLifecycleEvent = createDesignChangeEvent;

function resolveEvidence<T>(
  source: LifecycleEvidencePort | LifecycleEvidenceSnapshot | undefined,
  kind: "review" | "implementation" | "certification",
  reference: string,
): T | undefined {
  if (source === undefined) return undefined;
  const candidate = source as LifecycleEvidencePort & LifecycleEvidenceSnapshot;
  const resolver = candidate[kind];
  if (typeof resolver === "function") return resolver(reference) as T | undefined;
  return candidate[`${kind}s`]?.[reference] as T | undefined;
}

function referenceFrom(payload: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function inlineEvidence<T>(payload: Record<string, unknown>, ...names: string[]): T | undefined {
  for (const name of names) {
    const value = payload[name];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as T;
  }
  return undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

function checkEvidenceIdentity(
  changeId: string,
  proposalDigest: Digest,
  review: DesignReviewEvidence | undefined,
  implementations: readonly ImplementationLink[],
  certification: CertificationEvidence | undefined,
): void {
  if (review !== undefined && (review.changeId !== changeId || review.proposalDigest !== proposalDigest)) {
    invalid("review evidence is stale or belongs to another Change Set");
  }
  for (const implementation of implementations) {
    if (implementation.changeId !== changeId || implementation.changeDigest !== proposalDigest) {
      invalid("Implementation evidence is stale or belongs to another Change Set");
    }
  }
  if (
    certification !== undefined &&
    (certification.changeId !== changeId || certification.changeDigest !== proposalDigest)
  ) {
    invalid("certification evidence is stale or belongs to another Change Set");
  }
}

function machineState(result: MachineTransitionResult | DesignChangeLifecycleState): DesignChangeLifecycleState {
  const state = typeof result === "string" ? result : result?.state;
  assertLifecycleState(state);
  return state;
}

function transition(
  machine: MachinePort,
  state: DesignChangeLifecycleState,
  event: DesignChangeEvent,
  context: MachineTransitionContext,
): DesignChangeLifecycleState {
  if (machine === null || typeof machine !== "object" || typeof machine.transition !== "function") {
    invalid("MachinePort is required");
  }

  // Keep the call in one place so no caller can accidentally implement its own
  // lifecycle transition table while projecting a record. A three-argument
  // adapter is accepted for machines that already expose that shape.
  const result =
    machine.transition.length >= 2
      ? (
          machine.transition as (
            state: DesignChangeLifecycleState,
            event: DesignChangeEvent,
            context: MachineTransitionContext,
          ) => MachineTransitionResult | DesignChangeLifecycleState
        )(state, event, context)
      : (
          machine.transition as (
            request: MachineTransitionRequest,
          ) => MachineTransitionResult | DesignChangeLifecycleState
        )({ state, event, context });
  return machineState(result);
}

function eventType(event: DesignChangeEvent, payload: Record<string, unknown>): string {
  const candidate = payload.type ?? payload.event ?? payload.kind ?? event.type ?? event.event ?? event.kind;
  return typeof candidate === "string" ? candidate.toUpperCase().replaceAll("-", "_") : "";
}

function assertEventDigest(event: DesignChangeEvent): void {
  const recreated = digestJson(eventDigestInput(event));
  if (event.eventDigest !== recreated) invalid(`event ${event.sequence} digest does not match its content`);
}

function assertCachedProjection(cached: DesignIntentLifecycleRecord, projection: LifecycleProjection): void {
  const expected: DesignIntentLifecycleRecord = {
    changeId: projection.changeId,
    changeDigest: projection.changeDigest,
    state: projection.state,
    ...(projection.review === undefined ? {} : { review: projection.review }),
    implementations: projection.implementations,
    ...(projection.certification === undefined ? {} : { certification: projection.certification }),
  };
  if (!sameJson(cached, expected)) invalid("cached lifecycle state does not match replay");
}

/**
 * Replays one immutable event stream. Sequence and digest links are checked
 * before any event can affect the projection. Evidence is resolved by typed
 * reference and stale current evidence is rejected after AMEND.
 */
export function replayLifecycle(options: LifecycleReplayOptions): LifecycleProjection {
  assertNonEmptyString(options.changeId, "changeId");
  assertDigest(options.initialProposalDigest, "initialProposalDigest");
  if (!Array.isArray(options.events)) invalid("events must be an array");

  let expectedSequence = LIFECYCLE_EVENT_SEQUENCE_START;
  let previousDigest = options.initialProposalDigest;
  let proposalDigest = options.initialProposalDigest;
  let state: DesignChangeLifecycleState = "draft";
  let review: DesignReviewEvidence | undefined;
  let implementations: ImplementationLink[] = [];
  let certification: CertificationEvidence | undefined;
  const reviews: DesignReviewEvidence[] = [];
  const implementationHistory: ImplementationLink[] = [];
  const certifications: CertificationEvidence[] = [];

  for (const event of options.events) {
    if (event === null || typeof event !== "object") invalid("event must be an object");
    if (event.changeId !== options.changeId) invalid(`event ${event.sequence} belongs to another Change Set`);
    if (event.sequence !== expectedSequence) {
      invalid(`expected event sequence ${expectedSequence}, received ${String(event.sequence)}`);
    }
    if (event.previousEventDigest !== previousDigest) {
      invalid(`event ${event.sequence} previous digest does not match the chain`);
    }
    assertEventDigest(event);

    const payload = payloadOf(event);
    const type = eventType(event, payload);
    if (type === "AMEND") {
      const amendedDigest = payload.proposalDigest ?? payload.changeDigest;
      assertDigest(amendedDigest, `event ${event.sequence} proposalDigest`);
      proposalDigest = amendedDigest;
      // History remains available below, but no evidence from the old
      // proposal can satisfy guards for the amended proposal.
      review = undefined;
      implementations = [];
      certification = undefined;
    }

    const reviewValue =
      inlineEvidence<DesignReviewEvidence>(payload, "review", "evidence") ??
      (referenceFrom(payload, "reviewId", "reviewReference") === undefined
        ? undefined
        : resolveEvidence<DesignReviewEvidence>(
            options.evidence,
            "review",
            referenceFrom(payload, "reviewId", "reviewReference")!,
          ));
    const implementationValue =
      inlineEvidence<ImplementationLink>(payload, "implementation", "link") ??
      (referenceFrom(payload, "implementationId", "implementationReference", "linkId") === undefined
        ? undefined
        : resolveEvidence<ImplementationLink>(
            options.evidence,
            "implementation",
            referenceFrom(payload, "implementationId", "implementationReference", "linkId")!,
          ));
    const certificationValue =
      inlineEvidence<CertificationEvidence>(payload, "certification", "evidence") ??
      (referenceFrom(payload, "certificationId", "certificationReference") === undefined
        ? undefined
        : resolveEvidence<CertificationEvidence>(
            options.evidence,
            "certification",
            referenceFrom(payload, "certificationId", "certificationReference")!,
          ));

    const hasReviewShape = reviewValue !== undefined && typeof reviewValue === "object" && "reviewId" in reviewValue;
    const hasImplementationShape =
      implementationValue !== undefined && typeof implementationValue === "object" && "linkId" in implementationValue;
    const hasCertificationShape =
      certificationValue !== undefined &&
      typeof certificationValue === "object" &&
      "certificationId" in certificationValue;
    if (type === "REVIEW" || type === "DESIGN_REVIEW" || hasReviewShape) {
      if (!hasReviewShape) invalid(`event ${event.sequence} does not resolve review evidence`);
      review = reviewValue;
      reviews.push(reviewValue);
    }
    if (type === "IMPLEMENTATION" || type === "IMPLEMENTATION_LINK" || type === "LINK" || hasImplementationShape) {
      if (!hasImplementationShape) invalid(`event ${event.sequence} does not resolve Implementation evidence`);
      implementations = [...implementations, implementationValue];
      implementationHistory.push(implementationValue);
    }
    if (type === "CERTIFICATION" || type === "CERTIFICATION_REVIEW" || hasCertificationShape) {
      if (!hasCertificationShape) invalid(`event ${event.sequence} does not resolve certification evidence`);
      certification = certificationValue;
      certifications.push(certificationValue);
    }

    checkEvidenceIdentity(options.changeId, proposalDigest, review, implementations, certification);
    state = transition(options.machine, state, event, {
      changeId: options.changeId,
      proposalDigest,
      ...(review === undefined ? {} : { review }),
      implementations,
      ...(certification === undefined ? {} : { certification }),
    });

    previousDigest = event.eventDigest;
    expectedSequence += 1;
  }

  const record: DesignIntentLifecycleRecord = {
    changeId: options.changeId,
    changeDigest: proposalDigest,
    state,
    ...(review === undefined ? {} : { review }),
    implementations,
    ...(certification === undefined ? {} : { certification }),
  };
  const projection: LifecycleProjection = {
    ...record,
    initialProposalDigest: options.initialProposalDigest,
    lastEventDigest: previousDigest,
    history: {
      reviews,
      implementations: implementationHistory,
      certifications,
    },
  };
  if (options.cached !== undefined) assertCachedProjection(options.cached, projection);
  return Object.freeze(projection);
}

/** Short alias used by repository adapters. */
export const replayDesignChange = replayLifecycle;
export const projectLifecycle = replayLifecycle;

/**
 * Append one event after validating its position against the existing stream.
 * The returned array is a new immutable view; existing event objects are never
 * rewritten.
 */
export function appendLifecycleEvent(
  events: readonly DesignChangeEvent[],
  input: Omit<DesignChangeEventInput, "sequence" | "previousEventDigest"> & {
    readonly initialProposalDigest: Digest;
  },
): readonly DesignChangeEvent[] {
  assertDigest(input.initialProposalDigest, "initialProposalDigest");
  const previousEvent = events[events.length - 1];
  const sequence = previousEvent === undefined ? LIFECYCLE_EVENT_SEQUENCE_START : previousEvent.sequence + 1;
  const previousEventDigest = previousEvent?.eventDigest ?? input.initialProposalDigest;
  const { initialProposalDigest: _initialProposalDigest, ...eventInput } = input;
  const event = createDesignChangeEvent({ ...eventInput, sequence, previousEventDigest });
  return Object.freeze([...events, event]);
}

export const recordLifecycleEvent = appendLifecycleEvent;
