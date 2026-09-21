import { createActor } from "xstate";

import { decodeDesignChangeSet } from "./change/codec.js";
import { architectureCanonDigest, createDesignChangeSet, type DesignChangeAuthoringInput } from "./change/diff.js";
import { digestJson } from "./digest.js";
import type {
  CanonRevisionReference,
  CertificationEvidence,
  DesignChangeLifecycleState,
  DesignChangeSet,
  DesignChangeSetPayload,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
} from "./contracts.js";
import type { DesignIntentPorts } from "./ports.js";
import {
  createDesignChangeLifecycleMachine,
  type DesignChangeLifecycleEvent,
  type DesignChangeLifecycleFacts,
} from "./lifecycle/machine.js";

/** Inputs accepted by the application boundary when authoring a new proposal. */
export type DesignChangeCreateInput = DesignChangeSet | DesignChangeSetPayload | DesignChangeAuthoringInput;

/** Inputs accepted when amending the current proposal for a Change Set. */
export type DesignChangeAmendInput = DesignChangeSetPayload | DesignChangeAuthoringInput;

export type DesignApplicationErrorCode =
  | "change-not-found"
  | "change-already-exists"
  | "invalid-change"
  | "stale-canon"
  | "stale-lifecycle"
  | "stale-evidence"
  | "invalid-evidence"
  | "illegal-transition"
  | "duplicate-evidence"
  | "unsupported-operation";

/** Errors are stable at the application boundary so adapters need not inspect provider errors. */
export class DesignApplicationError extends Error {
  readonly code: DesignApplicationErrorCode;

  constructor(code: DesignApplicationErrorCode, message: string) {
    super(message);
    this.name = "DesignApplicationError";
    this.code = code;
  }
}

interface ResolvedFacts {
  readonly change: DesignChangeSet;
  readonly lifecycle: DesignIntentLifecycleRecord | undefined;
  readonly state: DesignChangeLifecycleState;
  readonly review?: DesignReviewEvidence;
  readonly implementations: readonly ImplementationLink[];
  readonly certification?: CertificationEvidence;
}

interface CanonRead {
  readonly revision: CanonRevisionReference;
  readonly document: Parameters<DesignIntentPorts["changes"]["apply"]>[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) {
    throw new DesignApplicationError("invalid-change", `${label} must be a non-empty text value`);
  }
  return value;
}

function payloadOf(change: DesignChangeSet): DesignChangeSetPayload {
  const { digest: _digest, ...payload } = change;
  return payload;
}

function isAuthoringInput(
  value: DesignChangeCreateInput | DesignChangeAmendInput,
): value is DesignChangeAuthoringInput {
  return isRecord(value) && "baseCanon" in value && "targetCanon" in value;
}

function inputChangeId(value: DesignChangeCreateInput | DesignChangeAmendInput): string {
  if (!isRecord(value)) throw new DesignApplicationError("invalid-change", "Design Change input must be an object");
  const changeId = text(value.changeId, "changeId");
  if (/\s/u.test(changeId)) {
    throw new DesignApplicationError("invalid-change", "changeId must not contain whitespace");
  }
  return changeId;
}

function assertReview(evidence: DesignReviewEvidence, change: DesignChangeSet): void {
  if (!isRecord(evidence)) throw new DesignApplicationError("invalid-evidence", "review evidence must be an object");
  if (evidence.changeId !== change.changeId || evidence.proposalDigest !== change.digest) {
    throw new DesignApplicationError(
      "stale-evidence",
      `review ${evidence.reviewId} is not bound to the current proposal`,
    );
  }
  text(evidence.reviewId, "reviewId");
  text(evidence.proposalRevision, "proposalRevision");
  text(evidence.actor, "actor");
  text(evidence.reason, "reason");
  text(evidence.timestamp, "timestamp");
  if (
    evidence.decision !== "approved" &&
    evidence.decision !== "changes-requested" &&
    evidence.decision !== "rejected"
  ) {
    throw new DesignApplicationError("invalid-evidence", `review ${evidence.reviewId} has an unsupported decision`);
  }
}

function assertLink(link: ImplementationLink, change: DesignChangeSet): void {
  if (!isRecord(link)) throw new DesignApplicationError("invalid-evidence", "implementation link must be an object");
  if (link.changeId !== change.changeId || link.changeDigest !== change.digest) {
    throw new DesignApplicationError("stale-evidence", `implementation link ${link.linkId} is not current`);
  }
  text(link.linkId, "linkId");
  if (!Array.isArray(link.targetEntryKeys) || link.targetEntryKeys.length === 0) {
    throw new DesignApplicationError("invalid-evidence", `implementation link ${link.linkId} has no targets`);
  }
}

