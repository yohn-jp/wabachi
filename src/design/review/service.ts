import { createActor } from "xstate";
import { digestJson } from "../digest.js";
import type {
  DesignChangeSet,
  DesignChangeSetPayload,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
} from "../contracts.js";
import type { DesignIntentPorts } from "../ports.js";
import {
  createDesignChangeLifecycleMachine,
  type DesignChangeLifecycleEvent,
  type DesignChangeLifecycleFacts,
  type DesignChangeLifecycleInput,
} from "../lifecycle/machine.js";
import { createDesignChangeEvent, type DesignChangeEvent } from "../lifecycle/record.js";

/** A revision reader is optional, but when supplied it must reproduce the reviewed proposal bytes. */
export interface ProposalRevisionReader {
  read(changeId: string, revision: string): Promise<DesignChangeSet | DesignChangeSetPayload | undefined>;
}

/** An adapter can persist the amended change and lifecycle record atomically. */
export interface DesignAmendmentTransaction {
  commit(change: DesignChangeSet, lifecycle: DesignIntentLifecycleRecord, event: DesignChangeEvent): Promise<void>;
}

export interface DesignReviewServiceOptions {
  /** Reads the immutable proposal bytes identified by review.proposalRevision. */
  readonly proposalRevisions?: ProposalRevisionReader;
  /** Persists an amendment and its AMEND event as one repository transaction. */
  readonly amendmentTransaction?: DesignAmendmentTransaction;
}

export interface ApprovalSelection {
  readonly evidence: DesignReviewEvidence;
  readonly change: DesignChangeSet;
}

export interface AmendmentResult {
  readonly changed: boolean;
  readonly change: DesignChangeSet;
  readonly lifecycle?: DesignIntentLifecycleRecord;
}

export class DesignReviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DesignReviewError";
    this.code = code;
  }
}

/**
 * Applies the review gate to a Design Intent lifecycle.
 *
 * Review evidence is immutable history. Only an approval whose digest and
 * reproducible proposal revision both match the current Change Set can be
 * selected for authorization.
 */
export class DesignReviewService {
  private readonly ports: DesignIntentPorts;
  private readonly options: DesignReviewServiceOptions;

  constructor(ports: DesignIntentPorts, options: DesignReviewServiceOptions = {}) {
    this.ports = ports;
    this.options = options;
  }

  /**
   * Select the only kind of approval that can authorize the current proposal.
   * An expected revision is useful for stores whose current revision is supplied
   * by their repository adapter rather than exposed by DesignChangeStorePort.
   */
  async selectApproval(changeId: string, expectedProposalRevision?: string): Promise<ApprovalSelection> {
    const change = await this.readCurrentChange(changeId);
    const reviews = await this.ports.reviews.list(changeId);
    let latest: DesignReviewEvidence | undefined;
    for (const review of reviews) {
      if (review.changeId === changeId && review.proposalDigest === change.digest) {
        latest = review;
      }
    }
    if (latest === undefined || latest.decision !== "approved") {
      throw new DesignReviewError(
        "approval-not-current",
        `no accepted review evidence for current proposal ${changeId}`,
      );
    }
    if (!(await this.isUsableRevision(latest, change, expectedProposalRevision))) {
      throw new DesignReviewError(
        "approval-not-current",
        `review ${latest.reviewId} does not identify current proposal bytes`,
      );
    }

    return { evidence: latest, change };
  }

  /** Alias kept intentionally small for callers that use the gate as a predicate. */
  async requireApproval(changeId: string, expectedProposalRevision?: string): Promise<ApprovalSelection> {
    return this.selectApproval(changeId, expectedProposalRevision);
  }

  /**
   * Records review evidence and updates the lifecycle gate. Rework decisions
   * return the proposal to draft while retaining the evidence in review history.
   */
  async recordReview(evidence: DesignReviewEvidence): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readCurrentChange(evidence.changeId);
    if (evidence.proposalDigest !== change.digest) {
      throw new DesignReviewError("stale-review", `review ${evidence.reviewId} does not target current proposal`);
    }
    if (!(await this.isUsableRevision(evidence, change))) {
      throw new DesignReviewError(
        "unreproducible-review",
        `review ${evidence.reviewId} does not identify reproducible proposal bytes`,
      );
    }

