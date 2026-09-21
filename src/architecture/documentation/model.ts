import type {
  ArchitectureDecision,
  ArchitectureReference,
  ArchitectureReferenceAttachment,
} from "../canon/decisions.js";
import type { AuthorityFact, OwnershipFact } from "../canon/authority.js";
import type { Boundary } from "../canon/boundaries.js";
import type { ArchitectureConstraint } from "../canon/constraints.js";
import type {
  DeploymentInstance,
  DeploymentMapping,
  DeploymentNode,
  InfrastructureReference,
  RuntimeEnvironment,
} from "../canon/deployment.js";
import type { ElementRecord } from "../canon/elements.js";
import type { Flow } from "../canon/flows.js";
import type { InterfaceRecord, RelationshipRecord } from "../canon/relationships.js";
import type { RepositoryMapping } from "../canon/repository-mappings.js";
import type { ResponsibilityFact } from "../canon/responsibilities.js";
import type { ViewSpec } from "../canon/views.js";
import type { CanonVersion, DocumentId } from "../canon/identity.js";
import type { CodeIntent } from "../canon/code-intent-contract.js";
import type { DesignIntentLifecycleRecord } from "../../design/contracts.js";

export const DOCUMENTATION_SECTION_ORDER = [
  "structure",
  "responsibility",
  "authority",
  "constraints",
  "flows",
  "deployment",
  "mappings",
  "decisions",
  "references",
  "views",
  "codeIntent",
] as const;

export type DocumentationSectionKey = (typeof DOCUMENTATION_SECTION_ORDER)[number];

/** A stable reference to an identity owned by the Architecture Canon. */
export interface DocumentationAnchor {
  readonly canonId: string;
}

/** Canon data retained by the renderer-neutral projection. */
export type DocumentationData =
  | ElementRecord
  | InterfaceRecord
  | RelationshipRecord
  | Boundary
  | ResponsibilityFact
  | AuthorityFact
  | OwnershipFact
  | ArchitectureConstraint
  | Flow
  | RuntimeEnvironment
  | DeploymentNode
  | DeploymentInstance
  | InfrastructureReference
  | DeploymentMapping
  | RepositoryMapping
  | ArchitectureDecision
  | ArchitectureReference
  | ArchitectureReferenceAttachment
  | ViewSpec
  | CodeIntent;

export interface DocumentationEntry<TData extends DocumentationData = DocumentationData> {
  /** A deterministic projection key. It is not an additional architecture identity. */
  readonly key: string;
  readonly anchors: readonly DocumentationAnchor[];
  readonly data: TData;
}

export interface DocumentationGroup {
  /** A fixed Canon field/group name, not architecture prose. */
  readonly key: string;
  readonly entries: readonly DocumentationEntry[];
}

export interface DocumentationSection {
  readonly key: DocumentationSectionKey;
  readonly groups: readonly DocumentationGroup[];
}

export interface DocumentationNavigationItem {
  readonly section: DocumentationSectionKey;
  readonly groupKeys: readonly string[];
}

export interface DocumentationModel {
  readonly canonVersion: CanonVersion;
  readonly documentId: DocumentId;
  readonly root: DocumentationAnchor;
  readonly navigation: readonly DocumentationNavigationItem[];
  readonly sections: readonly DocumentationSection[];
  /** Read-only Design Intent context; the current Canon remains this model's authority. */
  readonly designIntent?: DocumentationDesignIntent;
}

/** Lifecycle-aware context attached to a current documentation projection. */
export interface DocumentationDesignIntent {
  readonly proposed?: DocumentationModel;
  readonly lifecycle?: DesignIntentLifecycleRecord;
}