function assertCertification(evidence: CertificationEvidence, change: DesignChangeSet): void {
  if (!isRecord(evidence)) {
    throw new DesignApplicationError("invalid-evidence", "certification evidence must be an object");
  }
  if (evidence.changeId !== change.changeId || evidence.changeDigest !== change.digest) {
    throw new DesignApplicationError(
      "stale-evidence",
      `certification ${evidence.certificationId} is not bound to the current proposal`,
    );
  }
  text(evidence.certificationId, "certificationId");
  text(evidence.implementationRevision.repository, "implementationRevision.repository");
  text(evidence.implementationRevision.revision, "implementationRevision.revision");
  text(evidence.recordedAt, "recordedAt");
  if (evidence.result !== "match" && evidence.result !== "mismatch" && evidence.result !== "unresolved") {
    throw new DesignApplicationError(
      "invalid-evidence",
      `certification ${evidence.certificationId} has an invalid result`,
    );
  }
  if (!Array.isArray(evidence.checks) || evidence.checks.length === 0) {
    throw new DesignApplicationError("invalid-evidence", `certification ${evidence.certificationId} has no checks`);
  }
  const ids = new Set<string>();
  for (const check of evidence.checks) {
    text(check.checkId, "certification checkId");
    if (check.result !== "match" && check.result !== "mismatch" && check.result !== "unresolved") {
      throw new DesignApplicationError(
        "invalid-evidence",
        `certification check ${check.checkId} has an invalid result`,
      );
    }
    if (ids.has(check.checkId)) {
      throw new DesignApplicationError("invalid-evidence", `duplicate certification check ${check.checkId}`);
    }
    ids.add(check.checkId);
  }
}

function sameRevision(left: CanonRevisionReference, right: CanonRevisionReference): boolean {
  return (
    left.repositoryRevision === right.repositoryRevision &&
    left.canonVersion === right.canonVersion &&
    left.canonDigest === right.canonDigest
  );
}

function recordFor(
  facts: Pick<ResolvedFacts, "change" | "review" | "implementations" | "certification">,
  state: DesignChangeLifecycleState,
): DesignIntentLifecycleRecord {
  return {
    changeId: facts.change.changeId,
    changeDigest: facts.change.digest,
    state,
    ...(facts.review === undefined ? {} : { review: facts.review }),
    implementations: facts.implementations,
    ...(facts.certification === undefined ? {} : { certification: facts.certification }),
  };
}

function lifecycleFacts(facts: ResolvedFacts): DesignChangeLifecycleFacts {
  return {
    changeId: facts.change.changeId,
    changeDigest: facts.change.digest,
    ...(facts.review === undefined ? {} : { review: facts.review }),
    implementations: facts.implementations,
    ...(facts.certification === undefined ? {} : { certification: facts.certification }),
  };
}

function allChecksMatch(certification: CertificationEvidence | undefined): boolean {
  return (
    certification?.result === "match" &&
    certification.checks.length > 0 &&
    certification.checks.every((check) => check.result === "match")
  );
}

/** Compose all Design lifecycle mutations through the fixed repository ports. */
export class DesignApplicationService {
  constructor(private readonly ports: DesignIntentPorts) {}

  /** Author and persist a new draft after validating the exact current Canon. */
  async create(input: DesignChangeCreateInput): Promise<DesignChangeSet> {
    const changeId = inputChangeId(input);
    if ((await this.ports.changeStore.read(changeId)) !== undefined) {
      throw new DesignApplicationError("change-already-exists", `Design Change ${changeId} already exists`);
    }

    const canon = await this.readCurrentCanon();
    const change = await this.resolveChange(input, canon);
    const lifecycle = recordFor({ change, implementations: [] }, "draft");

    // All codec/machine/domain checks complete before either repository port is written.
    await this.ports.changeStore.write(change);
    await this.ports.lifecycle.write(lifecycle);
    return change;
  }

  /** Amend a proposal; semantic changes invalidate current review/link/certification evidence. */
  async amend(changeId: string, input: DesignChangeAmendInput): Promise<DesignChangeSet> {
    text(changeId, "changeId");
    if (inputChangeId(input) !== changeId) {
      throw new DesignApplicationError("invalid-change", "amended Design Change must retain its changeId");
    }
    const current = await this.readChange(changeId);
    const facts = await this.readFacts(current);
    if (facts.state === "promoted") {
      throw new DesignApplicationError("unsupported-operation", "a promoted Design Change cannot be amended");
    }
    const canon = await this.readCurrentCanon();
    const next = await this.resolveChange(input, canon);
    if (next.digest === current.digest) return current;

    const lifecycle = recordFor({ change: next, implementations: [] }, "draft");
    await this.ports.changeStore.write(next);
    await this.ports.lifecycle.write(lifecycle);
    return next;
  }