    const previous = await this.ports.lifecycle.read(change.changeId);
    const lifecycle = this.lifecycleForReview(change, previous, evidence);
    await this.ports.reviews.record(evidence);
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /**
   * Proves that implementation may start, and moves an approved proposal into
   * the approved state when it has not yet been materialized in lifecycle data.
   */
  async authorizeImplementation(
    changeId: string,
    expectedProposalRevision?: string,
  ): Promise<DesignIntentLifecycleRecord> {
    const { evidence, change } = await this.selectApproval(changeId, expectedProposalRevision);
    const previous = await this.ports.lifecycle.read(changeId);
    if (previous !== undefined && previous.changeDigest !== change.digest) {
      throw new DesignReviewError("stale-lifecycle", `lifecycle record for ${changeId} is stale`);
    }

    const state = this.stateForApproval(change, previous, evidence);
    const lifecycle: DesignIntentLifecycleRecord = {
      changeId,
      changeDigest: change.digest,
      state,
      review: evidence,
      implementations: previous?.implementations ?? [],
      certification: previous?.certification,
    };
    if (previous?.state === "draft" || previous?.state === "design-review" || previous === undefined) {
      await this.ports.lifecycle.write(lifecycle);
    }
    return lifecycle;
  }

  /** Requires current approval without mutating lifecycle state. */
  async assertImplementationAuthorized(
    changeId: string,
    expectedProposalRevision?: string,
  ): Promise<ApprovalSelection> {
    const selection = await this.selectApproval(changeId, expectedProposalRevision);
    const lifecycle = await this.ports.lifecycle.read(changeId);
    if (lifecycle !== undefined && lifecycle.changeDigest !== selection.change.digest) {
      throw new DesignReviewError("stale-lifecycle", `lifecycle record for ${changeId} is stale`);
    }
    if (lifecycle?.state === "draft" || lifecycle?.state === "design-review") {
      throw new DesignReviewError("implementation-not-authorized", `proposal ${changeId} is not approved`);
    }
    return selection;
  }

  /**
   * Replaces a proposal when its semantic payload changes. The old review,
   * implementation links, and certification remain in their stores as history;
   * the new lifecycle record contains none of them and starts in draft.
   */
  async amend(changeId: string, payload: DesignChangeSetPayload, proposalRevision?: string): Promise<AmendmentResult> {
    const current = await this.readCurrentChange(changeId);
    if (payload.changeId !== changeId) {
      throw new DesignReviewError("change-id-mismatch", "amended proposal must retain the Change Set identity");
    }

    const next = createDesignChangeSet(payload);
    if (next.digest === current.digest) {
      return {
        changed: false,
        change: current,
        lifecycle: await this.ports.lifecycle.read(changeId),
      };
    }

    const lifecycleBase = {
      changeId,
      changeDigest: next.digest,
      implementations: [],
    };
    if (this.options.amendmentTransaction === undefined) {
      throw new DesignReviewError(
        "atomic-transaction-required",
        "semantic amendment requires an atomic change, lifecycle, and AMEND event transaction",
      );
    }
    if (typeof proposalRevision !== "string" || proposalRevision.trim().length === 0) {
      throw new DesignReviewError(
        "proposal-revision-required",
        "semantic amendment requires an immutable proposal revision",
      );
    }
    const previous = await this.ports.lifecycle.read(changeId);
    const state = this.transitionState(current, previous, undefined, { type: "AMEND" });
    const amendedLifecycle: DesignIntentLifecycleRecord = { ...lifecycleBase, state };
    const event = createDesignChangeEvent({
      changeId,
      sequence: 0,
      previousEventDigest: current.digest,
      recordedAt: new Date().toISOString(),
      kind: "AMEND",
      payload: { type: "AMEND", proposalDigest: next.digest, proposalRevision },
    });
    await this.options.amendmentTransaction.commit(next, amendedLifecycle, event);
    return { changed: true, change: next, lifecycle: amendedLifecycle };
  }

  /** Applies the machine's explicit rework transition while retaining review history. */
  async requestRework(changeId: string): Promise<DesignIntentLifecycleRecord> {
    const change = await this.readCurrentChange(changeId);
    const previous = await this.ports.lifecycle.read(changeId);
    const state = previous?.state;
    const event: DesignChangeLifecycleEvent | undefined =
      state === "design-review"
        ? { type: "DESIGN_REVIEW_REWORK" }
        : state === "certification-review"
          ? { type: "CERTIFICATION_REWORK" }
          : undefined;
    const nextState = this.transitionState(change, previous, undefined, event);
    const lifecycle: DesignIntentLifecycleRecord = {
      changeId,
      changeDigest: change.digest,
      state: nextState,
      implementations: nextState === "implementing" ? (previous?.implementations ?? []) : [],
    };
    await this.ports.lifecycle.write(lifecycle);
    return lifecycle;
  }

  /** Short alias for workflow callers. */
  async rework(changeId: string): Promise<DesignIntentLifecycleRecord> {
    return this.requestRework(changeId);
  }

  private async readCurrentChange(changeId: string): Promise<DesignChangeSet> {
    const change = await this.ports.changeStore.read(changeId);
    if (change === undefined) {
      throw new DesignReviewError("proposal-not-found", `proposal ${changeId} was not found`);
    }
    if (createDesignChangeSet(payloadOf(change)).digest !== change.digest) {
      throw new DesignReviewError("invalid-proposal", `proposal ${changeId} has an invalid digest`);
    }
    return change;
  }

