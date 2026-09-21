import type {
  CertificationCheck,
  CertificationEvidence,
  CertificationFinding,
  DesignChangeSet,
  ExternalIssueReference,
  ImplementationLink,
  RepositoryRevisionReference,
} from "../contracts.js";
import type { Digest } from "../digest.js";
import { digestJson } from "../digest.js";
import type { SemanticEntryKey } from "../entry-key.js";

/** The proof-plan shape is structural so this leaf does not own plan derivation. */
export interface CertificationProofRequirement {
  readonly id: string;
  readonly mode: "machine" | "review" | string;
  readonly predicate?: string;
  readonly targetEntryKey?: SemanticEntryKey;
}

export interface CertificationProofPlanLike {
  readonly planVersion?: number;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly obligations: readonly CertificationProofRequirement[];
  /** Optional convenience binding emitted by a plan adapter. */
  readonly targetCanonDigest?: Digest;
}

export type CertificationProofPlan = CertificationProofPlanLike;

/** A review check is evidence, not an authority to alter a proof plan. */
export interface HumanCertificationReview {
  readonly reviewId: string;
  readonly changeId: string;
  readonly changeDigest?: Digest;
  readonly proposalDigest?: Digest;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly checks?: readonly CertificationCheck[];
  readonly checkId?: string;
  readonly obligationId?: string;
  readonly targetEntryKey?: SemanticEntryKey;
  readonly result?: CertificationFinding;
  readonly decision?: "approved" | "changes-requested" | "rejected";
  readonly actor?: string;
  readonly reason?: string;
  readonly timestamp?: string;
}

export interface CertificationBindingDigests {
  /** Digest of the approved Design Change proposal. */
  readonly proposalDigest: Digest;
  /** Digest of the approved target Canon. */
  readonly targetCanonDigest: Digest;
  /** Digest of the exact, sorted Implementation links used by the run. */
  readonly linkageDigest: Digest;
  /** Digest of the implementation subject set used by the run. */
  readonly implementationSubjectDigest: Digest;
  /** Digest of the exact, sorted checker output. */
  readonly checkerDigest: Digest;
}

/** Persistable certification record with all freshness bindings made explicit. */
export interface CertificationRecord extends CertificationEvidence, CertificationBindingDigests {
  readonly implementationSubject: readonly ExternalIssueReference[];
}

export interface CertificationAggregationInput {
  readonly plan: CertificationProofPlanLike;
  readonly change?: DesignChangeSet;
  readonly targetCanon?: unknown;
  readonly targetCanonDigest?: Digest;
  readonly implementationLinks?: readonly ImplementationLink[];
  /** Alias accepted by storage adapters that call links the linkage set. */
  readonly links?: readonly ImplementationLink[];
  readonly implementationSubject?: ExternalIssueReference | readonly ExternalIssueReference[];
  readonly machineChecks?: readonly CertificationCheck[] | { readonly checks?: readonly CertificationCheck[] };
  readonly machine?: readonly CertificationCheck[] | { readonly checks?: readonly CertificationCheck[] };
  readonly humanReviews?: readonly HumanCertificationReview[];
  readonly reviews?: readonly HumanCertificationReview[];
  readonly humanReview?: HumanCertificationReview;
  /** Alias for callers that have already flattened human review checks. */
  readonly humanChecks?: readonly CertificationCheck[];
  readonly certificationId?: string;
  readonly recordedAt?: string;
}

export interface CertificationAggregationResult {
  readonly result: CertificationFinding;
  readonly checks: readonly CertificationCheck[];
  readonly evidence: CertificationRecord;
  readonly digests: CertificationBindingDigests;
}

export type CertificationResult = CertificationAggregationResult;