  /** Enter design review. */
  async submit(changeId: string): Promise<DesignIntentLifecycleRecord> {
    return this.transition(changeId, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  }

  /** Record immutable review evidence and apply its approval/rework transition. */
  async review(evidence: DesignReviewEvidence): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readChange(evidence.changeId);
    assertReview(evidence, change);
    const reviews = await this.ports.reviews.list(change.changeId);
    if (reviews.some((entry) => entry.reviewId === evidence.reviewId)) {
      throw new DesignApplicationError("duplicate-evidence", `review ${evidence.reviewId} already exists`);
    }
    const facts = await this.readFacts(change, { review: evidence, reviews });
    const event: DesignChangeLifecycleEvent =
      evidence.decision === "approved" ? { type: "DESIGN_REVIEW_APPROVED" } : { type: "DESIGN_REVIEW_REWORK" };
    const state = this.nextState(facts, event);
    const lifecycle = recordFor(
      { change, review: evidence, implementations: facts.implementations, certification: facts.certification },
      state,
    );
    // The transition is evaluated before recording evidence, so rejected input commits nothing.
    await this.ports.reviews.record(evidence);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /** Enter implementation only when current approval evidence satisfies machine guards. */
  async start(changeId: string): Promise<DesignIntentLifecycleRecord> {
    return this.transition(changeId, { type: "START_IMPLEMENTATION" });
  }

  /** Record one exact-proposal external Implementation link. */
  async link(link: ImplementationLink): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readChange(link.changeId);
    assertLink(link, change);
    const facts = await this.readFacts(change);
    if (facts.state !== "implementing") {
      throw new DesignApplicationError("illegal-transition", `cannot link an Implementation from ${facts.state}`);
    }
    if (facts.implementations.some((entry) => entry.linkId === link.linkId)) {
      throw new DesignApplicationError("duplicate-evidence", `implementation link ${link.linkId} already exists`);
    }
    const implementations = [...facts.implementations, link];
    const lifecycle = recordFor({ ...facts, implementations }, facts.state);
    await this.ports.implementations.record(link);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /** Record certification/check outcomes, then enter certification review. */
  async certify(evidence: CertificationEvidence): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readChange(evidence.changeId);
    assertCertification(evidence, change);
    const facts = await this.readFacts(change, { certification: evidence });
    const state = this.nextState(facts, { type: "SUBMIT_FOR_CERTIFICATION" });
    const lifecycle = recordFor({ ...facts, certification: evidence }, state);
    await this.ports.certification.record(evidence);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /** Apply review or certification rework according to the persisted current evidence. */
  async rework(changeId: string): Promise<DesignIntentLifecycleRecord> {
    const facts = await this.readFacts(await this.readChange(changeId));
    const event: DesignChangeLifecycleEvent =
      facts.state === "design-review"
        ? { type: "DESIGN_REVIEW_REWORK" }
        : facts.state === "certification-review"
          ? { type: "CERTIFICATION_REWORK" }
          : (() => {
              throw new DesignApplicationError("illegal-transition", `cannot rework from ${facts.state}`);
            })();
    const state = this.nextState(facts, event);
    const lifecycle = recordFor(facts, state);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /** Promote only a certified proposal whose every check is a match. */
  async promote(changeId: string): Promise<DesignIntentLifecycleRecord> {
    const facts = await this.readFacts(await this.readChange(changeId));
    if (!allChecksMatch(facts.certification)) {
      throw new DesignApplicationError(
        "illegal-transition",
        "promotion requires complete matching certification checks",
      );
    }
    const state = this.nextState(facts, { type: "PROMOTE" });
    const lifecycle = recordFor(facts, state);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /** Re-read and validate one persisted lifecycle projection without retrying stale reads. */
  async recover(changeId: string): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readChange(changeId);
    const facts = await this.readFacts(change);
    if (facts.lifecycle !== undefined) return recordFor(facts, facts.lifecycle.state);
    return recordFor(facts, "draft");
  }

  // Explicit aliases keep command adapters from reimplementing lifecycle naming.
  submitForDesignReview(changeId: string) {
    return this.submit(changeId);
  }
  startImplementation(changeId: string) {
    return this.start(changeId);
  }
  linkImplementation(link: ImplementationLink) {
    return this.link(link);
  }
  recordCertification(evidence: CertificationEvidence) {
    return this.certify(evidence);
  }

  private async transition(changeId: string, event: DesignChangeLifecycleEvent): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readChange(changeId);
    const facts = await this.readFacts(change);
    const state = this.nextState(facts, event);
    const lifecycle = recordFor(facts, state);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  private nextState(facts: ResolvedFacts, event: DesignChangeLifecycleEvent): DesignChangeLifecycleState {
    const actor = createActor(
      createDesignChangeLifecycleMachine({ ...lifecycleFacts(facts), initialState: facts.state }),
    );
    actor.start();
    actor.send(event);
    const snapshot = actor.getSnapshot();
    actor.stop();
    if (snapshot.context.lastError !== undefined) {
      throw new DesignApplicationError("illegal-transition", `event ${event.type} is not allowed from ${facts.state}`);
    }
    if (typeof snapshot.value !== "string") {
      throw new DesignApplicationError("illegal-transition", "lifecycle machine returned an invalid state");
    }
    return snapshot.value as DesignChangeLifecycleState;
  }

  private async resolveChange(
    input: DesignChangeCreateInput | DesignChangeAmendInput,
    canon: CanonRead,
  ): Promise<DesignChangeSet> {
    let change: DesignChangeSet;
    if (isAuthoringInput(input)) {
      if (!sameRevision(input.base, canon.revision))
        throw new DesignApplicationError("stale-canon", "authoring base is stale");
      if (architectureCanonDigest(input.baseCanon) !== canon.revision.canonDigest) {
        throw new DesignApplicationError("stale-canon", "authoring input does not use the current Canon object");
      }
      change = createDesignChangeSet({ ...input, baseCanon: canon.document });
    } else if ("digest" in input) {
      change = decodeDesignChangeSet(input);
    } else {
      const payload = input as DesignChangeSetPayload;
      change = decodeDesignChangeSet({ ...payload, digest: digestJson(payload) });
    }
    if (!sameRevision(change.base, canon.revision)) {
      throw new DesignApplicationError("stale-canon", "Design Change base is not the current Canon revision");
    }
    const proposed = await this.ports.changes.apply(payloadOf(change), canon.document);
    if (architectureCanonDigest(proposed) !== change.target.targetCanonDigest) {
      throw new DesignApplicationError(
        "invalid-change",
        "Design Change target digest does not match the applied Canon",
      );
    }
    return change;
  }

  private async readCurrentCanon(): Promise<CanonRead> {
    const current = await this.ports.canon.readCurrent();
    if (architectureCanonDigest(current.document) !== current.revision.canonDigest) {
      throw new DesignApplicationError("stale-canon", "current Canon digest does not match its revision binding");
    }
    return current;
  }

  private async readChange(changeId: string): Promise<DesignChangeSet> {
    const stored = await this.ports.changeStore.read(changeId);
    if (stored === undefined)
      throw new DesignApplicationError("change-not-found", `Design Change ${changeId} was not found`);
    const change = decodeDesignChangeSet(stored);
    if (change.changeId !== changeId)
      throw new DesignApplicationError("stale-evidence", "stored Change Set identity mismatches its key");
    return change;
  }

  private async readFacts(
    change: DesignChangeSet,
    overrides: {
      readonly review?: DesignReviewEvidence;
      readonly reviews?: readonly DesignReviewEvidence[];
      readonly certification?: CertificationEvidence;
    } = {},
  ): Promise<ResolvedFacts> {
    const lifecycle = await this.ports.lifecycle.read(change.changeId);
    if (lifecycle !== undefined && lifecycle.changeDigest !== change.digest) {
      throw new DesignApplicationError("stale-lifecycle", `lifecycle for ${change.changeId} is stale`);
    }
    const reviews = overrides.reviews ?? (await this.ports.reviews.list(change.changeId));
    const currentReviews = reviews.filter(
      (entry) => entry.changeId === change.changeId && entry.proposalDigest === change.digest,
    );
    const review = overrides.review ?? currentReviews.at(-1);
    const implementations = (await this.ports.implementations.list(change.changeId)).filter(
      (entry) => entry.changeId === change.changeId && entry.changeDigest === change.digest,
    );
    const storedCertification = await this.ports.certification.read(change.changeId);
    if (
      storedCertification !== undefined &&
      (storedCertification.changeId !== change.changeId || storedCertification.changeDigest !== change.digest)
    ) {
      throw new DesignApplicationError("stale-evidence", `certification for ${change.changeId} is stale`);
    }
    const certification = overrides.certification ?? storedCertification;
    return {
      change,
      lifecycle,
      state: lifecycle?.state ?? "draft",
      review,
      implementations,
      certification,
    };
  }
}

/** Factory used by command adapters and tests; no filesystem or network is created here. */
export function createDesignApplication(ports: DesignIntentPorts): DesignApplicationService {
  return new DesignApplicationService(ports);
}

export const createDesignApplicationService = createDesignApplication;
