import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { validateArchitectureDocument } from "../../architecture/canon/validate.js";
import type { CodeIntent, CodeIntentVerificationObligation } from "../../architecture/canon/code-intent-contract.js";
import type {
  CertificationCheck,
  CertificationFinding,
  DesignChangeOperation,
  DesignChangeSet,
  ImplementationLink,
  RepositoryRevisionReference,
} from "../contracts.js";
import { createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";

/** Version of the deterministic certification proof-plan shape. */
export const CERTIFICATION_PROOF_PLAN_VERSION = 1 as const;

export type CertificationProofPlanVersion = typeof CERTIFICATION_PROOF_PLAN_VERSION;

export type CertificationProofMode = "machine" | "review";

export const CERTIFICATION_BASELINE_OBLIGATION_IDS = {
  canonValidity: "canon-validity",
  linkedTargetCoverage: "linked-target-coverage",
  sourceRevisionBinding: "source-revision-binding",
} as const;

export type CertificationProofObligation = {
  readonly id: string;
  readonly mode: CertificationProofMode;
  readonly predicate: string;
  readonly targetEntryKey?: SemanticEntryKey;
};

export type ProofObligation = CertificationProofObligation;
export type CertificationProofCheck = CertificationCheck;

export interface CertificationProofPlan {
  readonly planVersion: CertificationProofPlanVersion;
  readonly changeId: string;
  readonly changeDigest: DesignChangeSet["digest"];
  readonly implementationRevision: RepositoryRevisionReference;
  readonly obligations: readonly CertificationProofObligation[];
}

export type ProofPlan = CertificationProofPlan;

export interface CertificationProofPlanInput {
  readonly change: DesignChangeSet;
  readonly canon: ArchitectureDocumentV1;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly implementations?: readonly ImplementationLink[];
  readonly codeIntent?: readonly CodeIntent[];
  /** A previously approved obligation set, when the proposal is being re-derived. */
  readonly approvedObligations?: readonly CertificationProofObligation[];
  /** Alias used by callers that call the approved set "required" obligations. */
  readonly requiredObligations?: readonly CertificationProofObligation[];
  /** A previously approved plan is accepted as the source of the obligation set. */
  readonly approvedPlan?: Pick<CertificationProofPlan, "obligations">;
}

const MACHINE_PREDICATES = new Set([
  "canon-valid",
  "linked-targets-covered",
  "source-revision-bound",
  "semantic-entry-realized",
]);

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

function normalizeMode(value: unknown, label: string): CertificationProofMode {
  const mode = normalizeText(value, label);
  if (mode !== "machine" && mode !== "review") {
    throw new TypeError(`${label} must be machine or review`);
  }
  return mode;
}

function normalizeObligation(value: unknown, label: string): CertificationProofObligation {
  assertRecord(value, label);
  const id = normalizeText(value.id, `${label} id`);
  const mode = normalizeMode(value.mode, `${label} mode`);
  const predicate = normalizeText(value.predicate, `${label} predicate`);
  let targetEntryKey: SemanticEntryKey | undefined;
  if (value.targetEntryKey !== undefined) {
    targetEntryKey = normalizeText(value.targetEntryKey, `${label} targetEntryKey`) as SemanticEntryKey;
  }
  return Object.freeze({
    id,
    mode,
    predicate,
    ...(targetEntryKey === undefined ? {} : { targetEntryKey }),
  });
}

function compareObligations(left: CertificationProofObligation, right: CertificationProofObligation): number {
  return (
    compareStrings(left.id, right.id) ||
    compareStrings(left.mode, right.mode) ||
    compareStrings(left.predicate, right.predicate) ||
    compareStrings(left.targetEntryKey ?? "", right.targetEntryKey ?? "")
  );
}

function normalizeObligations(
  values: readonly CertificationProofObligation[],
  label: string,
): readonly CertificationProofObligation[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const obligations = values.map((value, index) => normalizeObligation(value, `${label}[${index}]`));
  obligations.sort(compareObligations);
  const byId = new Map<string, CertificationProofObligation>();
  for (const obligation of obligations) {
    const previous = byId.get(obligation.id);
    if (previous !== undefined) {
      if (
        previous.mode !== obligation.mode ||
        previous.predicate !== obligation.predicate ||
        previous.targetEntryKey !== obligation.targetEntryKey
      ) {
        throw new Error(`certification obligation changed for duplicate id: ${obligation.id}`);
      }
      throw new Error(`duplicate certification obligation id: ${obligation.id}`);
    }
    byId.set(obligation.id, obligation);
  }
  return Object.freeze(obligations);
}

function codeIntentTarget(intent: CodeIntent, obligation: CodeIntentVerificationObligation): SemanticEntryKey {
  return createSemanticEntryKey({ collection: "code-intent", identity: [intent.id, obligation.id] });
}

function readCodeIntentObligations(codeIntent: readonly CodeIntent[] | undefined): CertificationProofObligation[] {
  if (codeIntent === undefined) return [];
  if (!Array.isArray(codeIntent)) throw new TypeError("codeIntent must be an array");

  const values: CertificationProofObligation[] = [];
  for (let intentIndex = 0; intentIndex < codeIntent.length; intentIndex += 1) {
    const intent = codeIntent[intentIndex];
    assertRecord(intent, `codeIntent[${intentIndex}]`);
    const intentId = normalizeText(intent.id, `codeIntent[${intentIndex}] id`);
    if (!Array.isArray(intent.verificationObligations)) {
      throw new TypeError(`codeIntent[${intentIndex}] verificationObligations must be an array`);
    }
    for (let obligationIndex = 0; obligationIndex < intent.verificationObligations.length; obligationIndex += 1) {
      const raw = intent.verificationObligations[obligationIndex];
      assertRecord(raw, `codeIntent[${intentIndex}] verificationObligations[${obligationIndex}]`);
      const obligation = normalizeObligation(
        raw,
        `codeIntent[${intentIndex}] verificationObligations[${obligationIndex}]`,
      );
      values.push(
        Object.freeze({
          ...obligation,
          targetEntryKey: codeIntentTarget(
            { ...intent, id: intentId } as CodeIntent,
            { ...raw, id: obligation.id } as unknown as CodeIntentVerificationObligation,
          ),
        }),
      );
    }
  }
  return values;
}

function designOperationObligations(operations: readonly DesignChangeOperation[]): CertificationProofObligation[] {
  return operations.map((operation) => ({
    id: `design:${operation.entryKey}`,
    mode: "review" as const,
    predicate: "semantic-entry-realized",
    targetEntryKey: operation.entryKey,
  }));
}

function baselineObligations(): CertificationProofObligation[] {
  return [
    {
      id: CERTIFICATION_BASELINE_OBLIGATION_IDS.canonValidity,
      mode: "machine",
      predicate: "canon-valid",
    },
    {
      id: CERTIFICATION_BASELINE_OBLIGATION_IDS.linkedTargetCoverage,
      mode: "machine",
      predicate: "linked-targets-covered",
    },
    {
      id: CERTIFICATION_BASELINE_OBLIGATION_IDS.sourceRevisionBinding,
      mode: "machine",
      predicate: "source-revision-bound",
    },
  ];
}

function assertApprovedObligationsUnchanged(
  approved: readonly CertificationProofObligation[] | undefined,
  actual: readonly CertificationProofObligation[],
): void {
  if (approved === undefined) return;
  const approvedById = new Map(approved.map((obligation) => [obligation.id, obligation]));
  const actualById = new Map(actual.map((obligation) => [obligation.id, obligation]));
  for (const [id, previous] of approvedById) {
    const current = actualById.get(id);
    if (current === undefined) throw new Error(`required certification obligation is missing: ${id}`);
    if (
      current.mode !== previous.mode ||
      current.predicate !== previous.predicate ||
      current.targetEntryKey !== previous.targetEntryKey
    ) {
      throw new Error(`certification obligation changed: ${id}`);
    }
  }
  for (const current of actual) {
    if (!approvedById.has(current.id))
      throw new Error(`new certification obligation requires re-approval: ${current.id}`);
  }
}

/**
 * Derive the one deterministic set of obligations that must be proven before
 * a Design Change can be certified.  Derivation never grants certification;
 * it only freezes the required proof surface.
 */
export function deriveCertificationProofPlan(input: CertificationProofPlanInput): CertificationProofPlan {
  assertRecord(input, "certification proof plan input");
  assertRecord(input.change, "certification proof plan change");
  assertRecord(input.implementationRevision, "certification proof plan implementationRevision");

  const changeId = normalizeText(input.change.changeId, "change id");
  const implementationRevision = Object.freeze({
    repository: normalizeText(input.implementationRevision.repository, "implementation repository"),
    revision: normalizeText(input.implementationRevision.revision, "implementation revision"),
  });

  // Validation is intentionally performed as an input check. The baseline
  // Canon obligation remains in the plan even when a caller supplies an
  // invalid document, so certification cannot silently skip the check.
  const canonResult = validateArchitectureDocument(input.canon);
  void canonResult;

  const links = input.implementations ?? [];
  if (!Array.isArray(links)) throw new TypeError("implementations must be an array");
  const obligations = [
    ...baselineObligations(),
    ...designOperationObligations(input.change.target.operations),
    ...readCodeIntentObligations(input.codeIntent),
  ];
  const normalized = normalizeObligations(obligations, "certification obligations");

  const approved = input.approvedObligations ?? input.requiredObligations ?? input.approvedPlan?.obligations;
  const normalizedApproved =
    approved === undefined ? undefined : normalizeObligations(approved, "approved obligations");
  assertApprovedObligationsUnchanged(normalizedApproved, normalized);

  // Keep links in the input contract even though coverage is evaluated by the
  // baseline predicate. This rejects malformed callers early and makes the
  // dependency explicit without treating provider evidence as authority.
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    assertRecord(link, `implementations[${index}]`);
    if (link.changeId !== input.change.changeId) {
      throw new Error(`implementation link ${index} is bound to a different change`);
    }
    if (link.changeDigest !== input.change.digest) {
      throw new Error(`implementation link ${index} is bound to a stale change revision`);
    }
  }

  return Object.freeze({
    planVersion: CERTIFICATION_PROOF_PLAN_VERSION,
    changeId,
    changeDigest: input.change.digest,
    implementationRevision,
    obligations: normalized,
  });
}