export interface CertificationFreshnessInput {
  readonly certification: CertificationEvidence & Partial<CertificationBindingDigests>;
  readonly currentChangeDigest?: Digest;
  readonly currentProposalDigest?: Digest;
  readonly currentTargetCanonDigest?: Digest;
  readonly currentImplementationRevision?: RepositoryRevisionReference;
  readonly currentLinks?: readonly ImplementationLink[];
  readonly currentImplementationSubject?: ExternalIssueReference | readonly ExternalIssueReference[];
  readonly currentChecks?: readonly CertificationCheck[];
  /** A repository adapter may provide an exact list of changed paths. */
  readonly changedPaths?: readonly (string | { readonly path: string; readonly kind?: string })[];
  readonly changedFiles?: readonly (string | { readonly path: string; readonly kind?: string })[];
  readonly changedKinds?: readonly string[];
  readonly sourceChanged?: boolean;
  readonly modeChanged?: boolean;
  readonly lockfileChanged?: boolean;
  readonly recordOnlyChanged?: boolean;
}

export interface CertificationFreshnessResult {
  readonly fresh: boolean;
  readonly stale: boolean;
  readonly explainable: boolean;
  readonly reasons: readonly string[];
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameRevision(left: RepositoryRevisionReference, right: RepositoryRevisionReference): boolean {
  return left.repository === right.repository && left.revision === right.revision;
}

function sortChecks(checks: readonly CertificationCheck[]): CertificationCheck[] {
  return [...checks].sort((left, right) => {
    const byId = compareOrdinal(left.checkId, right.checkId);
    if (byId !== 0) return byId;
    const byTarget = compareOrdinal(left.targetEntryKey ?? "", right.targetEntryKey ?? "");
    if (byTarget !== 0) return byTarget;
    return compareOrdinal(left.result, right.result);
  });
}

function sortLinks(links: readonly ImplementationLink[]): readonly ImplementationLink[] {
  return [...links].sort((left, right) => compareOrdinal(left.linkId, right.linkId));
}

function implementationKey(value: ExternalIssueReference): string {
  return JSON.stringify([value.repositoryHost, value.repositoryId, value.number]);
}

function sortedSubjects(
  links: readonly ImplementationLink[],
  supplied: ExternalIssueReference | readonly ExternalIssueReference[] | undefined,
): readonly ExternalIssueReference[] {
  const values =
    supplied === undefined ? links.map((link) => link.implementation) : Array.isArray(supplied) ? supplied : [supplied];
  const byKey = new Map<string, ExternalIssueReference>();
  for (const subject of values) byKey.set(implementationKey(subject), subject);
  return [...byKey.values()].sort((left, right) => compareOrdinal(implementationKey(left), implementationKey(right)));
}

function checksDigest(checks: readonly CertificationCheck[]): Digest {
  return digestJson(sortChecks(checks)) as Digest;
}

function linksDigest(links: readonly ImplementationLink[]): Digest {
  return digestJson(sortLinks(links)) as Digest;
}

function subjectsDigest(subjects: readonly ExternalIssueReference[]): Digest {
  return digestJson(subjects) as Digest;
}

function targetCanonDigest(input: CertificationAggregationInput): Digest {
  if (input.targetCanonDigest !== undefined) return input.targetCanonDigest;
  if (input.plan.targetCanonDigest !== undefined) return input.plan.targetCanonDigest;
  if (input.change !== undefined) return input.change.target.targetCanonDigest;
  if (input.targetCanon !== undefined) return digestJson(input.targetCanon) as Digest;
  // A missing target is represented by a stable digest and is made unresolved
  // by the target-canon binding check below. It is never treated as success.
  return digestJson(null) as Digest;
}

function check(
  checkId: string,
  result: CertificationFinding,
  detail: string,
  targetEntryKey?: SemanticEntryKey,
): CertificationCheck {
  return {
    checkId,
    result,
    detail,
    ...(targetEntryKey === undefined ? {} : { targetEntryKey }),
  };
}

function resultOf(checks: readonly CertificationCheck[]): CertificationFinding {
  if (checks.some((entry) => entry.result === "mismatch")) return "mismatch";
  if (checks.some((entry) => entry.result === "unresolved")) return "unresolved";
  // Empty output is never proof of a match.
  return checks.length === 0 ? "unresolved" : "match";
}

function readChecks(value: CertificationAggregationInput["machineChecks"]): readonly CertificationCheck[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : ((value as { readonly checks?: readonly CertificationCheck[] }).checks ?? []);
}

function reviewChecks(review: HumanCertificationReview): readonly CertificationCheck[] {
  if (review.checks !== undefined) return review.checks;
  const checkId = review.checkId ?? review.obligationId;
  if (checkId === undefined || review.result === undefined) return [];
  return [
    {
      checkId,
      result: review.result,
      ...(review.targetEntryKey === undefined ? {} : { targetEntryKey: review.targetEntryKey }),
    },
  ];
}

function reviewBindingValid(review: HumanCertificationReview, plan: CertificationProofPlanLike): boolean {
  const proposalDigest = review.changeDigest ?? review.proposalDigest;
  return (
    review.changeId === plan.changeId &&
    proposalDigest === plan.changeDigest &&
    sameRevision(review.implementationRevision, plan.implementationRevision)
  );
}

function addUnexpectedChecks(
  checks: CertificationCheck[],
  seen: Set<string>,
  supplied: readonly CertificationCheck[],
  expected: ReadonlyMap<string, CertificationProofRequirement>,
  source: "machine" | "review",
): void {
  for (const entry of supplied) {
    if (seen.has(`${source}\u0000${entry.checkId}`)) {
      checks.push(check(`duplicate:${source}:${entry.checkId}`, "unresolved", "duplicate proof result id"));
      continue;
    }
    seen.add(`${source}\u0000${entry.checkId}`);
    const requirement = expected.get(entry.checkId);
    if (requirement === undefined) {
      checks.push(
        check(`unexpected:${source}:${entry.checkId}`, "unresolved", "proof result is not required by the plan"),
      );
    } else if (requirement.mode !== source) {
      checks.push(
        check(
          `wrong-mode:${source}:${entry.checkId}`,
          "unresolved",
          `proof result uses ${source} evidence for a ${requirement.mode} obligation`,
          requirement.targetEntryKey,
        ),
      );
    }
  }
}

/**
 * Aggregate the frozen proof plan, machine checks, and explicitly bound human
 * review. Machine evidence and human evidence are intentionally separate: a
 * human review can discharge only a review-mode obligation.
 */
export function aggregateCertification(input: CertificationAggregationInput): CertificationAggregationResult {
  const plan = input.plan;
  const links = input.implementationLinks ?? input.links ?? [];
  const sortedLinks = sortLinks(links);
  const subjects = sortedSubjects(sortedLinks, input.implementationSubject);
  const machine = readChecks(input.machineChecks ?? input.machine);
  const reviews = [
    ...(input.humanReviews ?? input.reviews ?? []),
    ...(input.humanReview === undefined ? [] : [input.humanReview]),
  ];
  const checks: CertificationCheck[] = [];
  const obligations = Array.isArray(plan?.obligations) ? plan.obligations : [];
  const expected = new Map<string, CertificationProofRequirement>();

  if (plan === undefined || !Array.isArray(plan.obligations) || obligations.length === 0) {
    checks.push(check("proof-plan", "unresolved", "required proof plan is missing or empty"));
  }
  for (const obligation of obligations) {
    const previous = expected.get(obligation.id);
    if (previous !== undefined) {
      checks.push(
        check(`duplicate-plan:${obligation.id}`, "unresolved", "proof plan contains duplicate obligation id"),
      );
    } else {
      expected.set(obligation.id, obligation);
    }
  }

  const seen = new Set<string>();
  addUnexpectedChecks(checks, seen, machine, expected, "machine");
  // Flattened human checks are accepted only alongside a binding review. A
  // bare check list has no proposal/revision identity and therefore cannot
  // satisfy a review-mode obligation.
  if ((input.humanChecks?.length ?? 0) > 0 && reviews.length === 0) {
    checks.push(check("review-binding", "unresolved", "human checks have no proposal and implementation binding"));
  }
  addUnexpectedChecks(checks, seen, input.humanChecks ?? [], expected, "review");
  for (const review of reviews) {
    if (!reviewBindingValid(review, plan)) {
      checks.push(
        check(
          `review-binding:${review.reviewId}`,
          "unresolved",
          "human review is not bound to this proposal and implementation revision",
        ),
      );
    }
    addUnexpectedChecks(checks, seen, reviewChecks(review), expected, "review");
  }

  const machineById = new Map(machine.map((entry) => [entry.checkId, entry]));
  const humanById = new Map<string, CertificationCheck>();
  for (const review of reviews) {
    if (!reviewBindingValid(review, plan)) continue;
    for (const entry of reviewChecks(review)) {
      if (humanById.has(entry.checkId)) {
        checks.push(check(`duplicate-review:${entry.checkId}`, "unresolved", "duplicate human proof result id"));
      } else {
        humanById.set(entry.checkId, entry);
      }
    }
  }
  if (reviews.some((review) => reviewBindingValid(review, plan))) {
    for (const entry of input.humanChecks ?? []) {
      if (!humanById.has(entry.checkId)) humanById.set(entry.checkId, entry);
    }
  }

  for (const obligation of obligations) {
    const supplied =
      obligation.mode === "machine"
        ? machineById.get(obligation.id)
        : obligation.mode === "review"
          ? humanById.get(obligation.id)
          : undefined;
    if (supplied === undefined) {
      checks.push(
        check(
          obligation.id,
          "unresolved",
          obligation.mode === "machine" || obligation.mode === "review"
            ? "required proof result is missing"
            : `unsupported proof mode: ${obligation.mode}`,
          obligation.targetEntryKey,
        ),
      );
      continue;
    }
    if (supplied.targetEntryKey !== obligation.targetEntryKey) {
      checks.push(
        check(obligation.id, "unresolved", "proof result target does not match the plan", obligation.targetEntryKey),
      );
      continue;
    }
    checks.push({ ...supplied, checkId: obligation.id });
  }

  const invalidLinks = sortedLinks.filter(
    (link) => link.changeId !== plan.changeId || link.changeDigest !== plan.changeDigest,
  );
  if (invalidLinks.length > 0) {
    checks.push(check("linked-target-coverage", "unresolved", "one or more Implementation links are stale"));
  }
  const hasTargetBinding =
    input.targetCanonDigest !== undefined ||
    input.plan.targetCanonDigest !== undefined ||
    input.change !== undefined ||
    input.targetCanon !== undefined;
  if (!hasTargetBinding) checks.push(check("target-canon-binding", "unresolved", "target Canon digest is missing"));
  if (input.targetCanon !== undefined && digestJson(input.targetCanon) !== targetCanonDigest(input)) {
    checks.push(check("target-canon-binding", "mismatch", "target Canon bytes do not match the bound digest"));
  }

  const orderedChecks = Object.freeze(sortChecks(checks));
  const result = resultOf(orderedChecks);
  const targetDigest = targetCanonDigest(input);
  const digests: CertificationBindingDigests = Object.freeze({
    proposalDigest: plan.changeDigest,
    targetCanonDigest: targetDigest,
    linkageDigest: linksDigest(sortedLinks),
    implementationSubjectDigest: subjectsDigest(subjects),
    checkerDigest: checksDigest(orderedChecks),
  });
  const evidence: CertificationRecord = Object.freeze({
    certificationId: input.certificationId ?? `certification:${plan.changeId}:${plan.implementationRevision.revision}`,
    changeId: plan.changeId,
    changeDigest: plan.changeDigest,
    implementationRevision: { ...plan.implementationRevision },
    result,
    checks: orderedChecks,
    recordedAt: input.recordedAt ?? "1970-01-01T00:00:00.000Z",
    ...digests,
    implementationSubject: subjects,
  });
  return Object.freeze({ result, checks: orderedChecks, evidence, digests });
}

function changedPathKind(value: string | { readonly path: string; readonly kind?: string }): string {
  if (typeof value !== "string" && value.kind !== undefined) return value.kind.toLowerCase();
  const path = typeof value === "string" ? value : value.path;
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/u.test(path)) return "lockfile";
  if (/(^|\/)(package\.json|tsconfig(?:\.[^/]+)?\.json|\.nvmrc|\.tool-versions)$/u.test(path)) return "mode";
  if (/(^|\/)(docs?|\.github|records?|audit)(\/|\.|$)/iu.test(path)) return "record";
  return "source";
}

