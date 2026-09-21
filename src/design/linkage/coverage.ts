import type {
  CertificationFinding,
  DesignChangeSet,
  ExternalIssueReference,
  ImplementationLink,
  RepositoryRevisionReference,
} from "../contracts.js";
import type { GitPort } from "../ports.js";
import type { Digest } from "../digest.js";
import type { SemanticEntryKey } from "../entry-key.js";

/** Evidence that an external implementation completed at one exact repository revision. */
export interface ImplementationCompletionEvidence {
  readonly evidenceId: string;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly implementation: ExternalIssueReference;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly result: CertificationFinding;
}

export type CoverageFindingKind =
  | "missing-target"
  | "unknown-target"
  | "stale-link"
  | "stale-evidence"
  | "missing-completion-evidence"
  | "non-integrated-revision"
  | "ambiguous-completion-evidence";

export interface CoverageFinding {
  readonly kind: CoverageFindingKind;
  readonly detail: string;
  readonly targetEntryKey?: SemanticEntryKey;
  readonly linkId?: string;
  readonly evidenceId?: string;
  readonly implementation?: ExternalIssueReference;
}

export interface CoverageInput {
  readonly change: DesignChangeSet;
  readonly links: readonly ImplementationLink[];
  readonly completionEvidence?: readonly ImplementationCompletionEvidence[];
  /**
   * The revision at which the union of implementation leaves is certified. It is
   * required when leaves do not share one revision.
   */
  readonly integrationRevision?: RepositoryRevisionReference;
  readonly git?: GitPort;
}

export interface CoverageResult {
  /** True only when every proposed target has valid, revision-bound evidence. */
  readonly complete: boolean;
  /** `match` is the only result that can be used as completion evidence. */
  readonly result: CertificationFinding;
  readonly targetEntryKeys: readonly SemanticEntryKey[];
  /** All targets named by links, including targets from stale links. */
  readonly linkedEntryKeys: readonly SemanticEntryKey[];
  readonly coveredEntryKeys: readonly SemanticEntryKey[];
  readonly missingEntryKeys: readonly SemanticEntryKey[];
  readonly unknownEntryKeys: readonly SemanticEntryKey[];
  readonly staleLinkIds: readonly string[];
  readonly staleEvidenceIds: readonly string[];
  readonly findings: readonly CoverageFinding[];
}

export interface TargetCoverageResult {
  readonly targetEntryKeys: readonly SemanticEntryKey[];
  readonly linkedEntryKeys: readonly SemanticEntryKey[];
  readonly coveredEntryKeys: readonly SemanticEntryKey[];
  readonly missingEntryKeys: readonly SemanticEntryKey[];
  readonly unknownEntryKeys: readonly SemanticEntryKey[];
  readonly staleLinkIds: readonly string[];
  readonly findings: readonly CoverageFinding[];
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareOrdinal) as T[];
}

function implementationKey(implementation: ExternalIssueReference): string {
  // repository is deliberately excluded: it is a mutable locator, not identity.
  return JSON.stringify([implementation.repositoryHost, implementation.repositoryId, implementation.number]);
}

function revisionKey(revision: RepositoryRevisionReference): string {
  return JSON.stringify([revision.repository, revision.revision]);
}

function sameRevision(left: RepositoryRevisionReference, right: RepositoryRevisionReference): boolean {
  return left.repository === right.repository && left.revision === right.revision;
}

function findingSortKey(finding: CoverageFinding): string {
  return [
    finding.kind,
    finding.targetEntryKey ?? "",
    finding.linkId ?? "",
    finding.evidenceId ?? "",
    finding.detail,
  ].join("\u0000");
}

function sortFindings(findings: readonly CoverageFinding[]): CoverageFinding[] {
  return [...findings].sort((left, right) => compareOrdinal(findingSortKey(left), findingSortKey(right)));
}

function operationTargets(change: DesignChangeSet): SemanticEntryKey[] {
  return uniqueSorted(change.target.operations.map((operation) => operation.entryKey));
}

function addFinding(findings: CoverageFinding[], finding: CoverageFinding): void {
  findings.push(finding);
}

/**
 * Evaluates the explicit mapping without completion evidence.
 *
 * This is useful to callers that only need the structural part of coverage. The
 * full `evaluateCoverage` function additionally requires proof at the linked
 * implementation revisions before a target is considered covered.
 */
