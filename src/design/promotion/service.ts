import { canonicalizeJson, digestJson } from "../digest.js";
import { serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import type {
  CanonRevisionReference,
  DesignChangeSet,
  DesignIntentLifecycleRecord,
  RepositoryRevisionReference,
} from "../contracts.js";
import {
  preflightPromotion,
  type CurrentCanonSnapshot,
  type PromotionPreflightResult,
  type PromotionReceipt,
  type PromotionTransitionResult,
  type PromotionWritePlan,
  type StoredBytes,
} from "./plan.js";
import type { FileDigest } from "../storage/transaction.js";
import type { StorageWritePlan } from "../storage/store.js";
import type { TransactionResult } from "../storage/transaction.js";
import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";

/** Conventional files owned by the promotion transaction. */
export interface PromotionArtifactPaths {
  readonly currentCanon: string;
  readonly lifecycle: string;
  readonly receipt: string;
}

export const DEFAULT_PROMOTION_ARTIFACT_PATHS: PromotionArtifactPaths = Object.freeze({
  currentCanon: ".wabachi/architecture.json",
  lifecycle: ".wabachi/changes/{changeId}/lifecycle.json",
  receipt: ".wabachi/changes/{changeId}/promotion-receipt.json",
});

/** A stable artifact read; bytes are the CAS preimage and must not be regenerated. */
export interface PromotionArtifact<T> {
  readonly value: T;
  readonly bytes: StoredBytes;
  readonly byteDigest: FileDigest;
}

export interface PromotionCurrentArtifact extends CurrentCanonSnapshot {
  readonly bytes: StoredBytes;
}

/**
 * The production adapter boundary for promotion. It deliberately contains no
 * Git mutator. Implementations normally delegate change/lifecycle reads and
 * commit to the repository StorePort and expose the current Canon and receipt
 * as stable byte reads.
 */
export interface PromotionStorePort {
  readCurrent(): Promise<PromotionCurrentArtifact>;
  readChangeArtifact(changeId: string): Promise<PromotionArtifact<DesignChangeSet> | undefined>;
  readLifecycleArtifact(changeId: string): Promise<PromotionArtifact<DesignIntentLifecycleRecord> | undefined>;
  readReceiptArtifact(changeId: string): Promise<PromotionArtifact<PromotionReceipt> | undefined>;
  commit(plans: readonly StorageWritePlan[]): Promise<TransactionResult>;
  paths?: (changeId: string) => PromotionArtifactPaths;
}

export interface PromoteDesignInput {
  readonly changeId: string;
  /** The exact Canon certified by the persisted certification evidence. */
  readonly certifiedTarget: ArchitectureDocumentV1;
  /** Exact certified target bytes, when the certification producer retained them. */
  readonly certifiedTargetBytes?: StoredBytes;
  /** Successful output of the sole lifecycle authority's PROMOTE transition. */
  readonly promotionTransition: PromotionTransitionResult;
  /** Optional freshness assertion for the certification's implementation revision. */
  readonly implementationRevision?: RepositoryRevisionReference;
  readonly requiredCheckIds?: readonly string[];
}

export interface PromotionSuccess {
  readonly ok: true;
  readonly idempotent: boolean;
  readonly receipt: PromotionReceipt;
  readonly transaction?: TransactionResult;
}

export type PromotionExecutionResult = PromotionSuccess;

export type PromotionErrorCode =
  | "invalid-input"
  | "change-not-found"
  | "lifecycle-not-found"
  | "receipt-conflict"
  | "promotion-rejected"
  | "receipt-verification";

/** Stable application error; transaction/provider failures remain their original error. */
export class PromotionServiceError extends Error {
  readonly code: PromotionErrorCode;

  constructor(code: PromotionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PromotionServiceError";
    this.code = code;
  }
}

/** Executes one certified promotion against a byte-CAS transaction boundary. */
export class DesignPromotionService {
  private readonly store: PromotionStorePort;

  constructor(store: PromotionStorePort) {
    this.store = store;
  }

  async promote(input: PromoteDesignInput): Promise<PromotionSuccess> {
    assertInput(input);

    // All facts are loaded before planning. In particular, an existing receipt
    // is inspected first so a completed retry cannot be mistaken for a stale
    // proposal after the current Canon has advanced.
    const [current, changeArtifact, lifecycleArtifact, receiptArtifact] = await Promise.all([
      this.store.readCurrent(),
      this.store.readChangeArtifact(input.changeId),
      this.store.readLifecycleArtifact(input.changeId),
      this.store.readReceiptArtifact(input.changeId),
    ]);
    const change = requireArtifact(changeArtifact, "change-not-found", `Design Change ${input.changeId} was not found`);
    const lifecycle = requireArtifact(
      lifecycleArtifact,
      "lifecycle-not-found",
      `lifecycle record for ${input.changeId} was not found`,
    );

    if (receiptArtifact !== undefined) {
      return this.verifyIdempotentRetry(input, current, change.value, lifecycle.value, receiptArtifact);
    }

    const preflight = preflightPromotion({
      current,
      change: change.value,
      lifecycle: lifecycle.value,
      certifiedTarget: input.certifiedTarget,
      certifiedTargetBytes: input.certifiedTargetBytes,
      promotionTransition: input.promotionTransition,
      lifecycleBytes: lifecycle.bytes,
      implementationRevision: input.implementationRevision,
      requiredCheckIds: input.requiredCheckIds,
    });
    if (!preflight.ok) throw promotionFailure(preflight);

    // There is intentionally no retry loop. A writer conflict means the
    // preflight snapshot is obsolete and must be loaded and planned again by a
    // new invocation; retrying this old plan could overwrite a newer Canon.
    const transaction = await this.store.commit(this.transactionPlans(input.changeId, preflight.plan));
    const verified = await this.verifyCommitted(input.changeId, preflight.plan);
    return { ok: true, idempotent: false, receipt: verified, transaction };
  }

  async execute(input: PromoteDesignInput): Promise<PromotionSuccess> {
    return this.promote(input);
  }

  private transactionPlans(changeId: string, plan: PromotionWritePlan): readonly StorageWritePlan[] {
    const paths = this.store.paths?.(changeId) ?? defaultPaths(changeId);
    return [
      {
        path: paths.currentCanon,
        expectedDigest: plan.writes[0].expectedDigest,
        nextBytes: toBytes(plan.writes[0].bytes),
      },
      {
        path: paths.lifecycle,
        expectedDigest: plan.writes[1].expectedDigest,
        nextBytes: toBytes(plan.writes[1].bytes),
      },
      {
        path: paths.receipt,
        expectedDigest: null,
        nextBytes: toBytes(plan.writes[2].bytes),
      },
    ];
  }

  private async verifyCommitted(changeId: string, plan: PromotionWritePlan): Promise<PromotionReceipt> {
    const [current, lifecycle, receipt] = await Promise.all([
      this.store.readCurrent(),
      this.store.readLifecycleArtifact(changeId),
      this.store.readReceiptArtifact(changeId),
    ]);
    if (lifecycle === undefined || receipt === undefined) {
      throw new PromotionServiceError(
        "receipt-verification",
        `promotion ${changeId} committed without a verifiable lifecycle receipt`,
      );
    }
    assertExactBytes(current.bytes, plan.nextCurrentCanonBytes, "current Canon");
    assertExactJson(lifecycle.bytes, plan.nextLifecycle, "promoted lifecycle record");
    assertReceipt(receipt, plan.receipt, "committed promotion receipt");
    if (current.revision.canonDigest !== plan.nextCurrent.canonDigest || lifecycle.value.state !== "promoted") {
      throw new PromotionServiceError(
        "receipt-verification",
        `promotion ${changeId} receipt is not bound to the resulting current Canon and terminal lifecycle`,
      );
    }
    return receipt.value;
  }

  private async verifyIdempotentRetry(
    input: PromoteDesignInput,
    current: PromotionCurrentArtifact,
    change: DesignChangeSet,
    lifecycle: DesignIntentLifecycleRecord,
    receipt: PromotionArtifact<PromotionReceipt>,
  ): Promise<PromotionSuccess> {
    const targetDigest = digestJson(input.certifiedTarget);
    const certification = lifecycle.certification;
    if (
      certification === undefined ||
      receipt.value.changeId !== change.changeId ||
      receipt.value.changeDigest !== change.digest ||
      receipt.value.certificationId !== certification.certificationId ||
      receipt.value.promotedCanonDigest !== targetDigest ||
      !sameCanonRevision(receipt.value.previousCurrent, change.base) ||
      !sameRevision(receipt.value.implementationRevision, certification.implementationRevision)
    ) {
      throw new PromotionServiceError(
        "receipt-conflict",
        `promotion receipt for ${input.changeId} does not match the requested proposal or certification`,
      );
    }
    assertReceipt(receipt, receipt.value, "stored promotion receipt");
    assertExactBytes(
      current.bytes,
      input.certifiedTargetBytes ?? serializeCanonicalArchitectureDocument(input.certifiedTarget),
      "promoted current Canon",
    );
    if (current.revision.canonDigest !== receipt.value.promotedCanonDigest || lifecycle.state !== "promoted") {
      throw new PromotionServiceError(
        "receipt-conflict",
        `promotion receipt for ${input.changeId} is not backed by a terminal current Canon`,
      );
    }
    return { ok: true, idempotent: true, receipt: receipt.value };
  }
}

export class ProductionPromotionService extends DesignPromotionService {}
export const executePromotion = (store: PromotionStorePort, input: PromoteDesignInput): Promise<PromotionSuccess> =>
  new DesignPromotionService(store).promote(input);

function assertInput(input: PromoteDesignInput): void {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof input.changeId !== "string" ||
    input.changeId.trim().length === 0 ||
    input.certifiedTarget === undefined ||
    input.promotionTransition === undefined
  ) {
    throw new PromotionServiceError("invalid-input", "promotion requires a changeId, certified target, and transition");
  }
}