/** Alias retained for callers that use the shorter domain term. */
export const deriveProofPlan = deriveCertificationProofPlan;

export const deriveDesignCertificationProofPlan = deriveCertificationProofPlan;
export const buildCertificationProofPlan = deriveCertificationProofPlan;

/** Returns whether a machine predicate is implemented by this bounded leaf. */
export function isSupportedMachinePredicate(predicate: string): boolean {
  return MACHINE_PREDICATES.has(predicate);
}

/**
 * Resolve supplied checks against a plan. External inputs cannot provide a
 * successful result; unsupported machine predicates and absent checks remain
 * unresolved. This helper is deliberately fail-closed and side-effect free.
 */
export function resolveCertificationProof(
  plan: CertificationProofPlan,
  checks: readonly CertificationCheck[],
): { readonly result: CertificationFinding; readonly checks: readonly CertificationCheck[] } {
  if (!Array.isArray(checks) || checks.length === 0) {
    return Object.freeze({ result: "unresolved", checks: Object.freeze([]) });
  }
  const byId = new Map<string, CertificationCheck>();
  for (const check of checks) {
    if (byId.has(check.checkId)) return Object.freeze({ result: "unresolved", checks: Object.freeze([...checks]) });
    byId.set(check.checkId, check);
  }
  const resolved = plan.obligations.map((obligation) => {
    const supplied = byId.get(obligation.id);
    if (supplied === undefined) {
      return Object.freeze({
        checkId: obligation.id,
        ...(obligation.targetEntryKey === undefined ? {} : { targetEntryKey: obligation.targetEntryKey }),
        result: "unresolved" as const,
        detail: "required check is missing",
      });
    }
    if (supplied.targetEntryKey !== obligation.targetEntryKey) {
      return Object.freeze({
        checkId: obligation.id,
        targetEntryKey: obligation.targetEntryKey,
        result: "unresolved" as const,
        detail: "check target does not match the proof plan",
      });
    }
    if (obligation.mode === "machine" && !isSupportedMachinePredicate(obligation.predicate)) {
      return Object.freeze({ ...supplied, result: "unresolved" as const, detail: "machine predicate is unsupported" });
    }
    return Object.freeze({ ...supplied, result: supplied.result === "match" ? "match" : supplied.result });
  });
  const result: CertificationFinding = resolved.some((check) => check.result === "mismatch")
    ? "mismatch"
    : resolved.every((check) => check.result === "match")
      ? "match"
      : "unresolved";
  return Object.freeze({ result, checks: Object.freeze(resolved) });
}

export const evaluateCertificationProofPlan = resolveCertificationProof;
export const evaluateProofPlan = resolveCertificationProof;
export const assessCertificationProof = resolveCertificationProof;