export function evaluateTargetCoverage(
  change: DesignChangeSet,
  links: readonly ImplementationLink[],
): TargetCoverageResult {
  const targets = operationTargets(change);
  const targetSet = new Set<SemanticEntryKey>(targets);
  const linked = new Set<SemanticEntryKey>();
  const covered = new Set<SemanticEntryKey>();
  const unknown = new Set<SemanticEntryKey>();
  const staleLinkIds: string[] = [];
  const findings: CoverageFinding[] = [];

  for (const link of links) {
    const stale = link.changeId !== change.changeId || link.changeDigest !== change.digest;
    if (stale) {
      staleLinkIds.push(link.linkId);
      addFinding(findings, {
        kind: "stale-link",
        linkId: link.linkId,
        detail: "implementation link is not bound to the exact Design Change revision",
      });
    }

    for (const entryKey of link.targetEntryKeys) {
      linked.add(entryKey);
      if (!targetSet.has(entryKey)) {
        unknown.add(entryKey);
        addFinding(findings, {
          kind: "unknown-target",
          targetEntryKey: entryKey,
          linkId: link.linkId,
          detail: "implementation link names a target absent from the proposed operations",
        });
      } else if (!stale) {
        covered.add(entryKey);
      }
    }
  }

  const missing = targets.filter((entryKey) => !covered.has(entryKey));
  for (const entryKey of missing) {
    addFinding(findings, {
      kind: "missing-target",
      targetEntryKey: entryKey,
      detail: "no non-stale implementation link covers this proposed target",
    });
  }

  return {
    targetEntryKeys: targets,
    linkedEntryKeys: uniqueSorted([...linked]),
    coveredEntryKeys: uniqueSorted([...covered]),
    missingEntryKeys: missing,
    unknownEntryKeys: uniqueSorted([...unknown]),
    staleLinkIds: uniqueSorted(staleLinkIds),
    findings: sortFindings(findings),
  };
}

interface EvidenceState {
  readonly valid: boolean;
  readonly revision?: RepositoryRevisionReference;
}

function revisionIsUsable(revision: RepositoryRevisionReference): boolean {
  return (
    typeof revision.repository === "string" &&
    revision.repository.length > 0 &&
    typeof revision.revision === "string" &&
    revision.revision.length > 0
  );
}

/**
 * Evaluates target coverage and completion evidence for an approved Design Change.
 *
 * Links and evidence are treated as untrusted transport records. An Issue
 * reference, a stale link, or a positive-looking provider result is never enough
 * by itself: the evidence must bind the exact change digest, implementation
 * identity, and repository revision. If multiple leaf revisions are involved,
 * each must be proven to be an ancestor of the supplied integration revision by
 * the Git port.
 */
