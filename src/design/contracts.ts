import type { ArchitectureDocumentV1, CanonSectionName } from "../architecture/canon/document.js";
import type { CodeIntent } from "../architecture/canon/code-intent-contract.js";
import type { CanonVersion } from "../architecture/canon/identity.js";
import type { Digest, JsonValue } from "./digest.js";
import type { SemanticEntryKey } from "./entry-key.js";

export const DESIGN_CHANGE_CONTRACT_VERSION = 1 as const;

export type DesignChangeContractVersion = typeof DESIGN_CHANGE_CONTRACT_VERSION;

export interface CanonRevisionReference {
  readonly repositoryRevision: string;
  readonly canonVersion: CanonVersion;
  readonly canonDigest: Digest;
}

export interface RepositoryRevisionReference {
  readonly repository: string;
  readonly revision: string;
}

export interface AddedSemanticEntry {
  readonly kind: "added";
  readonly entryKey: SemanticEntryKey;
  readonly value: JsonValue;
}

export interface ModifiedSemanticEntry {
  readonly kind: "modified";
  readonly entryKey: SemanticEntryKey;
  readonly before: JsonValue;
  readonly after: JsonValue;
}

export interface RemovedSemanticEntry {
  readonly kind: "removed";
  readonly entryKey: SemanticEntryKey;
  readonly before: JsonValue;
}

export type DesignChangeOperation = AddedSemanticEntry | ModifiedSemanticEntry | RemovedSemanticEntry;

export interface DesignChangeTarget {
  readonly canonVersion: CanonVersion;
  readonly operations: readonly DesignChangeOperation[];
  readonly targetCanonDigest: Digest;
}

/** The digest input for a Design Change; it intentionally has no self-referential digest field. */
export interface DesignChangeSetPayload {
  readonly contractVersion: DesignChangeContractVersion;
  readonly changeId: string;
  readonly base: CanonRevisionReference;
  readonly target: DesignChangeTarget;
}

export interface DesignChangeSet extends DesignChangeSetPayload {
  readonly digest: Digest;
}

export type DesignChangeLifecycleState =
  "draft" | "design-review" | "approved" | "implementing" | "certification-review" | "promoted";

export type DesignReviewDecision = "approved" | "changes-requested" | "rejected";

export interface EvidenceReference {
  readonly provider: string;
  readonly reference: string;
}

export interface DesignReviewEvidence {
  readonly reviewId: string;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly decision: DesignReviewDecision;
  readonly recordedAt: string;
  readonly references?: readonly EvidenceReference[];
  readonly rationale?: string;
}

export interface ImplementationIdentity {
  readonly repository: string;
  readonly implementation: string;
}

export interface ImplementationLink {
  readonly linkId: string;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly implementation: ImplementationIdentity;
  readonly targetEntryKeys: readonly SemanticEntryKey[];
  readonly evidence?: readonly EvidenceReference[];
}

export type CertificationFinding = "match" | "mismatch" | "unresolved";

export interface CertificationCheck {
  readonly checkId: string;
  readonly targetEntryKey?: SemanticEntryKey;
  readonly result: CertificationFinding;
  readonly detail?: string;
}

export interface CertificationEvidence {
  readonly certificationId: string;
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly implementationRevision: RepositoryRevisionReference;
  readonly result: CertificationFinding;
  readonly checks: readonly CertificationCheck[];
  readonly recordedAt: string;
  readonly references?: readonly EvidenceReference[];
}

export interface DesignIntentLifecycleRecord {
  readonly changeId: string;
  readonly changeDigest: Digest;
  readonly state: DesignChangeLifecycleState;
  readonly review?: DesignReviewEvidence;
  readonly implementations: readonly ImplementationLink[];
  readonly certification?: CertificationEvidence;
}

export type DesignChangeSection = CanonSectionName | "codeIntent";

export interface DesignIntentCanonView {
  readonly current: ArchitectureDocumentV1;
  readonly proposed?: ArchitectureDocumentV1;
  readonly codeIntent?: readonly CodeIntent[];
}