function requireArtifact<T>(
  artifact: PromotionArtifact<T> | undefined,
  code: "change-not-found" | "lifecycle-not-found",
  message: string,
): PromotionArtifact<T> {
  if (artifact === undefined) throw new PromotionServiceError(code, message);
  return artifact;
}

function promotionFailure(result: Extract<PromotionPreflightResult, { readonly ok: false }>): PromotionServiceError {
  return new PromotionServiceError("promotion-rejected", `${result.failure.code}: ${result.failure.detail}`);
}

function defaultPaths(changeId: string): PromotionArtifactPaths {
  return {
    currentCanon: DEFAULT_PROMOTION_ARTIFACT_PATHS.currentCanon,
    lifecycle: DEFAULT_PROMOTION_ARTIFACT_PATHS.lifecycle.replace("{changeId}", changeId),
    receipt: DEFAULT_PROMOTION_ARTIFACT_PATHS.receipt.replace("{changeId}", changeId),
  };
}

function toBytes(value: StoredBytes): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value);
}

function sameRevision(left: RepositoryRevisionReference, right: RepositoryRevisionReference): boolean {
  return left.repository === right.repository && left.revision === right.revision;
}

function sameCanonRevision(left: CanonRevisionReference, right: CanonRevisionReference): boolean {
  return (
    left.repositoryRevision === right.repositoryRevision &&
    left.canonVersion === right.canonVersion &&
    left.canonDigest === right.canonDigest
  );
}

