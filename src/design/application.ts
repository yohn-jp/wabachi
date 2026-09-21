import { validateArchitectureDocument } from "../architecture/canon/validate.js";
import type { CodeIntent } from "../architecture/canon/code-intent-contract.js";
import { decodeDesignChangeSet } from "./change/codec.js";
import { architectureCanonDigest, createDesignChangeSet, type DesignChangeAuthoringInput } from "./change/diff.js";
import { digestJson, type Digest } from "./digest.js";
import {
  aggregateCertification,
  type CertificationAggregationResult,
  type GitImplementationSubject,
  type HumanCertificationReview,
} from "./certification/certify.js";
import { deriveCertificationProofPlan } from "./certification/plan.js";
import { runMachineChecks } from "./certification/machine-checks.js";
import type {
  CanonRevisionReference,
  CertificationEvidence,
  DesignChangeLifecycleState,
  DesignChangeSet,
  DesignChangeSetPayload,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
  MachineTransitionContext,
  MachineTransitionEvent,
  MachineTransitionRequest,
  MachineTransitionResult,
  RepositoryRevisionReference,
} from "./contracts.js";
import { decodeImplementationLink } from "./linkage/codec.js";
import { evaluateCoverage, type ImplementationCompletionEvidence } from "./linkage/coverage.js";
import type { DesignIntentPorts, GitPort, MachinePort } from "./ports.js";
import type { DesignAmendmentTransaction } from "./review/service.js";
import { DesignPromotionService, type PromotionSuccess, type PromoteDesignInput } from "./promotion/service.js";
import type { RepositoryEvidenceInput } from "./certification/evidence.js";
import type { DesignChangeLifecycleEvent, DesignChangeLifecycleFacts } from "./lifecycle/machine.js";

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

/** Raw inputs accepted by the production certification pipeline. */
export interface DesignCertificationInput {
  readonly changeId: string;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly repositoryEvidence?: RepositoryEvidenceInput | unknown;
  readonly completionEvidence?: readonly ImplementationCompletionEvidence[];
  readonly integrationRevision?: RepositoryRevisionReference;
  readonly implementationSubject?: GitImplementationSubject | readonly GitImplementationSubject[];
  readonly humanReviews?: readonly HumanCertificationReview[];
  readonly codeIntent?: readonly CodeIntent[];
  readonly certificationId?: string;
  readonly recordedAt?: string;
}

export interface DesignApplicationTransactionInput {
  readonly change?: DesignChangeSet;
  readonly lifecycle?: DesignIntentLifecycleRecord;
  readonly review?: DesignReviewEvidence;
  readonly implementation?: ImplementationLink;
  readonly certification?: CertificationEvidence;
}

/** Atomic storage composition supplied by the repository adapter. */
export interface DesignApplicationTransaction {
  commit(input: DesignApplicationTransactionInput): Promise<void>;
}

export interface DesignApplicationRecovery {
  recover(changeId?: string): Promise<unknown>;
}

/** The lifecycle machine is the sole state-transition authority. */
export interface DesignLifecycleMachinePort extends MachinePort {
  readonly initialState: () => DesignChangeLifecycleState;
}

export interface DesignReviewDelegate {
  amend(
    changeId: string,
    payload: DesignChangeSetPayload,
    proposalRevision?: string,
  ): Promise<{ change: DesignChangeSet }>;
  recordReview(evidence: DesignReviewEvidence): Promise<DesignIntentLifecycleRecord>;
  rework(changeId: string): Promise<DesignIntentLifecycleRecord>;
}

export interface DesignApplicationDependencies {
  /** #209 review/amend service. */
  readonly review?: DesignReviewDelegate;
  /** Transaction used by #209 for semantic amendments. */
  readonly amendmentTransaction?: DesignAmendmentTransaction;
  /** Shared transaction boundary for link/certification writes. */
  readonly transaction?: DesignApplicationTransaction;
  /** #216 production promotion service. */
  readonly promotion?: Pick<DesignPromotionService, "promote">;
  /** #207 explicit recovery service. */
  readonly recovery?: DesignApplicationRecovery;
  /** Repository ancestry capability used by #211 coverage. */
  readonly git?: GitPort;
  /** XState-backed lifecycle adapter; the facade never constructs the machine. */
  readonly machine?: DesignLifecycleMachinePort;
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
    ...(facts.review === undefined ? {} : { proposalRevision: facts.review.proposalRevision, review: facts.review }),
    implementations: facts.implementations,
    ...(facts.certification === undefined ? {} : { certification: facts.certification }),
  };
}

