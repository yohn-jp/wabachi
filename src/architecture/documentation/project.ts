import { validateArchitectureDocument } from "../canon/validate.js";
import type { ArchitectureDocumentV1 } from "../canon/document.js";
import type {
  DocumentationAnchor,
  DocumentationData,
  DocumentationEntry,
  DocumentationGroup,
  DocumentationModel,
  DocumentationNavigationItem,
  DocumentationSection,
  DocumentationSectionKey,
} from "./model.js";
import type { CodeIntent } from "../canon/code-intent-contract.js";

export interface DocumentationProjectionOptions {
  /** Optional read-model Code Intent supplied by the Design Intent authority. */
  readonly codeIntent?: readonly CodeIntent[];
}

const SECTION_GROUP_KEYS = {
  structure: ["elements", "interfaces", "relationships", "boundaries"],
  responsibility: ["responsibilities"],
  authority: ["authority", "ownership"],
  constraints: ["constraints"],
  flows: ["flows"],
  deployment: ["runtimeEnvironments", "deploymentNodes", "deploymentInstances", "infrastructureReferences", "mappings"],
  mappings: ["repositoryMappings"],
  decisions: ["decisions"],
  references: ["references", "attachments"],
  views: ["views"],
  codeIntent: ["codeIntents"],
} as const satisfies Record<DocumentationSectionKey, readonly string[]>;

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function createAnchor(canonId: string): DocumentationAnchor {
  return Object.freeze({ canonId });
}

function createAnchors(ids: readonly (string | undefined)[]): readonly DocumentationAnchor[] {
  const seen = new Set<string>();
  const anchors: DocumentationAnchor[] = [];

  for (const id of ids) {
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    anchors.push(createAnchor(id));
  }

  return freezeArray(anchors);
}

function createEntry<TData extends DocumentationData>(
  key: string,
  data: TData,
  anchorIds: readonly (string | undefined)[],
): DocumentationEntry<TData> {
  return Object.freeze({ key, anchors: createAnchors(anchorIds), data });
}