function currentDigestForLinks(links: readonly ImplementationLink[] | undefined): Digest | undefined {
  return links === undefined ? undefined : linksDigest(sortLinks(links));
}

function currentDigestForSubjects(
  links: readonly ImplementationLink[] | undefined,
  subjects: ExternalIssueReference | readonly ExternalIssueReference[] | undefined,
): Digest | undefined {
  return links === undefined && subjects === undefined
    ? undefined
    : subjectsDigest(sortedSubjects(links ?? [], subjects));
}

/**
 * Compare a stored certification with current proposal/repository evidence.
 * A certification remains bound to its original tested revision; a newer HEAD
 * is never silently substituted. Record-only changes are reported as
 * explainable when no semantic binding changed.
 */
export function checkCertificationFreshness(input: CertificationFreshnessInput): CertificationFreshnessResult {
  const certification = input.certification;
  const reasons: string[] = [];
  let stale = false;
  let explainable = false;
  const changed = [...(input.changedPaths ?? []), ...(input.changedFiles ?? [])];
  const kinds = [...changed.map(changedPathKind), ...(input.changedKinds ?? []).map((kind) => kind.toLowerCase())];
  const recordOnly = input.recordOnlyChanged === true || (kinds.length > 0 && kinds.every((kind) => kind === "record"));
  const currentProposal = input.currentChangeDigest ?? input.currentProposalDigest;
  if (currentProposal !== undefined && currentProposal !== certification.changeDigest) {
    stale = true;
    reasons.push("proposal-changed");
  }
  if (input.currentTargetCanonDigest !== undefined) {
    if (certification.targetCanonDigest === undefined) {
      stale = true;
      reasons.push("target-canon-binding-missing");
    } else if (input.currentTargetCanonDigest !== certification.targetCanonDigest) {
      stale = true;
      reasons.push("target-canon-changed");
    }
  }
  if (
    input.currentImplementationRevision !== undefined &&
    !sameRevision(input.currentImplementationRevision, certification.implementationRevision)
  ) {
    if (recordOnly) {
      explainable = true;
      reasons.push("record-only-revision-change");
    } else {
      stale = true;
      reasons.push("implementation-revision-changed");
    }
  }
  const currentLinkDigest = currentDigestForLinks(input.currentLinks);
  if (currentLinkDigest !== undefined) {
    if (certification.linkageDigest === undefined) {
      stale = true;
      reasons.push("implementation-linkage-binding-missing");
    } else if (currentLinkDigest !== certification.linkageDigest) {
      stale = true;
      reasons.push("implementation-linkage-changed");
    }
  }
  const currentSubjectDigest = currentDigestForSubjects(input.currentLinks, input.currentImplementationSubject);
  if (currentSubjectDigest !== undefined) {
    if (certification.implementationSubjectDigest === undefined) {
      stale = true;
      reasons.push("implementation-subject-binding-missing");
    } else if (currentSubjectDigest !== certification.implementationSubjectDigest) {
      stale = true;
      reasons.push("implementation-subject-changed");
    }
  }
  if (input.currentChecks !== undefined) {
    if (certification.checkerDigest === undefined) {
      stale = true;
      reasons.push("checker-binding-missing");
    } else if (checksDigest(input.currentChecks) !== certification.checkerDigest) {
      stale = true;
      reasons.push("checker-output-changed");
    }
  }

  if (input.sourceChanged === true || kinds.includes("source")) {
    stale = true;
    reasons.push("source-changed");
  }
  if (input.modeChanged === true || kinds.includes("mode")) {
    stale = true;
    reasons.push("execution-mode-changed");
  }
  if (input.lockfileChanged === true || kinds.includes("lockfile")) {
    stale = true;
    reasons.push("lockfile-changed");
  }
  if (!stale && recordOnly) {
    explainable = true;
    reasons.push("record-only-change");
  }
  return Object.freeze({
    fresh: !stale,
    stale,
    explainable,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

export const certify = aggregateCertification;
export const aggregateDesignCertification = aggregateCertification;
export const evaluateCertification = aggregateCertification;
export const isCertificationFresh = (input: CertificationFreshnessInput): boolean =>
  checkCertificationFreshness(input).fresh;
export const evaluateCertificationFreshness = checkCertificationFreshness;