function unsupported(message: string): never {
  throw new DesignApplicationError("unsupported-operation", message);
}

/** Compose Design lifecycle operations through the fixed repository/domain ports. */
export class DesignApplicationService {
  private readonly dependencies: DesignApplicationDependencies;

  constructor(
    private readonly ports: DesignIntentPorts,
    dependencies: DesignApplicationDependencies = {},
  ) {
    this.dependencies = dependencies;
  }

  /** Author and persist a new draft after validating the exact current Canon. */
  async create(input: DesignChangeCreateInput): Promise<DesignChangeSet> {
    const changeId = inputChangeId(input);
    if ((await this.ports.changeStore.read(changeId)) !== undefined) {
      throw new DesignApplicationError("change-already-exists", `Design Change ${changeId} already exists`);
    }
    const canon = await this.readCurrentCanon();
    const change = await this.resolveChange(input, canon);
    const lifecycle = recordFor({ change, implementations: [] }, this.initialState());
    await this.ports.changeStore.write(change);
    await this.ports.lifecycle.write(lifecycle);
    return change;
  }

  /** Amend through #209's XState AMEND transaction; no local state decision is made here. */
  async amend(changeId: string, input: DesignChangeAmendInput): Promise<DesignChangeSet> {
    text(changeId, "changeId");
    if (inputChangeId(input) !== changeId) {
      throw new DesignApplicationError("invalid-change", "amended Design Change must retain its changeId");
    }
    const current = await this.readChange(changeId);
    const canon = await this.readCurrentCanon();
    const next = await this.resolveChange(input, canon);
    if (next.digest === current.digest) return current;
    const review = this.dependencies.review;
    if (review === undefined) {
      return unsupported("semantic amendment requires the #209 review service and atomic transaction");
    }
    const proposalRevision =
      isRecord(input) && typeof input.proposalRevision === "string"
        ? input.proposalRevision
        : next.base.repositoryRevision;
    const result = await review.amend(changeId, payloadOf(next), proposalRevision);
    return result.change;
  }

