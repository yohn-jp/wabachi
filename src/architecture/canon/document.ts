import {
  CANON_VERSION,
  createArchitectureIdentity,
  createDocumentId,
  type ArchitectureIdentity,
  type CanonVersion,
  type DocumentId,
  type IdentityInput,
} from "./identity.js";
import { normalizeElements, type ElementInput, type ElementRecord } from "./elements.js";
import {
  normalizeInterfaces,
  normalizeRelationships,
  type InterfaceInput,
  type InterfaceRecord,
  type RelationshipInput,
  type RelationshipRecord,
} from "./relationships.js";
import { createResponsibilitySet, type ResponsibilitySet, type ResponsibilitySetInput } from "./responsibilities.js";
import {
  createAuthorityOwnershipFacts,
  type AuthorityOwnershipFacts,
  type AuthorityOwnershipFactsInput,
} from "./authority.js";
import { createBoundaries, type Boundary, type BoundaryInput } from "./boundaries.js";
import { createConstraints, type ArchitectureConstraint, type ArchitectureConstraintInput } from "./constraints.js";
import { createFlows, type Flow, type FlowInput } from "./flows.js";
import { createDeploymentTopology, type DeploymentTopology, type DeploymentTopologyInput } from "./deployment.js";
import {
  createRepositoryMappings,
  type RepositoryMapping,
  type RepositoryMappingInput,
} from "./repository-mappings.js";
import {
  createArchitectureDecisions,
  type ArchitectureDecisions,
  type ArchitectureDecisionsInput,
} from "./decisions.js";
import { normalizeViews, type ViewInput, type ViewSpec } from "./views.js";
import { createCodeIntentContract, type CodeIntentContractInput, type CodeIntentInput } from "./code-intent.js";
import type { CodeIntent } from "./code-intent-contract.js";

export const CODE_INTENT_SCHEMA_VERSION = 1 as const;

export interface CodeIntentSectionInput extends CodeIntentContractInput {
  readonly schemaVersion: typeof CODE_INTENT_SCHEMA_VERSION;
  readonly entries: readonly CodeIntentInput[];
}

export interface CodeIntentSection {
  readonly schemaVersion: typeof CODE_INTENT_SCHEMA_VERSION;
  readonly entries: readonly CodeIntent[];
}

/** Canon v1 sections are emitted in the order established by leaf implementation order. */
export const CANON_SECTION_ORDER = [
  "elements",
  "interfaces",
  "relationships",
  "responsibilities",
  "authority",
  "boundaries",
  "constraints",
  "flows",
  "deployment",
  "repositoryMappings",
  "decisions",
  "views",
] as const;

export type CanonSectionName = (typeof CANON_SECTION_ORDER)[number];

export interface ArchitectureDocumentInput {
  readonly documentId: string;
  readonly root: IdentityInput;
  readonly elements?: readonly ElementInput[];
  readonly interfaces?: readonly InterfaceInput[];
  readonly relationships?: readonly RelationshipInput[];
  readonly responsibilities?: ResponsibilitySetInput;
  readonly authority?: AuthorityOwnershipFactsInput;
  readonly boundaries?: readonly BoundaryInput[];
  readonly constraints?: readonly ArchitectureConstraintInput[];
  readonly flows?: readonly FlowInput[];
  readonly deployment?: DeploymentTopologyInput;
  readonly repositoryMappings?: readonly RepositoryMappingInput[];
  readonly decisions?: ArchitectureDecisionsInput;
  readonly views?: readonly ViewInput[];
  readonly codeIntents?: CodeIntentSectionInput;
}

export type GlobalIdentityNamespace =
  | "architecture"
  | "element"
  | "interface"
  | "responsibility"
  | "boundary"
  | "flow"
  | "decision"
  | "reference"
  | "code-intent";

export interface GlobalIdentityEntry {
  readonly id: string;
  readonly namespace: GlobalIdentityNamespace;
}

/** Deterministic registry of canonical identities owned by the complete document. */
export interface GlobalIdentityRegistry {
  readonly entries: readonly GlobalIdentityEntry[];
}

export interface ArchitectureDocumentV1 {
  readonly canonVersion: CanonVersion;
  readonly documentId: DocumentId;
  readonly root: ArchitectureIdentity;
  readonly elements: readonly ElementRecord[];
  readonly interfaces: readonly InterfaceRecord[];
  readonly relationships: readonly RelationshipRecord[];
  readonly responsibilities: ResponsibilitySet;
  readonly authority: AuthorityOwnershipFacts;
  readonly boundaries: readonly Boundary[];
  readonly constraints: readonly ArchitectureConstraint[];
  readonly flows: readonly Flow[];
  readonly deployment: DeploymentTopology;
  readonly repositoryMappings: readonly RepositoryMapping[];
  readonly decisions: ArchitectureDecisions;
  readonly views: readonly ViewSpec[];
  readonly codeIntents?: CodeIntentSection;
  readonly globalIdentityRegistry: GlobalIdentityRegistry;
}