  private async isUsableRevision(
    review: DesignReviewEvidence,
    current: DesignChangeSet,
    expectedProposalRevision?: string,
  ): Promise<boolean> {
    if (typeof review.proposalRevision !== "string" || review.proposalRevision.trim().length === 0) return false;
    if (expectedProposalRevision !== undefined && review.proposalRevision !== expectedProposalRevision) return false;
    if (this.options.proposalRevisions === undefined) {
      // A digest is not a Git revision. Without a reader, approval is
      // unverifiable and must fail closed.
      return false;
    }
    try {
      const reviewed = await this.options.proposalRevisions.read(current.changeId, review.proposalRevision);
      if (reviewed === undefined) return false;
      const payload = "digest" in reviewed ? payloadOf(reviewed) : reviewed;
      return digestJson(payload) === current.digest;
    } catch {
      return false;
    }
  }

  private lifecycleForReview(
    change: DesignChangeSet,
    previous: DesignIntentLifecycleRecord | undefined,
    evidence: DesignReviewEvidence,
  ): DesignIntentLifecycleRecord {
    const rework = evidence.decision === "changes-requested" || evidence.decision === "rejected";
    const state = this.stateForReview(change, previous, evidence);
    return {
      changeId: change.changeId,
      changeDigest: change.digest,
      state,
      review: rework ? undefined : evidence,
      implementations: rework ? [] : (previous?.implementations ?? []),
      certification: rework ? undefined : previous?.certification,
    };
  }

  private stateForReview(
    change: DesignChangeSet,
    previous: DesignIntentLifecycleRecord | undefined,
    evidence: DesignReviewEvidence,
  ): DesignIntentLifecycleRecord["state"] {
    const initial = previous?.state;
    if (evidence.decision === "changes-requested" || evidence.decision === "rejected") {
      const event = initial === "design-review" ? ({ type: "DESIGN_REVIEW_REWORK" } as const) : undefined;
      return this.transitionState(change, previous, evidence, event);
    }
    const events: readonly DesignChangeLifecycleEvent[] =
      initial === undefined || initial === "draft"
        ? [{ type: "SUBMIT_FOR_DESIGN_REVIEW" }, { type: "DESIGN_REVIEW_APPROVED" }]
        : initial === "design-review"
          ? [{ type: "DESIGN_REVIEW_APPROVED" }]
          : [];
    return this.transitionState(change, previous, evidence, ...events);
  }

  private stateForApproval(
    change: DesignChangeSet,
    previous: DesignIntentLifecycleRecord | undefined,
    evidence: DesignReviewEvidence,
  ): DesignIntentLifecycleRecord["state"] {
    return this.stateForReview(change, previous, evidence);
  }

  private transitionState(
    change: DesignChangeSet,
    previous: DesignIntentLifecycleRecord | undefined,
    evidence?: DesignReviewEvidence,
    ...events: readonly (DesignChangeLifecycleEvent | undefined)[]
  ): DesignIntentLifecycleRecord["state"] {
    const review = evidence ?? previous?.review;
    const facts: DesignChangeLifecycleFacts = {
      changeId: change.changeId,
      changeDigest: change.digest,
      ...(review === undefined ? {} : { proposalRevision: review.proposalRevision, review }),
      implementations: previous?.implementations ?? [],
      ...(previous?.certification === undefined ? {} : { certification: previous.certification }),
    };
    const input: DesignChangeLifecycleInput = { ...facts, initialState: previous?.state };
    const machine = createDesignChangeLifecycleMachine(input);
    const actor = createActor(machine, { input });
    actor.start();
    try {
      for (const event of events) {
        if (event !== undefined) actor.send(event);
      }
      const snapshot = actor.getSnapshot();
      if (snapshot.context.lastError !== undefined) {
        throw new DesignReviewError("illegal-transition", `lifecycle rejected ${snapshot.context.lastError.event}`);
      }
      return snapshot.value as DesignIntentLifecycleRecord["state"];
    } finally {
      actor.stop();
    }
  }
}

export function createDesignChangeSet(payload: DesignChangeSetPayload): DesignChangeSet {
  return { ...payload, digest: digestJson(payload) };
}

function payloadOf(change: DesignChangeSet): DesignChangeSetPayload {
  const { digest: _digest, ...payload } = change;
  return payload;
}

/** Compatibility aliases for callers that describe this boundary as a manager. */
export const DesignReviewManager = DesignReviewService;
export const createDesignReviewService = (
  ports: DesignIntentPorts,
  options?: DesignReviewServiceOptions,
): DesignReviewService => new DesignReviewService(ports, options);
