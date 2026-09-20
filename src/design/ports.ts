import type { ArchitectureDocumentV1 } from "../architecture/canon/document.js";
import type {
  CanonRevisionReference,
  CertificationEvidence,
  DesignChangeSet,
  DesignChangeSetPayload,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
} from "./contracts.js";

/** Read-only access to the existing Architecture Canon authority. */
export interface CanonPort {
  readCurrent(): Promise<{ readonly revision: CanonRevisionReference; readonly document: ArchitectureDocumentV1 }>;
  readAt(reference: CanonRevisionReference): Promise<ArchitectureDocumentV1>;
}

/** Evaluates a semantic change against an exact Canon revision without owning persistence. */
export interface DesignChangePort {
  apply(change: DesignChangeSetPayload, base: ArchitectureDocumentV1): Promise<ArchitectureDocumentV1>;
}

/** Repository-first storage for the semantic Design Change Set. */
export interface DesignChangeStorePort {
  read(changeId: string): Promise<DesignChangeSet | undefined>;
  write(change: DesignChangeSet): Promise<void>;
}

/** Repository-first storage for review evidence; it does not grant execution authorization. */
export interface DesignReviewPort {
  list(changeId: string): Promise<readonly DesignReviewEvidence[]>;
  record(evidence: DesignReviewEvidence): Promise<void>;
}

/** Provider-neutral storage for bounded Implementation linkage. */
export interface ImplementationLinkPort {
  list(changeId: string): Promise<readonly ImplementationLink[]>;
  record(link: ImplementationLink): Promise<void>;
}

/** Storage for certification results bound to an exact proposal and implementation revision. */
export interface CertificationPort {
  read(changeId: string): Promise<CertificationEvidence | undefined>;
  record(evidence: CertificationEvidence): Promise<void>;
}

/** Read/write boundary for lifecycle metadata, separate from semantic Change Set content. */
export interface DesignLifecyclePort {
  read(changeId: string): Promise<DesignIntentLifecycleRecord | undefined>;
  write(record: DesignIntentLifecycleRecord): Promise<void>;
}

export interface DesignIntentPorts {
  readonly canon: CanonPort;
  readonly changes: DesignChangePort;
  readonly changeStore: DesignChangeStorePort;
  readonly reviews: DesignReviewPort;
  readonly implementations: ImplementationLinkPort;
  readonly certification: CertificationPort;
  readonly lifecycle: DesignLifecyclePort;
}