function assertDocumentInput(input: unknown): asserts input is ArchitectureDocumentInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("architecture document must be an object");
  }
}

function compareIdentityEntries(left: GlobalIdentityEntry, right: GlobalIdentityEntry): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  if (left.namespace < right.namespace) return -1;
  if (left.namespace > right.namespace) return 1;
  return 0;
}

function createGlobalIdentityRegistry(document: {
  readonly root: ArchitectureIdentity;
  readonly elements: readonly ElementRecord[];
  readonly interfaces: readonly InterfaceRecord[];
  readonly responsibilities: ResponsibilitySet;
  readonly boundaries: readonly Boundary[];
  readonly flows: readonly Flow[];
  readonly decisions: ArchitectureDecisions;
  readonly codeIntents?: CodeIntentSection;
}): GlobalIdentityRegistry {
  const entries: GlobalIdentityEntry[] = [
    { id: document.root.id, namespace: "architecture" },
    ...document.elements.map(({ id }) => ({ id, namespace: "element" as const })),
    ...document.interfaces.map(({ id }) => ({ id, namespace: "interface" as const })),
    ...document.responsibilities.responsibilities.map(({ id }) => ({ id, namespace: "responsibility" as const })),
    ...document.boundaries.map(({ id }) => ({ id, namespace: "boundary" as const })),
    ...document.flows.map(({ id }) => ({ id, namespace: "flow" as const })),
    ...document.decisions.decisions.map(({ id }) => ({ id, namespace: "decision" as const })),
    ...document.decisions.references.map(({ id }) => ({ id, namespace: "reference" as const })),
    ...(document.codeIntents?.entries.map(({ id }) => ({ id, namespace: "code-intent" as const })) ?? []),
  ];

  entries.sort(compareIdentityEntries);
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous.id === current.id) {
      throw new Error(`duplicate canonical id: ${current.id} (${previous.namespace}, ${current.namespace})`);
    }
  }

  return Object.freeze({
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  });
}

/** Compose all Canon v1 leaf sections without performing cross-section validation. */
export function createArchitectureDocument(input: ArchitectureDocumentInput): ArchitectureDocumentV1 {
  assertDocumentInput(input);

  const root = createArchitectureIdentity(input.root);
  const documentId = createDocumentId(input.documentId);
  const elements = normalizeElements(input.elements ?? []);
  const interfaces = normalizeInterfaces(input.interfaces ?? []);
  const relationships = normalizeRelationships(input.relationships ?? []);
  const responsibilities = createResponsibilitySet(input.responsibilities ?? {});
  const authority = createAuthorityOwnershipFacts(input.authority ?? {});
  const boundaries = createBoundaries(input.boundaries ?? []);
  const constraints = createConstraints(input.constraints ?? []);
  const flows = createFlows(input.flows ?? []);
  const deployment = createDeploymentTopology(input.deployment ?? {});
  const repositoryMappings = createRepositoryMappings(input.repositoryMappings ?? []);
  const decisions = createArchitectureDecisions(input.decisions ?? {});
  const views = normalizeViews(input.views ?? []);
  const codeIntents =
    input.codeIntents === undefined
      ? undefined
      : (() => {
          if (input.codeIntents.schemaVersion !== CODE_INTENT_SCHEMA_VERSION) {
            throw new TypeError(`unsupported Code Intent schemaVersion: ${String(input.codeIntents.schemaVersion)}`);
          }
          return Object.freeze({
            schemaVersion: CODE_INTENT_SCHEMA_VERSION,
            entries: createCodeIntentContract({ entries: input.codeIntents.entries }).entries,
          });
        })();

  const document = {
    canonVersion: CANON_VERSION,
    documentId,
    root,
    elements,
    interfaces,
    relationships,
    responsibilities,
    authority,
    boundaries,
    constraints,
    flows,
    deployment,
    repositoryMappings,
    decisions,
    views,
    ...(codeIntents === undefined ? {} : { codeIntents }),
  } satisfies Omit<ArchitectureDocumentV1, "globalIdentityRegistry">;

  return Object.freeze({
    ...document,
    globalIdentityRegistry: createGlobalIdentityRegistry(document),
  });
}