  /** Enter design review through the canonical lifecycle transition. */
  async submit(changeId: string): Promise<DesignIntentLifecycleRecord> {
    return this.transition(changeId, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  }

  /** Record immutable review evidence through #208 codec and #209 service. */
  async review(evidence: DesignReviewEvidence): Promise<DesignIntentLifecycleRecord> {
    const { validateDesignReviewEvidence } = await import("./review/codec.js");
    const decoded = validateDesignReviewEvidence(evidence);
    const service = this.dependencies.review;
    if (service === undefined) return unsupported("review requires the #209 review service");
    return service.recordReview(decoded);
  }

  /** Enter implementation only when current approval evidence satisfies machine guards. */
  async start(changeId: string): Promise<DesignIntentLifecycleRecord> {
    return this.transition(changeId, { type: "START_IMPLEMENTATION" });
  }

  /** Decode and persist one exact-proposal external Implementation link. */
  async link(value: unknown): Promise<DesignIntentLifecycleRecord> {
    if (!isRecord(value)) return unsupported("implementation link must be an object");
    const changeId = text(value.changeId, "changeId");
    const change = await this.readChange(changeId);
    const link = decodeImplementationLink(value, { changeId: change.changeId, digest: change.digest });
    const facts = await this.readFacts(change);
    if (facts.state !== "implementing") {
      throw new DesignApplicationError("illegal-transition", `cannot link an Implementation from ${facts.state}`);
    }
    const implementations = [...facts.implementations, link];
    const lifecycle = recordFor({ ...facts, implementations }, facts.state);
    if (this.dependencies.transaction === undefined) {
      return unsupported("implementation linkage requires the StorePort transaction boundary");
    }
    await this.dependencies.transaction.commit({ implementation: link, lifecycle });
    return lifecycle;
  }

  /** Run #212 -> #211/#213 -> #214, then persist only its derived result. */
  async certify(input: DesignCertificationInput): Promise<DesignIntentLifecycleRecord> {
    if (!isRecord(input)) return unsupported("certification input must be an object");
    if ("result" in input || "checks" in input) {
      throw new DesignApplicationError(
        "invalid-evidence",
        "certify accepts raw inputs, not final CertificationEvidence",
      );
    }
    if (this.dependencies.transaction === undefined) {
      return unsupported("certification requires the StorePort transaction boundary");
    }
    const change = await this.readChange(input.changeId);
    const facts = await this.readFacts(change);
    if (facts.state !== "implementing") {
      throw new DesignApplicationError("illegal-transition", `cannot certify from ${facts.state}`);
    }
    const target = await this.targetCanon(change);
    const plan = deriveCertificationProofPlan({
      change,
      canon: target,
      implementationRevision: input.implementationRevision,
      implementations: facts.implementations,
      codeIntent: input.codeIntent,
    });
    const coverage = await evaluateCoverage({
      change,
      links: facts.implementations,
      completionEvidence: input.completionEvidence,
      integrationRevision: input.integrationRevision,
      git: this.dependencies.git,
    });
    const machine = runMachineChecks({
      document: target,
      codeIntent: input.codeIntent,
      evidence: input.repositoryEvidence,
      expectedRepository: input.implementationRevision,
    });
    const validation = validateArchitectureDocument(target);
    const requiredMachineIds = new Set(
      plan.obligations.filter((obligation) => obligation.mode === "machine").map((obligation) => obligation.id),
    );
    const producedMachineChecks = machine.checks.map((check) => {
      const obligation = plan.obligations.find(
        (candidate) =>
          candidate.mode === "machine" &&
          candidate.targetEntryKey !== undefined &&
          candidate.targetEntryKey === check.targetEntryKey,
      );
      return obligation === undefined ? check : { ...check, checkId: obligation.id };
    });
    const machineChecks = [
      ...producedMachineChecks.filter((check) => requiredMachineIds.has(check.checkId)),
      {
        checkId: "canon-validity",
        result: validation.valid ? ("match" as const) : ("mismatch" as const),
        detail: validation.valid ? "target Canon is valid" : "target Canon is invalid",
      },
      {
        checkId: "linked-target-coverage",
        result: coverage.result,
        detail: coverage.findings.map((finding) => finding.detail).join("; ") || "all targets are covered",
      },
      {
        checkId: "source-revision-binding",
        result: coverage.complete ? ("match" as const) : ("unresolved" as const),
        detail: coverage.complete ? "completion evidence is revision-bound" : "completion evidence is incomplete",
      },
    ];
    const aggregation = aggregateCertification({
      plan,
      change,
      targetCanon: target,
      implementationLinks: facts.implementations,
      implementationSubject: input.implementationSubject,
      machineChecks,
      humanReviews: input.humanReviews,
      certificationId: input.certificationId,
      recordedAt: input.recordedAt,
    });
    const eventFacts: ResolvedFacts = { ...facts, certification: aggregation.evidence };
    const state = this.nextState(eventFacts, { type: "SUBMIT_FOR_CERTIFICATION" });
    const lifecycle = recordFor(eventFacts, state);
    await this.dependencies.transaction.commit({ certification: aggregation.evidence, lifecycle });
    return lifecycle;
  }

  /** Apply canonical review/lifecycle rework. */
  async rework(changeId: string): Promise<DesignIntentLifecycleRecord> {
    const service = this.dependencies.review;
    if (service === undefined) return unsupported("rework requires the #209 review service");
    return service.rework(changeId);
  }

  /** Delegate promotion to #216; this method does not write lifecycle/current Canon state. */
  async promote(changeId: string): Promise<PromotionSuccess> {
    const service = this.dependencies.promotion;
    if (service === undefined) return unsupported("promotion requires the #216 production promotion service");
    const change = await this.readChange(changeId);
    const facts = await this.readFacts(change);
    const target = await this.targetCanon(change);
    const promotionTransition = facts.state === "promoted" ? facts.state : this.nextState(facts, { type: "PROMOTE" });
    const certification = facts.certification;
    const input: PromoteDesignInput = {
      changeId,
      certifiedTarget: target,
      promotionTransition: { state: promotionTransition },
      ...(certification === undefined ? {} : { implementationRevision: certification.implementationRevision }),
    };
    return service.promote(input);
  }

  /** Delegate explicit recovery to #207; normal reads are never retried here. */
  async recover(changeId?: string): Promise<unknown> {
    const recovery = this.dependencies.recovery;
    if (recovery === undefined) return unsupported("recovery requires the #207 transaction recovery service");
    return recovery.recover(changeId);
  }

  submitForDesignReview(changeId: string) {
    return this.submit(changeId);
  }
  startImplementation(changeId: string) {
    return this.start(changeId);
  }
  linkImplementation(link: unknown) {
    return this.link(link);
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
    const machine = this.dependencies.machine;
    if (machine === undefined) return unsupported("lifecycle operation requires the MachinePort authority");
    const machineEvent: MachineTransitionEvent = {
      changeId: facts.change.changeId,
      sequence: 0,
      previousEventDigest: facts.change.digest,
      recordedAt: "1970-01-01T00:00:00.000Z",
      kind: event.type,
      type: event.type,
      event: event.type,
      payload: { type: event.type },
      eventDigest: digestJson({
        changeId: facts.change.changeId,
        sequence: 0,
        previousEventDigest: facts.change.digest,
        recordedAt: "1970-01-01T00:00:00.000Z",
        kind: event.type,
        type: event.type,
        event: event.type,
        payload: { type: event.type },
      }),
    };
    const context = {
      changeId: facts.change.changeId,
      proposalDigest: facts.change.digest,
      ...(facts.review === undefined ? {} : { proposalRevision: facts.review.proposalRevision, review: facts.review }),
      implementations: facts.implementations,
      ...(facts.certification === undefined ? {} : { certification: facts.certification }),
    };
    const result =
      machine.transition.length >= 2
        ? (
            machine.transition as (
              state: DesignChangeLifecycleState,
              event: MachineTransitionEvent,
              context: MachineTransitionContext,
            ) => MachineTransitionResult | DesignChangeLifecycleState
          )(facts.state, machineEvent, context)
        : (
            machine.transition as (
              request: MachineTransitionRequest,
            ) => MachineTransitionResult | DesignChangeLifecycleState
          )({ state: facts.state, event: machineEvent, context });
    const state = typeof result === "string" ? result : result.state;
    if (typeof state !== "string") throw new DesignApplicationError("illegal-transition", "invalid lifecycle state");
    return state as DesignChangeLifecycleState;
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

  private async targetCanon(change: DesignChangeSet): Promise<CanonRead["document"]> {
    const base = await this.ports.canon.readAt(change.base);
    const target = await this.ports.changes.apply(payloadOf(change), base);
    if (architectureCanonDigest(target) !== change.target.targetCanonDigest) {
      throw new DesignApplicationError(
        "invalid-change",
        "Design Change target digest does not match the applied Canon",
      );
    }
    return target;
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

  private async readFacts(change: DesignChangeSet): Promise<ResolvedFacts> {
    const lifecycle = await this.ports.lifecycle.read(change.changeId);
    if (lifecycle !== undefined && lifecycle.changeDigest !== change.digest) {
      throw new DesignApplicationError("stale-lifecycle", `lifecycle for ${change.changeId} is stale`);
    }
    const reviews = await this.ports.reviews.list(change.changeId);
    const review = reviews
      .filter((entry) => entry.changeId === change.changeId && entry.proposalDigest === change.digest)
      .at(-1);
    const implementations = (await this.ports.implementations.list(change.changeId)).filter(
      (entry) => entry.changeId === change.changeId && entry.changeDigest === change.digest,
    );
    const certification = await this.ports.certification.read(change.changeId);
    if (
      certification !== undefined &&
      (certification.changeId !== change.changeId || certification.changeDigest !== change.digest)
    ) {
      throw new DesignApplicationError("stale-evidence", `certification for ${change.changeId} is stale`);
    }
    return {
      change,
      lifecycle,
      state: lifecycle?.state ?? this.initialState(),
      review,
      implementations,
      certification,
    };
  }

  private initialState(): DesignChangeLifecycleState {
    const machine = this.dependencies.machine;
    if (machine === undefined) return unsupported("lifecycle operation requires the MachinePort authority");
    const state = machine.initialState();
    if (typeof state !== "string") throw new DesignApplicationError("illegal-transition", "invalid lifecycle state");
    return state;
  }
}

export function createDesignApplication(
  ports: DesignIntentPorts,
  dependencies: DesignApplicationDependencies = {},
): DesignApplicationService {
  return new DesignApplicationService(ports, dependencies);
}

export const createDesignApplicationService = createDesignApplication;

/** Type-only export documenting the production result used by certification composition. */
export type DesignCertificationResult = CertificationAggregationResult;