function compareEntries(left: DocumentationEntry, right: DocumentationEntry): number {
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function createGroup(key: string, entries: readonly DocumentationEntry[]): DocumentationGroup {
  return Object.freeze({ key, entries: freezeArray([...entries].sort(compareEntries)) });
}

function createSection(key: DocumentationSectionKey, groups: readonly DocumentationGroup[]): DocumentationSection {
  return Object.freeze({ key, groups: freezeArray(groups) });
}

function tupleKey(...parts: readonly (string | undefined)[]): string {
  return JSON.stringify(parts);
}

function relationshipEntry(relationship: ArchitectureDocumentV1["relationships"][number]): DocumentationEntry {
  return createEntry(
    tupleKey(relationship.source, relationship.target, relationship.kind, relationship.interfaceId),
    relationship,
    [relationship.source, relationship.target, relationship.interfaceId],
  );
}

function authorityEntry(fact: ArchitectureDocumentV1["authority"]["authority"][number]): DocumentationEntry {
  return createEntry(tupleKey(fact.kind, fact.concern, fact.owner), fact, [fact.concern, fact.owner]);
}

function ownershipEntry(fact: ArchitectureDocumentV1["authority"]["ownership"][number]): DocumentationEntry {
  return createEntry(tupleKey(fact.kind, fact.resource, fact.owner), fact, [fact.resource, fact.owner]);
}

function constraintEntry(constraint: ArchitectureDocumentV1["constraints"][number]): DocumentationEntry {
  switch (constraint.kind) {
    case "single-authority":
      return createEntry(tupleKey(constraint.kind, constraint.concern), constraint, [constraint.concern]);
    case "must-go-through":
      return createEntry(
        tupleKey(constraint.kind, constraint.source, constraint.target, constraint.through),
        constraint,
        [constraint.source, constraint.target, constraint.through],
      );
    default:
      return createEntry(tupleKey(constraint.kind, constraint.source, constraint.target), constraint, [
        constraint.source,
        constraint.target,
      ]);
  }
}

function deploymentMappingEntry(mapping: ArchitectureDocumentV1["deployment"]["mappings"][number]): DocumentationEntry {
  return createEntry(tupleKey(mapping.softwareElementId, mapping.deploymentInstanceId), mapping, [
    mapping.softwareElementId,
    mapping.deploymentInstanceId,
  ]);
}

function referenceAttachmentEntry(
  attachment: ArchitectureDocumentV1["decisions"]["referenceAttachments"][number],
): DocumentationEntry {
  return createEntry(tupleKey(attachment.targetId, ...attachment.referenceIds), attachment, [
    attachment.targetId,
    ...attachment.referenceIds,
  ]);
}

function viewEntry(view: ArchitectureDocumentV1["views"][number]): DocumentationEntry {
  const references = [...view.scope.include, ...view.scope.exclude];
  return createEntry(view.key, view, [view.root?.id, ...references.map((reference) => reference.id)]);
}

function codeIntentEntry(
  intent: NonNullable<ArchitectureDocumentV1["codeIntents"]>["entries"][number],
): DocumentationEntry {
  return createEntry(intent.id, intent, [
    intent.id,
    intent.ownerId,
    ...intent.responsibilityIds,
    ...intent.decisionIds,
  ]);
}

function createSections(
  document: ArchitectureDocumentV1,
  codeIntents: readonly CodeIntent[] | undefined = document.codeIntents?.entries,
): readonly DocumentationSection[] {
  const structure = createSection("structure", [
    createGroup(
      "elements",
      document.elements.map((element) => createEntry(element.id, element, [element.id, element.parentId])),
    ),
    createGroup(
      "interfaces",
      document.interfaces.map((contract) => createEntry(contract.id, contract, [contract.id, contract.owner])),
    ),
    createGroup("relationships", document.relationships.map(relationshipEntry)),
    createGroup(
      "boundaries",
      document.boundaries.map((boundary) => createEntry(boundary.id, boundary, [boundary.id, ...boundary.memberIds])),
    ),
  ]);

  const responsibility = createSection("responsibility", [
    createGroup(
      "responsibilities",
      document.responsibilities.responsibilities.map((fact) => createEntry(fact.id, fact, [fact.id, fact.target.id])),
    ),
  ]);

  const authority = createSection("authority", [
    createGroup("authority", document.authority.authority.map(authorityEntry)),
    createGroup("ownership", document.authority.ownership.map(ownershipEntry)),
  ]);

  const constraints = createSection("constraints", [
    createGroup("constraints", document.constraints.map(constraintEntry)),
  ]);

  const flows = createSection("flows", [
    createGroup(
      "flows",
      document.flows.map((flow) =>
        createEntry(flow.id, flow, [flow.id, ...flow.steps.flatMap((step) => [step.relationshipId, step.interfaceId])]),
      ),
    ),
  ]);

  const deployment = createSection("deployment", [
    createGroup(
      "runtimeEnvironments",
      document.deployment.runtimeEnvironments.map((environment) =>
        createEntry(environment.id, environment, [environment.id]),
      ),
    ),
    createGroup(
      "deploymentNodes",
      document.deployment.deploymentNodes.map((node) => createEntry(node.id, node, [node.id, node.environmentId])),
    ),
    createGroup(
      "deploymentInstances",
      document.deployment.deploymentInstances.map((instance) =>
        createEntry(instance.id, instance, [instance.id, instance.nodeId]),
      ),
    ),
    createGroup(
      "infrastructureReferences",
      document.deployment.infrastructureReferences.map((reference) =>
        createEntry(reference.id, reference, [reference.id]),
      ),
    ),
    createGroup("mappings", document.deployment.mappings.map(deploymentMappingEntry)),
  ]);

  const mappings = createSection("mappings", [
    createGroup(
      "repositoryMappings",
      document.repositoryMappings.map((mapping) => createEntry(mapping.canonId, mapping, [mapping.canonId])),
    ),
  ]);

  const decisions = createSection("decisions", [
    createGroup(
      "decisions",
      document.decisions.decisions.map((decision) =>
        createEntry(decision.id, decision, [
          decision.id,
          ...decision.targetIds,
          ...decision.referenceIds,
          ...decision.supersedes,
        ]),
      ),
    ),
  ]);

  const references = createSection("references", [
    createGroup(
      "references",
      document.decisions.references.map((reference) => createEntry(reference.id, reference, [reference.id])),
    ),
    createGroup("attachments", document.decisions.referenceAttachments.map(referenceAttachmentEntry)),
  ]);

  const views = createSection("views", [createGroup("views", document.views.map(viewEntry))]);

  const sections = [
    structure,
    responsibility,
    authority,
    constraints,
    flows,
    deployment,
    mappings,
    decisions,
    references,
    views,
  ];

  if (codeIntents !== undefined) {
    sections.push(createSection("codeIntent", [createGroup("codeIntents", codeIntents.map(codeIntentEntry))]));
  }

  return freezeArray(sections);
}

function createNavigation(sections: readonly DocumentationSection[]): readonly DocumentationNavigationItem[] {
  return freezeArray(
    sections.map((section) =>
      Object.freeze({
        section: section.key,
        groupKeys: freezeArray([...SECTION_GROUP_KEYS[section.key]]),
      }),
    ),
  );
}

/** Project a validated Architecture Canon into renderer-neutral documentation data. */
export function projectArchitectureDocument(
  document: ArchitectureDocumentV1,
  options: DocumentationProjectionOptions | readonly CodeIntent[] = {},
): DocumentationModel {
  const validation = validateArchitectureDocument(document);
  if (!validation.valid) {
    const diagnostics = validation.diagnostics.map(({ code, path }) => `${code} at ${path}`).join(", ");
    throw new Error(`cannot project invalid Architecture Canon: ${diagnostics}`);
  }

  const codeIntents = Array.isArray(options) ? options : (options as DocumentationProjectionOptions).codeIntent;
  const sections = createSections(document, codeIntents ?? document.codeIntents?.entries);
  return Object.freeze({
    canonVersion: document.canonVersion,
    documentId: document.documentId,
    root: createAnchor(document.root.id),
    navigation: createNavigation(sections),
    sections,
  });
}