export async function evaluateCoverage(input: CoverageInput): Promise<CoverageResult> {
  const structural = evaluateTargetCoverage(input.change, input.links);
  const findings = [...structural.findings];
  const staleEvidenceIds: string[] = [];
  const evidenceByImplementation = new Map<string, ImplementationCompletionEvidence[]>();

  for (const evidence of input.completionEvidence ?? []) {
    const stale = evidence.changeId !== input.change.changeId || evidence.changeDigest !== input.change.digest;
    if (stale) {
      staleEvidenceIds.push(evidence.evidenceId);
      addFinding(findings, {
        kind: "stale-evidence",
        evidenceId: evidence.evidenceId,
        implementation: evidence.implementation,
        detail: "completion evidence is not bound to the exact Design Change revision",
      });
      continue;
    }
    const key = implementationKey(evidence.implementation);
    const existing = evidenceByImplementation.get(key);
    if (existing === undefined) evidenceByImplementation.set(key, [evidence]);
    else existing.push(evidence);
  }

  const linkImplementations = new Map<string, ExternalIssueReference>();
  for (const link of input.links) {
    if (link.changeId !== input.change.changeId || link.changeDigest !== input.change.digest) continue;
    const key = implementationKey(link.implementation);
    linkImplementations.set(key, link.implementation);
  }

  const evidenceStates = new Map<string, EvidenceState>();
  const candidateRevisions = new Map<string, RepositoryRevisionReference>();
  for (const [key, implementation] of linkImplementations) {
    const evidence = evidenceByImplementation.get(key) ?? [];
    if (evidence.length === 0) {
      addFinding(findings, {
        kind: "missing-completion-evidence",
        implementation,
        detail: "a linked implementation has no revision-bound completion evidence",
      });
      evidenceStates.set(key, { valid: false });
      continue;
    }

    const usable = evidence.filter((item) => item.result === "match" && revisionIsUsable(item.implementationRevision));
    if (usable.length === 0) {
      for (const item of evidence) {
        if (item.result !== "match") {
          addFinding(findings, {
            kind: "stale-evidence",
            evidenceId: item.evidenceId,
            implementation: item.implementation,
            detail: "completion evidence is not a successful proof",
          });
          staleEvidenceIds.push(item.evidenceId);
        } else if (!revisionIsUsable(item.implementationRevision)) {
          addFinding(findings, {
            kind: "stale-evidence",
            evidenceId: item.evidenceId,
            implementation: item.implementation,
            detail: "completion evidence does not name a repository revision",
          });
          staleEvidenceIds.push(item.evidenceId);
        }
      }
      evidenceStates.set(key, { valid: false });
      continue;
    }

    const revisions = new Map<string, RepositoryRevisionReference>();
    for (const item of usable) revisions.set(revisionKey(item.implementationRevision), item.implementationRevision);
    if (revisions.size > 1 && input.integrationRevision === undefined) {
      addFinding(findings, {
        kind: "ambiguous-completion-evidence",
        implementation,
        detail: "multiple leaf revisions require an explicit integration revision",
      });
      for (const item of usable) staleEvidenceIds.push(item.evidenceId);
      evidenceStates.set(key, { valid: false });
      continue;
    }

    const selected = usable[0].implementationRevision;
    candidateRevisions.set(revisionKey(selected), selected);
    evidenceStates.set(key, { valid: true, revision: selected });
  }

  const leafRevisions = [...candidateRevisions.values()];
  const integrationRevision = input.integrationRevision;
  const requiresIntegration = new Set<string>();
  if (integrationRevision !== undefined) {
    // Every leaf whose completion revision differs from the integration
    // revision needs an ancestry proof, including the single-leaf case.
    for (const revision of leafRevisions) {
      if (!sameRevision(revision, integrationRevision)) requiresIntegration.add(revisionKey(revision));
    }
  } else if (leafRevisions.length > 1) {
    // Without an integration revision, multiple distinct leaves cannot be
    // shown to belong to one integration and therefore fail closed.
    for (const revision of leafRevisions) requiresIntegration.add(revisionKey(revision));
  }

  const ancestry = new Map<string, boolean>();
  for (const revision of leafRevisions) {
    const key = revisionKey(revision);
    if (!requiresIntegration.has(key)) continue;
    if (integrationRevision === undefined || input.git === undefined) {
      ancestry.set(key, false);
      continue;
    }
    try {
      ancestry.set(key, await input.git.isAncestor(revision, integrationRevision));
    } catch {
      ancestry.set(key, false);
    }
  }

  const acceptedImplementations = new Set<string>();
  for (const [key, state] of evidenceStates) {
    if (!state.valid || state.revision === undefined) continue;
    const revisionKeyValue = revisionKey(state.revision);
    if (requiresIntegration.has(revisionKeyValue) && ancestry.get(revisionKeyValue) !== true) {
      const implementation = linkImplementations.get(key);
      if (implementation !== undefined) {
        addFinding(findings, {
          kind: "non-integrated-revision",
          implementation,
          detail: "leaf revision is not proven to be part of the integration revision",
        });
      }
      continue;
    }
    acceptedImplementations.add(key);
  }

  const covered = new Set<SemanticEntryKey>();
  for (const link of input.links) {
    if (link.changeId !== input.change.changeId || link.changeDigest !== input.change.digest) continue;
    if (!acceptedImplementations.has(implementationKey(link.implementation))) continue;
    for (const entryKey of link.targetEntryKeys) {
      if (structural.targetEntryKeys.includes(entryKey)) covered.add(entryKey);
    }
  }

  const missing = structural.targetEntryKeys.filter((entryKey) => !covered.has(entryKey));
  for (const entryKey of missing) {
    if (
      !structural.findings.some((finding) => finding.kind === "missing-target" && finding.targetEntryKey === entryKey)
    ) {
      addFinding(findings, {
        kind: "missing-target",
        targetEntryKey: entryKey,
        detail: "no completed, integrated implementation proves this proposed target",
      });
    }
  }

  const sortedFindings = sortFindings(findings);
  const complete =
    missing.length === 0 &&
    structural.unknownEntryKeys.length === 0 &&
    structural.staleLinkIds.length === 0 &&
    staleEvidenceIds.length === 0 &&
    !sortedFindings.some(
      (finding) =>
        finding.kind === "missing-completion-evidence" ||
        finding.kind === "non-integrated-revision" ||
        finding.kind === "ambiguous-completion-evidence",
    );
  const hasUnresolved = sortedFindings.some(
    (finding) =>
      finding.kind === "stale-link" ||
      finding.kind === "stale-evidence" ||
      finding.kind === "missing-completion-evidence" ||
      finding.kind === "non-integrated-revision" ||
      finding.kind === "ambiguous-completion-evidence",
  );

  return {
    complete,
    result: complete ? "match" : hasUnresolved ? "unresolved" : "mismatch",
    targetEntryKeys: structural.targetEntryKeys,
    linkedEntryKeys: structural.linkedEntryKeys,
    coveredEntryKeys: uniqueSorted([...covered]),
    missingEntryKeys: missing,
    unknownEntryKeys: structural.unknownEntryKeys,
    staleLinkIds: structural.staleLinkIds,
    staleEvidenceIds: uniqueSorted(staleEvidenceIds),
    findings: sortedFindings,
  };
}