function assertExactBytes(actual: StoredBytes, expected: StoredBytes, label: string): void {
  const left = toBytes(actual);
  const right = toBytes(expected);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new PromotionServiceError("receipt-verification", `${label} bytes do not match the certified post-image`);
  }
}

function assertExactJson(actual: StoredBytes, expected: unknown, label: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(toBytes(actual)).toString("utf8")) as unknown;
  } catch (error) {
    throw new PromotionServiceError("receipt-verification", `${label} is not valid JSON`, { cause: error });
  }
  if (canonicalizeJson(parsed) !== canonicalizeJson(expected)) {
    throw new PromotionServiceError("receipt-verification", `${label} does not match the certified post-image`);
  }
}

function assertReceipt(artifact: PromotionArtifact<PromotionReceipt>, expected: PromotionReceipt, label: string): void {
  assertExactJson(artifact.bytes, expected, label);
  const payload = {
    event: artifact.value.event,
    changeId: artifact.value.changeId,
    changeDigest: artifact.value.changeDigest,
    certificationId: artifact.value.certificationId,
    implementationRevision: artifact.value.implementationRevision,
    previousCurrent: artifact.value.previousCurrent,
    promotedCanonDigest: artifact.value.promotedCanonDigest,
    recordedAt: artifact.value.recordedAt,
  };
  if (artifact.value.receiptId !== digestJson(payload)) {
    throw new PromotionServiceError("receipt-verification", `${label} has an invalid receipt digest`);
  }
}
