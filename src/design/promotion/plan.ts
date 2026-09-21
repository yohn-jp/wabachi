import { decodeArchitectureDocument, serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { CANON_VERSION } from "../../architecture/canon/identity.js";
import { createHash } from "node:crypto";
import { canonicalizeJson, digestJson, type Digest } from "../digest.js";
import {
  checkerResultDigest,
  implementationLinkageDigest,
  implementationSubjectDigest,
  type CertificationBindingDigests,
  type GitImplementationSubject,
} from "../certification/certify.js";
import type {
  CanonRevisionReference,
  CertificationEvidence,
  DesignChangeSet,
  DesignChangeLifecycleState,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
  MachineTransitionResult,
  RepositoryRevisionReference,
} from "../contracts.js";
import type { FileDigest } from "../storage/transaction.js";

/** Version of the deterministic promotion write-plan shape. */
export const PROMOTION_PLAN_VERSION = 1 as const;

export type PromotionPlanVersion = typeof PROMOTION_PLAN_VERSION;

/** The only event emitted by this planner. It is descriptive, not an authority. */
export const PROMOTION_EVENT = "PROMOTE" as const;

export type PromotionFailureCode =
  | "invalid-input"
  | "unsupported-schema"
  | "invalid-proposal"
  | "base-mismatch"
  | "stale-certification"
  | "unsafe-target";

export interface PromotionFailure {
  readonly code: PromotionFailureCode;
  readonly detail: string;
}

/** A current Canon snapshot supplied by a read-only repository adapter. */
export interface CurrentCanonSnapshot {
  readonly revision: CanonRevisionReference;
  readonly document: ArchitectureDocumentV1;
  /** Existing bytes are retained as the CAS preimage; they are never rewritten by preflight. */
  readonly bytes?: StoredBytes;
}

/** Exact UTF-8 bytes retained from a repository artifact. */
export type StoredBytes = string | Uint8Array;

/** Result returned by the lifecycle MachinePort for the PROMOTE event. */
export type PromotionTransitionResult = MachineTransitionResult | DesignChangeLifecycleState;

export interface PromotionPreflightInput {
  readonly current: CurrentCanonSnapshot;
  readonly change: DesignChangeSet;
  readonly lifecycle: DesignIntentLifecycleRecord;
  /** The exact Canon document certified by the certification record. */
  readonly certifiedTarget: ArchitectureDocumentV1;
  /** Exact certified target bytes, when the certification provider supplies them. */
  readonly certifiedTargetBytes?: StoredBytes;
  /** A successful XState/MachinePort PROMOTE result. Required for certification-review input. */
  readonly promotionTransition?: PromotionTransitionResult;
  /** Exact stored lifecycle bytes retained for the lifecycle CAS preimage. */
  readonly lifecycleBytes?: StoredBytes;
  /** Optional repository revision assertion for freshness checking. */
  readonly implementationRevision?: RepositoryRevisionReference;
  /** Optional frozen set of proof IDs; when supplied, the certification must match it exactly. */
  readonly requiredCheckIds?: readonly string[];
}

export interface PromotionCasPreimage {
  readonly kind: "current-canon" | "lifecycle-record";
  readonly bytes: StoredBytes;
  readonly digest: FileDigest;
}

export interface CurrentCanonMutation {
  readonly kind: "current-canon";
  readonly bytes: StoredBytes;
  readonly expectedDigest: FileDigest;
  readonly nextDigest: Digest;
}

export interface LifecycleRecordMutation {
  readonly kind: "lifecycle-record";
  readonly bytes: StoredBytes;
  readonly expectedDigest: FileDigest;
  readonly record: DesignIntentLifecycleRecord;
}

export interface PromotionReceipt {
  readonly event: typeof PROMOTION_EVENT;
  readonly receiptId: Digest;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly certificationId: string;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly previousCurrent: CanonRevisionReference;
  readonly promotedCanonDigest: Digest;
  readonly recordedAt: string;
}

export interface PromotionReceiptMutation {
  readonly kind: "promotion-receipt";
  readonly bytes: string;
  /** A receipt is append-only; the preimage is the absence of this record. */
  readonly expectedDigest: null;
  readonly receipt: PromotionReceipt;
}

export type PromotionWrite = CurrentCanonMutation | LifecycleRecordMutation | PromotionReceiptMutation;

export interface PromotionWritePlan {
  readonly planVersion: PromotionPlanVersion;
  readonly event: typeof PROMOTION_EVENT;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly previousCurrent: CanonRevisionReference;
  readonly nextCurrent: CanonRevisionReference;
  readonly nextCurrentCanonBytes: StoredBytes;
  readonly nextLifecycle: DesignIntentLifecycleRecord;
  readonly receipt: PromotionReceipt;
  /** CAS preimages are kept separate from post-image mutations. */
  readonly preimages: readonly PromotionCasPreimage[];
  /** Exactly current Canon, promoted lifecycle record, then the PROMOTE receipt. */
  readonly writes: readonly [CurrentCanonMutation, LifecycleRecordMutation, PromotionReceiptMutation];
}

export interface PromotionPreflightSuccess {
  readonly ok: true;
  readonly plan: PromotionWritePlan;
}

export interface PromotionPreflightFailure {
  readonly ok: false;
  readonly plan?: undefined;
  readonly failure: PromotionFailure;
}

export type PromotionPreflightResult = PromotionPreflightSuccess | PromotionPreflightFailure;

/**
 * Purely checks a certified proposal and returns a deterministic write plan.
 * No filesystem, clock, provider, or lifecycle port is consulted here. A
 * caller may execute `writes` only after its transaction boundary rechecks the
 * supplied CAS preimages.
 */
export function preflightPromotion(input: PromotionPreflightInput): PromotionPreflightResult {
  try {
    const normalized = validateInput(input);
    if (normalized.failure !== undefined) return { ok: false, failure: normalized.failure };

    const { current, change, lifecycle, target, targetBytes, currentBytes, lifecycleBytes } = normalized.value;
    const nextCurrentDigest = digestJson(target);
    const nextCurrent: CanonRevisionReference = {
      repositoryRevision: current.revision.repositoryRevision,
      canonVersion: target.canonVersion,
      canonDigest: nextCurrentDigest,
    };
    const promotedLifecycle: DesignIntentLifecycleRecord = Object.freeze({
      ...lifecycle,
      state: "promoted" as const,
    });
    const promotedLifecycleBytes = canonicalizeJson(promotedLifecycle);
    const certification = lifecycle.certification as CertificationEvidence;
    const receiptPayload = {
      event: PROMOTION_EVENT,
      changeId: change.changeId,
      changeDigest: change.digest,
      certificationId: certification.certificationId,
      implementationRevision: certification.implementationRevision,
      previousCurrent: current.revision,
      promotedCanonDigest: nextCurrentDigest,
      recordedAt: certification.recordedAt,
    } as const;
    const receipt: PromotionReceipt = Object.freeze({
      ...receiptPayload,
      receiptId: digestJson(receiptPayload),
    });
    const receiptBytes = canonicalizeJson(receipt);
    const currentMutation: CurrentCanonMutation = Object.freeze({
      kind: "current-canon",
      bytes: targetBytes,
      expectedDigest: digestBytes(currentBytes),
      nextDigest: nextCurrentDigest,
    });
    const lifecycleMutation: LifecycleRecordMutation = Object.freeze({
      kind: "lifecycle-record",
      bytes: promotedLifecycleBytes,
      expectedDigest: digestBytes(lifecycleBytes),
      record: promotedLifecycle,
    });
    const receiptMutation: PromotionReceiptMutation = Object.freeze({
      kind: "promotion-receipt",
      bytes: receiptBytes,
      expectedDigest: null,
      receipt,
    });
    const preimages: readonly PromotionCasPreimage[] = Object.freeze([
      Object.freeze({ kind: "current-canon" as const, bytes: currentBytes, digest: digestBytes(currentBytes) }),
      Object.freeze({ kind: "lifecycle-record" as const, bytes: lifecycleBytes, digest: digestBytes(lifecycleBytes) }),
    ]);

    return {
      ok: true,
      plan: Object.freeze({
        planVersion: PROMOTION_PLAN_VERSION,
        event: PROMOTION_EVENT,
        changeId: change.changeId,
        changeDigest: change.digest,
        previousCurrent: current.revision,
        nextCurrent,
        nextCurrentCanonBytes: targetBytes,
        nextLifecycle: promotedLifecycle,
        receipt,
        preimages,
        writes: Object.freeze([
          currentMutation,
          lifecycleMutation,
          receiptMutation,
        ]) as unknown as PromotionWritePlan["writes"],
      }),
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: "invalid-input",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Alias for callers that name the operation after its certified input. */
export const planCertifiedPromotion = preflightPromotion;

/** Alias for callers that use the shorter operation name. */
export const planPromotion = preflightPromotion;

function validateInput(
  input: PromotionPreflightInput,
):
  | { readonly value: ValidatedPromotionInput; readonly failure?: undefined }
  | { readonly value?: undefined; readonly failure: PromotionFailure } {
  if (!isRecord(input) || !isRecord(input.current) || !isRecord(input.current.revision)) {
    return failed("invalid-input", "promotion input must contain a current Canon snapshot");
  }
  if (!isRecord(input.change) || !isRecord(input.lifecycle) || !isRecord(input.certifiedTarget)) {
    return failed("invalid-input", "promotion input is missing a proposal, lifecycle, or certified target");
  }

  const current = input.current;
  const change = input.change;
  const lifecycle = input.lifecycle;
  const currentDocument = decodeDocument(current.document, "current Canon");
  const target = decodeDocument(input.certifiedTarget, "certified target Canon");
  const currentBytes = readCanonBytes(current.bytes, currentDocument, "current Canon");
  const targetBytes = readCanonBytes(input.certifiedTargetBytes, target, "certified target Canon");

  if (change.contractVersion !== 1) {
    return failed("unsupported-schema", "proposal uses an unsupported Design Change contract schema");
  }
  if (current.revision.canonVersion !== CANON_VERSION || change.base.canonVersion !== CANON_VERSION) {
    return failed("unsupported-schema", "promotion supports Architecture Canon v1 only");
  }
  if (change.target.canonVersion !== CANON_VERSION || target.canonVersion !== CANON_VERSION) {
    return failed("unsupported-schema", "proposal target uses an unsupported Canon schema");
  }
  if (digestJson(currentDocument) !== current.revision.canonDigest) {
    return failed("unsafe-target", "current Canon revision digest does not match its document");
  }
  if (change.base.canonDigest !== current.revision.canonDigest) {
    return failed("base-mismatch", "current Canon no longer matches the proposal base digest");
  }
  if (digestJson(target) !== change.target.targetCanonDigest) {
    return failed("unsafe-target", "certified target bytes do not match the proposal target digest");
  }
  if (!isCurrentChangeDigestValid(change)) {
    return failed("invalid-proposal", "proposal digest does not match its payload");
  }
  if (!hasSafeOperations(change)) {
    return failed("invalid-proposal", "proposal contains malformed or duplicate semantic operations");
  }

  const lifecycleFailure = validateLifecycle(input, change, target);
  if (lifecycleFailure !== undefined) return { failure: lifecycleFailure };
  const lifecycleBytes = input.lifecycleBytes === undefined ? canonicalizeJson(lifecycle) : input.lifecycleBytes;
  validateStoredJsonBytes(lifecycleBytes, canonicalizeJson(lifecycle), "lifecycle record");
  const implementationRevision = lifecycle.certification!.implementationRevision;
  if (
    input.implementationRevision !== undefined &&
    !sameRevision(input.implementationRevision, implementationRevision)
  ) {
    return failed("stale-certification", "certification implementation revision is stale");
  }

  return {
    value: {
      current: { revision: current.revision, document: currentDocument },
      change,
      lifecycle,
      target,
      currentBytes,
      targetBytes,
      lifecycleBytes,
    },
  };
}

interface ValidatedPromotionInput {
  readonly current: CurrentCanonSnapshot;
  readonly change: DesignChangeSet;
  readonly lifecycle: DesignIntentLifecycleRecord;
  readonly target: ArchitectureDocumentV1;
  readonly currentBytes: StoredBytes;
  readonly targetBytes: StoredBytes;
  readonly lifecycleBytes: StoredBytes;
}

function validateLifecycle(
  input: PromotionPreflightInput,
  change: DesignChangeSet,
  target: ArchitectureDocumentV1,
): PromotionFailure | undefined {
  const lifecycle = input.lifecycle;
  if (lifecycle.changeId !== change.changeId || lifecycle.changeDigest !== change.digest) {
    return { code: "stale-certification", detail: "lifecycle record is not bound to the current proposal" };
  }
  if (lifecycle.state === "certification-review") {
    if (!isSuccessfulPromotionTransition(input.promotionTransition)) {
      return {
        code: "stale-certification",
        detail: "promotion requires a successful XState PROMOTE transition result",
      };
    }
  } else if (lifecycle.state !== "promoted") {
    return {
      code: "stale-certification",
      detail: "promotion requires certification-review or promoted lifecycle state",
    };
  }
  const review = lifecycle.review;
  if (!isCurrentReview(review, change)) {
    return { code: "stale-certification", detail: "review evidence is not bound to the current proposal" };
  }
  for (const link of lifecycle.implementations) {
    if (!isCurrentImplementationLink(link, change)) {
      return { code: "stale-certification", detail: `implementation link ${link.linkId} is stale` };
    }
  }
  const proposalTargets = new Set(change.target.operations.map((operation) => operation.entryKey));
  const linkedTargets = new Set<string>();
  for (const link of lifecycle.implementations) {
    for (const target of link.targetEntryKeys) {
      if (!proposalTargets.has(target)) {
        return { code: "stale-certification", detail: `implementation link ${link.linkId} names an unknown target` };
      }
      linkedTargets.add(target);
    }
  }
  for (const target of proposalTargets) {
    if (!linkedTargets.has(target)) {
      return { code: "stale-certification", detail: `proposal target ${target} has no current implementation link` };
    }
  }
  const certification = lifecycle.certification;
  if (
    !isRecord(certification) ||
    certification.changeId !== change.changeId ||
    certification.changeDigest !== change.digest
  ) {
    return { code: "stale-certification", detail: "certification evidence is not bound to the current proposal" };
  }
  if (
    certification.result !== "match" ||
    !isUsableCertification(certification, input.requiredCheckIds, proposalTargets, target, lifecycle.implementations)
  ) {
    return { code: "stale-certification", detail: "certification is not a complete match for the current proposal" };
  }
  return undefined;
}

function isCurrentReview(
  review: DesignReviewEvidence | undefined,
  change: DesignChangeSet,
): review is DesignReviewEvidence {
  return (
    review !== undefined &&
    review.changeId === change.changeId &&
    review.proposalDigest === change.digest &&
    review.decision === "approved" &&
    typeof review.proposalRevision === "string" &&
    review.proposalRevision.trim().length > 0
  );
}

function isCurrentImplementationLink(link: ImplementationLink, change: DesignChangeSet): boolean {
  const targetIds = new Set<string>();
  return (
    link.changeId === change.changeId &&
    link.changeDigest === change.digest &&
    typeof link.linkId === "string" &&
    link.linkId.trim().length > 0 &&
    Array.isArray(link.targetEntryKeys) &&
    link.targetEntryKeys.every(
      (target) =>
        typeof target === "string" && target.trim().length > 0 && !targetIds.has(target) && targetIds.add(target),
    )
  );
}

function isUsableCertification(
  certification: CertificationEvidence,
  requiredCheckIds: readonly string[] | undefined,
  proposalTargets: ReadonlySet<string>,
  target: ArchitectureDocumentV1,
  links: readonly ImplementationLink[],
): boolean {
  if (
    typeof certification.certificationId !== "string" ||
    certification.certificationId.trim().length === 0 ||
    !isUsableRevision(certification.implementationRevision) ||
    typeof certification.recordedAt !== "string" ||
    certification.recordedAt.trim().length === 0 ||
    !Array.isArray(certification.checks) ||
    certification.checks.length === 0
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const check of certification.checks) {
    if (
      !isRecord(check) ||
      typeof check.checkId !== "string" ||
      check.checkId.trim().length === 0 ||
      ids.has(check.checkId) ||
      check.result !== "match" ||
      (check.targetEntryKey !== undefined &&
        (typeof check.targetEntryKey !== "string" || !proposalTargets.has(check.targetEntryKey)))
    ) {
      return false;
    }
    ids.add(check.checkId);
  }
  if (requiredCheckIds !== undefined) {
    if (!Array.isArray(requiredCheckIds) || requiredCheckIds.length !== ids.size) return false;
    const expected = new Set<string>();
    for (const id of requiredCheckIds) {
      if (typeof id !== "string" || id.trim().length === 0 || expected.has(id) || !ids.has(id)) return false;
      expected.add(id);
    }
    if (expected.size !== ids.size) return false;
  }
  const bound = certification as CertificationEvidence &
    Partial<CertificationBindingDigests> & {
      readonly implementationSubject?: readonly GitImplementationSubject[];
    };
  if (
    bound.proposalDigest !== undefined &&
    (typeof bound.proposalDigest !== "string" || bound.proposalDigest !== certification.changeDigest)
  ) {
    return false;
  }
  if (bound.proposalDigest === undefined || bound.targetCanonDigest === undefined) return false;
  if (bound.targetCanonDigest !== digestJson(target)) return false;
  if (bound.linkageDigest !== implementationLinkageDigest(links)) return false;
  if (!Array.isArray(bound.implementationSubject)) return false;
  if (bound.implementationSubject.some((entry) => !isGitImplementationSubject(entry))) return false;
  if (bound.implementationSubjectDigest !== implementationSubjectDigest(bound.implementationSubject)) return false;
  return bound.checkerDigest === checkerResultDigest(certification.checks);
}

function isGitImplementationSubject(value: unknown): value is GitImplementationSubject {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.mode === "string" &&
    value.mode.length > 0 &&
    typeof value.objectId === "string" &&
    value.objectId.length > 0
  );
}

function isUsableRevision(value: RepositoryRevisionReference): boolean {
  return (
    isRecord(value) &&
    typeof value.repository === "string" &&
    value.repository.trim().length > 0 &&
    typeof value.revision === "string" &&
    value.revision.trim().length > 0
  );
}

function sameRevision(left: RepositoryRevisionReference, right: RepositoryRevisionReference): boolean {
  return left.repository === right.repository && left.revision === right.revision;
}

function decodeDocument(value: unknown, label: string): ArchitectureDocumentV1 {
  try {
    return decodeArchitectureDocument(value);
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function bytes(value: StoredBytes): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value);
}

function digestBytes(value: StoredBytes): FileDigest {
  return createHash("sha256").update(bytes(value)).digest("hex");
}

function readCanonBytes(value: StoredBytes | undefined, document: ArchitectureDocumentV1, label: string): StoredBytes {
  const result = value === undefined ? serializeCanonicalArchitectureDocument(document) : value;
  validateStoredCanonBytes(result, document, label);
  return result;
}

function validateStoredCanonBytes(value: StoredBytes, document: ArchitectureDocumentV1, label: string): void {
  const raw = bytes(value);
  let decoded: ArchitectureDocumentV1;
  try {
    decoded = decodeDocument(JSON.parse(Buffer.from(raw).toString("utf8")) as unknown, `${label} bytes`);
  } catch (error) {
    throw new Error(`${label} bytes are invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (serializeCanonicalArchitectureDocument(decoded) !== serializeCanonicalArchitectureDocument(document)) {
    throw new Error(`${label} bytes do not contain the supplied Canon document`);
  }
}

function validateStoredJsonBytes(value: StoredBytes, expectedCanonical: string, label: string): void {
  let actualCanonical: string;
  try {
    actualCanonical = canonicalizeJson(JSON.parse(Buffer.from(bytes(value)).toString("utf8")));
  } catch (error) {
    throw new Error(`${label} bytes are invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (actualCanonical !== expectedCanonical) throw new Error(`${label} bytes do not contain the supplied record`);
}

function isSuccessfulPromotionTransition(value: PromotionTransitionResult | undefined): boolean {
  if (value === "promoted") return true;
  return isRecord(value) && value.state === "promoted";
}

function isCurrentChangeDigestValid(change: DesignChangeSet): boolean {
  if (
    !isRecord(change) ||
    !isRecord(change.base) ||
    !isRecord(change.target) ||
    !Array.isArray(change.target.operations)
  ) {
    return false;
  }
  const { digest: _digest, ...payload } = change;
  return digestJson(payload) === change.digest;
}

function hasSafeOperations(change: DesignChangeSet): boolean {
  const keys = new Set<string>();
  for (const operation of change.target.operations) {
    if (!isRecord(operation) || !["added", "modified", "removed"].includes(operation.kind as string)) return false;
    if (
      typeof operation.entryKey !== "string" ||
      operation.entryKey.trim().length === 0 ||
      keys.has(operation.entryKey)
    ) {
      return false;
    }
    keys.add(operation.entryKey);
    try {
      if (operation.kind === "added") digestJson(operation.value);
      if (operation.kind === "modified") {
        digestJson(operation.before);
        digestJson(operation.after);
      }
      if (operation.kind === "removed") digestJson(operation.before);
    } catch {
      return false;
    }
  }
  return true;
}

function failed(
  code: PromotionFailureCode,
  detail: string,
): { readonly value?: undefined; readonly failure: PromotionFailure } {
  return { failure: { code, detail } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
