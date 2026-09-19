import { validateArchitectureDocument } from "../canon/validate.js";
import type { ArchitectureDocumentV1 } from "../canon/document.js";
import type { AuthorityFact, OwnershipFact } from "../canon/authority.js";
import type { ArchitectureConstraint } from "../canon/constraints.js";
import type { DeploymentInstance, DeploymentMapping, DeploymentNode } from "../canon/deployment.js";
import type { ElementRecord } from "../canon/elements.js";
import type { Flow, FlowStep } from "../canon/flows.js";
import type { InterfaceRecord, RelationshipRecord } from "../canon/relationships.js";
import type { ViewReference, ViewSpec } from "../canon/views.js";

export const PROJECTION_LOSS_CODES = [
  "unsupported-authority",
  "unsupported-ownership",
  "unsupported-boundary",
  "unsupported-responsibility",
  "unsupported-constraint",
  "unsupported-repository-mapping",
  "unsupported-decision",
  "unsupported-reference",
  "unsupported-reference-attachment",
  "unsupported-interface",
  "unsupported-containment",
  "unsupported-flow",
  "unsupported-deployment-instance",
  "unsupported-deployment-mapping",
  "unsupported-infrastructure-reference",
  "unsupported-view-reference",
  "unsupported-view-exclusion",
  "unsupported-view-scope",
  "unsupported-presentation",
  "ambiguous-flow-step",
] as const;

export type ProjectionLossCode = (typeof PROJECTION_LOSS_CODES)[number];

/** A machine-readable explanation of a Canon fact not represented losslessly by Structurizr. */
export interface ProjectionLoss {
  readonly code: ProjectionLossCode;
  readonly path: string;
  readonly canonIds: readonly string[];
  readonly message: string;
}

export type StructurizrIdentityNamespace =
  | "architecture"
  | "element"
  | "interface"
  | "responsibility"
  | "boundary"
  | "flow"
  | "decision"
  | "reference"
  | "runtime-environment"
  | "deployment-node"
  | "deployment-instance"
  | "infrastructure-reference";

export interface StructurizrIdentityMapping {
  readonly canonId: string;
  readonly namespace: StructurizrIdentityNamespace;
  /** The deterministic identifier or metadata token used by the projection. */
  readonly structurizrId: string;
}

export interface StructurizrViewMapping {
  readonly canonKey: string;
  readonly kind: ViewSpec["kind"];
  readonly structurizrKey: string;
}

export interface StructurizrProjection {
  readonly canonVersion: ArchitectureDocumentV1["canonVersion"];
  readonly documentId: ArchitectureDocumentV1["documentId"];
  readonly dsl: string;
  readonly identityMappings: readonly StructurizrIdentityMapping[];
  readonly viewMappings: readonly StructurizrViewMapping[];
  readonly losses: readonly ProjectionLoss[];
}

type ElementDslKind = "softwareSystem" | "container" | "component" | "element";

interface RelationshipEntry {
  readonly record: RelationshipRecord;
  readonly explicitId?: string;
}

interface ProjectionContext {
  readonly document: ArchitectureDocumentV1;
  readonly elementIdentifiers: ReadonlyMap<string, string>;
  readonly interfaceIdentifiers: ReadonlyMap<string, string>;
  readonly deploymentNodeIdentifiers: ReadonlyMap<string, string>;
  readonly deploymentInstanceIdentifiers: ReadonlyMap<string, string>;
  readonly elementDslKinds: Map<string, ElementDslKind>;
  readonly relationshipEntries: readonly RelationshipEntry[];
  readonly relationshipsByExplicitId: ReadonlyMap<string, RelationshipEntry>;
  readonly relationshipsByInterface: ReadonlyMap<string, readonly RelationshipEntry[]>;
  readonly losses: LossCollector;
}

class LossCollector {
  private readonly values: ProjectionLoss[] = [];
  private readonly keys = new Set<string>();

  add(code: ProjectionLossCode, path: string, canonIds: readonly string[], message: string): void {
    const key = `${code}\u0000${path}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.values.push(
      Object.freeze({
        code,
        path,
        canonIds: Object.freeze([...canonIds]),
        message,
      }),
    );
  }

  finish(): readonly ProjectionLoss[] {
    const losses = [...this.values].sort((left, right) => {
      return compareStrings(left.path, right.path) || compareStrings(left.code, right.code);
    });
    return Object.freeze(losses);
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Encode every non-alphanumeric character, including `_`, so the mapping is collision-free. */
function identifierPart(value: string): string {
  return [...value]
    .map((character) => {
      if (/^[A-Za-z0-9]$/u.test(character)) return character;
      return `_x${character.codePointAt(0)?.toString(16)}_`;
    })
    .join("");
}

function structurizrIdentifier(namespace: string, id: string): string {
  return `canon_${identifierPart(namespace)}_${identifierPart(id)}`;
}

function viewKey(key: string): string {
  return `canon_view_${identifierPart(key)}`;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function relationshipEntries(document: ArchitectureDocumentV1): readonly RelationshipEntry[] {
  return Object.freeze(
    document.relationships.map((record) => {
      const candidate = record as unknown as { readonly id?: unknown };
      return Object.freeze({
        record,
        ...(typeof candidate.id === "string" ? { explicitId: candidate.id } : {}),
      });
    }),
  );
}

function indexById<T extends { readonly id: string }>(records: readonly T[]): ReadonlyMap<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

function mapIds<T extends { readonly id: string }>(
  namespace: StructurizrIdentityNamespace,
  records: readonly T[],
): ReadonlyMap<string, string> {
  return new Map(records.map((record) => [record.id, structurizrIdentifier(namespace, record.id)]));
}

function addIdentityMappings(document: ArchitectureDocumentV1): readonly StructurizrIdentityMapping[] {
  const mappings: StructurizrIdentityMapping[] = [
    { canonId: document.root.id, namespace: "architecture", structurizrId: "workspace" },
    ...document.elements.map((record) => ({
      canonId: record.id,
      namespace: "element" as const,
      structurizrId: structurizrIdentifier("element", record.id),
    })),
    ...document.interfaces.map((record) => ({
      canonId: record.id,
      namespace: "interface" as const,
      structurizrId: structurizrIdentifier("interface", record.id),
    })),
    ...document.responsibilities.responsibilities.map((record) => ({
      canonId: record.id,
      namespace: "responsibility" as const,
      structurizrId: structurizrIdentifier("responsibility", record.id),
    })),
    ...document.boundaries.map((record) => ({
      canonId: record.id,
      namespace: "boundary" as const,
      structurizrId: structurizrIdentifier("boundary", record.id),
    })),
    ...document.flows.map((record) => ({
      canonId: record.id,
      namespace: "flow" as const,
      structurizrId: structurizrIdentifier("flow", record.id),
    })),
    ...document.decisions.decisions.map((record) => ({
      canonId: record.id,
      namespace: "decision" as const,
      structurizrId: structurizrIdentifier("decision", record.id),
    })),
    ...document.decisions.references.map((record) => ({
      canonId: record.id,
      namespace: "reference" as const,
      structurizrId: structurizrIdentifier("reference", record.id),
    })),
    ...document.deployment.runtimeEnvironments.map((record) => ({
      canonId: record.id,
      namespace: "runtime-environment" as const,
      structurizrId: structurizrIdentifier("runtime-environment", record.id),
    })),
    ...document.deployment.deploymentNodes.map((record) => ({
      canonId: record.id,
      namespace: "deployment-node" as const,
      structurizrId: structurizrIdentifier("deployment-node", record.id),
    })),
    ...document.deployment.deploymentInstances.map((record) => ({
      canonId: record.id,
      namespace: "deployment-instance" as const,
      structurizrId: structurizrIdentifier("deployment-instance", record.id),
    })),
    ...document.deployment.infrastructureReferences.map((record) => ({
      canonId: record.id,
      namespace: "infrastructure-reference" as const,
      structurizrId: structurizrIdentifier("infrastructure-reference", record.id),
    })),
  ];

  mappings.sort(
    (left, right) => compareStrings(left.namespace, right.namespace) || compareStrings(left.canonId, right.canonId),
  );
  return Object.freeze(mappings.map((mapping) => Object.freeze(mapping)));
}

function createContext(document: ArchitectureDocumentV1, losses: LossCollector): ProjectionContext {
  const entries = relationshipEntries(document);
  const explicit = new Map<string, RelationshipEntry>();
  const byInterface = new Map<string, RelationshipEntry[]>();

  for (const entry of entries) {
    if (entry.explicitId !== undefined) explicit.set(entry.explicitId, entry);
    if (entry.record.interfaceId !== undefined) {
      const matches = byInterface.get(entry.record.interfaceId) ?? [];
      matches.push(entry);
      byInterface.set(entry.record.interfaceId, matches);
    }
  }

  return {
    document,
    elementIdentifiers: mapIds("element", document.elements),
    interfaceIdentifiers: mapIds("interface", document.interfaces),
    deploymentNodeIdentifiers: mapIds("deployment-node", document.deployment.deploymentNodes),
    deploymentInstanceIdentifiers: mapIds("deployment-instance", document.deployment.deploymentInstances),
    elementDslKinds: new Map(),
    relationshipEntries: entries,
    relationshipsByExplicitId: explicit,
    relationshipsByInterface: new Map(
      [...byInterface.entries()].map(([id, matches]) => [id, Object.freeze([...matches])]),
    ),
    losses,
  };
}

function elementTag(element: ElementRecord): string {
  return `CanonElement,CanonKind-${identifierPart(element.kind)}`;
}

function childKind(parent: ElementDslKind, element: ElementRecord): ElementDslKind {
  if (parent === "softwareSystem") return "container";
  if (parent === "container") return "component";
  if (parent === "component" || parent === "element") return "element";
  return element.kind === "system" || element.kind === "service" ? "softwareSystem" : "element";
}

function rootKind(element: ElementRecord): ElementDslKind {
  return element.kind === "system" || element.kind === "service" ? "softwareSystem" : "element";
}

function renderElement(
  context: ProjectionContext,
  element: ElementRecord,
  children: ReadonlyMap<string, readonly ElementRecord[]>,
  indent: number,
  parentKind?: ElementDslKind,
): string[] {
  const kind = parentKind === undefined ? rootKind(element) : childKind(parentKind, element);
  context.elementDslKinds.set(element.id, kind);

  if (element.parentId !== undefined && kind === "element") {
    const elementIndex = context.document.elements.findIndex((candidate) => candidate.id === element.id);
    context.losses.add(
      "unsupported-containment",
      `elements[${elementIndex}].parentId`,
      [element.id, element.parentId],
      `Structurizr cannot nest Canon element ${element.id} below ${element.parentId} at this abstraction level`,
    );
  }

  const isUnnested = element.parentId !== undefined && kind === "element";
  const declarationIndent = isUnnested ? 2 : indent;
  const identifier = context.elementIdentifiers.get(element.id) as string;
  const lines = [`${"    ".repeat(declarationIndent)}${identifier} = ${kind} ${quote(element.id)} {`];
  lines.push(`${"    ".repeat(declarationIndent + 1)}tags ${quote(elementTag(element))}`);

  const unnestedChildren: ElementRecord[] = [];
  if (kind !== "element") {
    for (const child of children.get(element.id) ?? []) {
      if (childKind(kind, child) === "element") unnestedChildren.push(child);
      else lines.push(...renderElement(context, child, children, declarationIndent + 1, kind));
    }
  }

  lines.push(`${"    ".repeat(declarationIndent)}}`);
  if (kind === "element") unnestedChildren.push(...(children.get(element.id) ?? []));
  for (const child of unnestedChildren) {
    lines.push(...renderElement(context, child, children, 2, kind));
  }
  return lines;
}

function renderElements(context: ProjectionContext): string[] {
  const children = new Map<string, ElementRecord[]>();
  const roots: ElementRecord[] = [];
  for (const element of context.document.elements) {
    if (element.parentId === undefined) roots.push(element);
    else {
      const siblings = children.get(element.parentId) ?? [];
      siblings.push(element);
      children.set(element.parentId, siblings);
    }
  }
  for (const siblings of children.values()) siblings.sort((left, right) => compareStrings(left.id, right.id));

  return roots
    .sort((left, right) => compareStrings(left.id, right.id))
    .flatMap((element) => renderElement(context, element, children, 2));
}

function relationshipDescription(relationship: RelationshipRecord, interfaceRecord?: InterfaceRecord): string {
  const parts = [`kind: ${relationship.kind}`];
  if (relationship.interfaceId !== undefined) parts.push(`interface: ${relationship.interfaceId}`);
  if (interfaceRecord !== undefined) parts.push(`owner: ${interfaceRecord.owner}`);
  return parts.join("; ");
}

function interfaceTechnology(interfaceRecord: InterfaceRecord | undefined): string | undefined {
  if (interfaceRecord === undefined) return undefined;
  return (
    [interfaceRecord.protocol, interfaceRecord.technology]
      .filter((value): value is string => value !== undefined)
      .join("; ") || undefined
  );
}

function renderRelationships(context: ProjectionContext): string[] {
  const lines: string[] = [];
  const interfaces = indexById(context.document.interfaces);

  for (const entry of context.relationshipEntries) {
    const relationship = entry.record;
    const source = context.elementIdentifiers.get(relationship.source) as string;
    const target = context.elementIdentifiers.get(relationship.target) as string;
    const contract = relationship.interfaceId === undefined ? undefined : interfaces.get(relationship.interfaceId);
    const technology = interfaceTechnology(contract);
    const fields = [source, "->", target, quote(relationshipDescription(relationship, contract))];
    if (technology !== undefined) fields.push(quote(technology));

    lines.push(`        ${fields.join(" ")} {`);
    const tags = ["CanonRelationship", `CanonRelationshipKind-${identifierPart(relationship.kind)}`];
    if (contract !== undefined) tags.push(`CanonInterface-${context.interfaceIdentifiers.get(contract.id) as string}`);
    lines.push(`            tags ${quote(tags.join(","))}`);
    lines.push("        }");
  }

  return lines;
}

function renderDeploymentInstance(
  context: ProjectionContext,
  node: DeploymentNode,
  instance: DeploymentInstance,
  mappings: readonly DeploymentMapping[],
  indent: number,
): string[] {
  const lines: string[] = [];
  const instancePath = `deployment.deploymentInstances[${context.document.deployment.deploymentInstances.findIndex((candidate) => candidate.id === instance.id)}]`;
  const instanceTag = `CanonDeploymentInstance:${context.deploymentInstanceIdentifiers.get(instance.id) as string}`;
  if (mappings.length === 0) {
    context.losses.add(
      "unsupported-deployment-instance",
      instancePath,
      [instance.id, node.id],
      `Deployment instance ${instance.id} has no Canon software-element mapping that Structurizr can instantiate`,
    );
    return lines;
  }

  const elements = indexById(context.document.elements);
  for (const mapping of mappings) {
    const element = elements.get(mapping.softwareElementId);
    const elementKind = context.elementDslKinds.get(mapping.softwareElementId);
    const elementIdentifier = context.elementIdentifiers.get(mapping.softwareElementId);
    if (element === undefined || elementKind === undefined || elementIdentifier === undefined) continue;

    const instanceKeyword =
      elementKind === "softwareSystem"
        ? "softwareSystemInstance"
        : elementKind === "container"
          ? "containerInstance"
          : undefined;
    if (instanceKeyword === undefined) {
      const mappingIndex = context.document.deployment.mappings.findIndex(
        (candidate) =>
          candidate.softwareElementId === mapping.softwareElementId &&
          candidate.deploymentInstanceId === mapping.deploymentInstanceId,
      );
      context.losses.add(
        "unsupported-deployment-mapping",
        `deployment.mappings[${mappingIndex}]`,
        [mapping.softwareElementId, mapping.deploymentInstanceId],
        `Structurizr cannot instantiate Canon element ${element.id} of projected kind ${elementKind}`,
      );
      continue;
    }

    const prefix = "    ".repeat(indent);
    lines.push(`${prefix}${instanceKeyword} ${elementIdentifier} {`);
    lines.push(`${prefix}    tags ${quote(instanceTag)}`);
    lines.push(`${prefix}}`);
  }
  return lines;
}

function renderDeployment(context: ProjectionContext): string[] {
  const lines: string[] = [];
  const environments = context.document.deployment.runtimeEnvironments;
  const nodes = context.document.deployment.deploymentNodes;
  const instancesByNode = new Map<string, DeploymentInstance[]>();
  const mappingsByInstance = new Map<string, DeploymentMapping[]>();

  for (const instance of context.document.deployment.deploymentInstances) {
    const values = instancesByNode.get(instance.nodeId) ?? [];
    values.push(instance);
    instancesByNode.set(instance.nodeId, values);
  }
  for (const mapping of context.document.deployment.mappings) {
    const values = mappingsByInstance.get(mapping.deploymentInstanceId) ?? [];
    values.push(mapping);
    mappingsByInstance.set(mapping.deploymentInstanceId, values);
  }

  const nodesByEnvironment = new Map<string, DeploymentNode[]>();
  for (const node of nodes) {
    const values = nodesByEnvironment.get(node.environmentId) ?? [];
    values.push(node);
    nodesByEnvironment.set(node.environmentId, values);
  }

  for (const environment of environments) {
    const environmentIdentifier =
      context.document.deployment.runtimeEnvironments.length > 0
        ? structurizrIdentifier("runtime-environment", environment.id)
        : "";
    const environmentLabel = environment.displayName ?? environment.id;
    lines.push(`        ${environmentIdentifier} = deploymentEnvironment ${quote(environmentLabel)} {`);

    for (const node of nodesByEnvironment.get(environment.id) ?? []) {
      const nodeIdentifier = context.deploymentNodeIdentifiers.get(node.id) as string;
      const nodeLabel = node.displayName ?? node.id;
      lines.push(`        ${nodeIdentifier} = deploymentNode ${quote(nodeLabel)} {`);
      for (const instance of instancesByNode.get(node.id) ?? []) {
        lines.push(...renderDeploymentInstance(context, node, instance, mappingsByInstance.get(instance.id) ?? [], 3));
      }
      lines.push("        }");
    }

    lines.push("        }");
  }

  for (const reference of context.document.deployment.infrastructureReferences) {
    const index = context.document.deployment.infrastructureReferences.findIndex(
      (candidate) => candidate.id === reference.id,
    );
    context.losses.add(
      "unsupported-infrastructure-reference",
      `deployment.infrastructureReferences[${index}]`,
      [reference.id],
      `Structurizr has no lossless placement for Canon infrastructure reference ${reference.id}: ${reference.reference}`,
    );
  }

  return lines;
}

function direction(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return ["tb", "bt", "lr", "rl"].includes(value) ? value : undefined;
}

function renderPresentation(context: ProjectionContext, view: ViewSpec, viewIndex: number, lines: string[]): void {
  const presentation = view.presentation;
  if (presentation === undefined) return;

  const path = `views[${viewIndex}].presentation`;
  const layout = presentation.layout;
  const viewDirection = direction(presentation.direction);
  if (presentation.direction !== undefined && viewDirection === undefined) {
    context.losses.add(
      "unsupported-presentation",
      `${path}.direction`,
      [view.key],
      `Structurizr autoLayout does not support Canon direction ${presentation.direction}`,
    );
  }
  if (layout !== undefined && layout !== "auto" && layout !== "automatic") {
    context.losses.add(
      "unsupported-presentation",
      `${path}.layout`,
      [view.key],
      `Structurizr DSL cannot represent Canon layout hint ${layout}`,
    );
  }
  if (presentation.grouping !== undefined) {
    context.losses.add(
      "unsupported-presentation",
      `${path}.grouping`,
      [view.key],
      `Structurizr DSL cannot represent Canon grouping hint ${presentation.grouping}`,
    );
  }
  if ((layout === "auto" || layout === "automatic" || viewDirection !== undefined) && viewDirection !== undefined) {
    lines.push(`            autoLayout ${viewDirection}`);
  } else if (layout === "auto" || layout === "automatic") {
    lines.push("            autoLayout");
  }
}

function viewPath(viewIndex: number, mode: "include" | "exclude", referenceIndex: number): string {
  return `views[${viewIndex}].scope.${mode}[${referenceIndex}]`;
}

function addUnsupportedViewReference(
  context: ProjectionContext,
  view: ViewSpec,
  path: string,
  reference: ViewReference,
): void {
  context.losses.add(
    "unsupported-view-reference",
    path,
    [view.key, reference.id],
    `Structurizr cannot represent ${reference.kind} ${reference.id} in a ${view.kind} view scope`,
  );
}

function renderStructuralView(context: ProjectionContext, view: ViewSpec, viewIndex: number): string[] {
  const lines = [`        systemLandscape ${quote(viewKey(view.key))} {`];
  if (view.title !== undefined) lines.push(`            title ${quote(view.title)}`);
  renderPresentation(context, view, viewIndex, lines);

  for (const [mode, references] of [
    ["include", view.scope.include],
    ["exclude", view.scope.exclude],
  ] as const) {
    for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
      const reference = references[referenceIndex];
      if (reference.kind === "element") {
        lines.push(`            ${mode} ${context.elementIdentifiers.get(reference.id) as string}`);
      } else {
        addUnsupportedViewReference(context, view, viewPath(viewIndex, mode, referenceIndex), reference);
      }
    }
  }

  lines.push("        }");
  return lines;
}

function matchingFlowRelationships(context: ProjectionContext, step: FlowStep): readonly RelationshipEntry[] {
  if (step.relationshipId !== undefined) {
    const relationship = context.relationshipsByExplicitId.get(step.relationshipId);
    if (relationship !== undefined) return [relationship];
    return [];
  }
  if (step.interfaceId !== undefined) return context.relationshipsByInterface.get(step.interfaceId) ?? [];
  return [];
}

function dynamicStepDescription(flow: Flow, step: FlowStep, relationship: RelationshipRecord): string {
  const parts = [`flow: ${flow.id}`, `kind: ${relationship.kind}`];
  if (relationship.interfaceId !== undefined) parts.push(`interface: ${relationship.interfaceId}`);
  if (step.operation !== undefined) parts.push(`operation: ${step.operation}`);
  if (step.information !== undefined) parts.push(`information: ${step.information}`);
  return parts.join("; ");
}

function renderDynamicFlow(
  context: ProjectionContext,
  flow: Flow,
  flowIndex: number,
  order: { value: number },
  lines: string[],
  viewKeyValue: string,
): void {
  if (flow.steps.length === 0) {
    context.losses.add(
      "unsupported-flow",
      `flows[${flowIndex}]`,
      [flow.id, viewKeyValue],
      `Structurizr dynamic views cannot show an empty Canon flow: ${flow.id}`,
    );
    return;
  }

  for (let stepIndex = 0; stepIndex < flow.steps.length; stepIndex += 1) {
    const step = flow.steps[stepIndex];
    const matches = matchingFlowRelationships(context, step);
    const path = `flows[${flowIndex}].steps[${stepIndex}]`;
    if (matches.length === 0) {
      context.losses.add(
        "unsupported-flow",
        path,
        [flow.id, step.relationshipId ?? step.interfaceId ?? ""],
        `Structurizr dynamic views require a static relationship for Canon flow step ${flow.id}[${stepIndex}]`,
      );
      continue;
    }
    if (matches.length > 1) {
      context.losses.add(
        "ambiguous-flow-step",
        path,
        [flow.id, step.interfaceId ?? ""],
        `Canon flow step ${flow.id}[${stepIndex}] matches multiple Structurizr relationships`,
      );
    }

    for (const match of matches) {
      if (step.interfaceId !== undefined && match.record.interfaceId !== step.interfaceId) {
        context.losses.add(
          "unsupported-flow",
          path,
          [flow.id, step.interfaceId],
          `Canon flow step ${flow.id}[${stepIndex}] interface does not match its projected relationship`,
        );
      }
      const source = context.elementIdentifiers.get(match.record.source) as string;
      const target = context.elementIdentifiers.get(match.record.target) as string;
      lines.push(
        `            ${order.value}: ${source} -> ${target} ${quote(dynamicStepDescription(flow, step, match.record))}`,
      );
      order.value += 1;
    }
  }
}

function renderDynamicView(context: ProjectionContext, view: ViewSpec, viewIndex: number): string[] {
  const flowIds = view.scope.include.filter((reference) => reference.kind === "flow").map((reference) => reference.id);
  const includedElements = view.scope.include.filter((reference) => reference.kind === "element");
  const supportedScopes = includedElements.filter((reference) => {
    const kind = context.elementDslKinds.get(reference.id);
    return kind === "softwareSystem" || kind === "container";
  });

  let scope = "*";
  if (supportedScopes.length === 1 && includedElements.length === 1) {
    scope = context.elementIdentifiers.get(supportedScopes[0].id) as string;
  } else if (includedElements.length > 0) {
    context.losses.add(
      "unsupported-view-scope",
      `views[${viewIndex}].scope.include`,
      includedElements.map((reference) => reference.id),
      `Structurizr dynamic views have one scope, but Canon view ${view.key} declares multiple or incompatible element scopes`,
    );
  }

  const lines = [`        dynamic ${scope} ${quote(viewKey(view.key))} {`];
  if (view.title !== undefined) lines.push(`            title ${quote(view.title)}`);
  renderPresentation(context, view, viewIndex, lines);

  for (let referenceIndex = 0; referenceIndex < view.scope.include.length; referenceIndex += 1) {
    const reference = view.scope.include[referenceIndex];
    if (reference.kind === "flow" || reference.kind === "element") continue;
    addUnsupportedViewReference(context, view, viewPath(viewIndex, "include", referenceIndex), reference);
  }
  for (let referenceIndex = 0; referenceIndex < view.scope.exclude.length; referenceIndex += 1) {
    const reference = view.scope.exclude[referenceIndex];
    context.losses.add(
      "unsupported-view-exclusion",
      viewPath(viewIndex, "exclude", referenceIndex),
      [view.key, reference.id],
      `Structurizr dynamic views have no Canon-equivalent exclude scope for ${reference.kind} ${reference.id}`,
    );
  }

  const flows = indexById(context.document.flows);
  const order = { value: 1 };
  for (const flowId of flowIds) {
    const flow = flows.get(flowId) as Flow;
    const flowIndex = context.document.flows.findIndex((candidate) => candidate.id === flowId);
    renderDynamicFlow(context, flow, flowIndex, order, lines, view.key);
  }

  lines.push("        }");
  return lines;
}

function deploymentEnvironmentForReference(context: ProjectionContext, reference: ViewReference): string | undefined {
  if (reference.kind === "runtime-environment") return reference.id;
  if (reference.kind === "deployment-node") {
    return context.document.deployment.deploymentNodes.find((node) => node.id === reference.id)?.environmentId;
  }
  if (reference.kind === "deployment-instance") {
    const instance = context.document.deployment.deploymentInstances.find((candidate) => candidate.id === reference.id);
    return context.document.deployment.deploymentNodes.find((node) => node.id === instance?.nodeId)?.environmentId;
  }
  return undefined;
}

function renderDeploymentView(context: ProjectionContext, view: ViewSpec, viewIndex: number): string[] {
  const environmentIds = new Set<string>();
  for (const reference of view.scope.include) {
    const environment = deploymentEnvironmentForReference(context, reference);
    if (environment !== undefined) environmentIds.add(environment);
  }

  if (environmentIds.size !== 1) {
    context.losses.add(
      "unsupported-view-scope",
      `views[${viewIndex}].scope`,
      [view.key, ...environmentIds],
      `Structurizr deployment views require exactly one Canon runtime environment for view ${view.key}`,
    );
    return [];
  }

  const environment = [...environmentIds][0];
  const elementScopes = view.scope.include.filter(
    (reference) => reference.kind === "element" && context.elementDslKinds.get(reference.id) === "softwareSystem",
  );
  const scope = elementScopes.length === 1 ? (context.elementIdentifiers.get(elementScopes[0].id) as string) : "*";
  const environmentIdentifier = context.document.deployment.runtimeEnvironments.find(
    (candidate) => candidate.id === environment,
  );
  const lines = [
    `        deployment ${scope} ${context.document.deployment.runtimeEnvironments.length > 0 ? (context.document.deployment.runtimeEnvironments.find((candidate) => candidate.id === environment) ? structurizrIdentifier("runtime-environment", environment) : quote(environment)) : quote(environment)} ${quote(viewKey(view.key))} {`,
  ];
  if (view.title !== undefined) lines.push(`            title ${quote(view.title)}`);
  renderPresentation(context, view, viewIndex, lines);

  for (const [mode, references] of [
    ["include", view.scope.include],
    ["exclude", view.scope.exclude],
  ] as const) {
    for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
      const reference = references[referenceIndex];
      if (reference.kind === "element" || reference.kind === "deployment-node") {
        const identifier =
          reference.kind === "element"
            ? context.elementIdentifiers.get(reference.id)
            : context.deploymentNodeIdentifiers.get(reference.id);
        if (identifier !== undefined) lines.push(`            ${mode} ${identifier}`);
        continue;
      }
      if (reference.kind === "runtime-environment" && reference.id === environment) continue;
      addUnsupportedViewReference(context, view, viewPath(viewIndex, mode, referenceIndex), reference);
    }
  }

  if (environmentIdentifier === undefined) {
    context.losses.add(
      "unsupported-view-scope",
      `views[${viewIndex}].scope`,
      [view.key, environment],
      `Runtime environment ${environment} is not available for Structurizr deployment view ${view.key}`,
    );
  }
  lines.push("        }");
  return lines;
}

function renderViews(context: ProjectionContext): {
  readonly lines: readonly string[];
  readonly mappings: readonly StructurizrViewMapping[];
} {
  const lines: string[] = [];
  const mappings: StructurizrViewMapping[] = [];
  for (let viewIndex = 0; viewIndex < context.document.views.length; viewIndex += 1) {
    const view = context.document.views[viewIndex];
    mappings.push({ canonKey: view.key, kind: view.kind, structurizrKey: viewKey(view.key) });
    const rendered =
      view.kind === "structural"
        ? renderStructuralView(context, view, viewIndex)
        : view.kind === "dynamic"
          ? renderDynamicView(context, view, viewIndex)
          : renderDeploymentView(context, view, viewIndex);
    lines.push(...rendered);
  }
  return { lines: Object.freeze(lines), mappings: Object.freeze(mappings.map((mapping) => Object.freeze(mapping))) };
}

function addUnsupportedCanonSemantics(context: ProjectionContext): void {
  const { document, losses } = context;
  for (let index = 0; index < document.responsibilities.responsibilities.length; index += 1) {
    const fact = document.responsibilities.responsibilities[index];
    losses.add(
      "unsupported-responsibility",
      `responsibilities.responsibilities[${index}]`,
      [fact.id, fact.target.id],
      `Structurizr has no lossless responsibility construct for Canon concern ${fact.concern}`,
    );
  }
  for (let index = 0; index < document.authority.authority.length; index += 1) {
    const fact: AuthorityFact = document.authority.authority[index];
    losses.add(
      "unsupported-authority",
      `authority.authority[${index}]`,
      [fact.concern, fact.owner],
      `Structurizr has no lossless authority construct for Canon concern ${fact.concern}`,
    );
  }
  for (let index = 0; index < document.authority.ownership.length; index += 1) {
    const fact: OwnershipFact = document.authority.ownership[index];
    losses.add(
      "unsupported-ownership",
      `authority.ownership[${index}]`,
      [fact.resource, fact.owner],
      `Structurizr has no lossless ownership construct for Canon resource ${fact.resource}`,
    );
  }
  for (let index = 0; index < document.boundaries.length; index += 1) {
    const boundary = document.boundaries[index];
    losses.add(
      "unsupported-boundary",
      `boundaries[${index}]`,
      [boundary.id, ...boundary.memberIds],
      `Structurizr groups cannot preserve Canon ${boundary.kind} boundary semantics for ${boundary.id}`,
    );
  }
  for (let index = 0; index < document.constraints.length; index += 1) {
    const constraint: ArchitectureConstraint = document.constraints[index];
    const ids =
      constraint.kind === "single-authority"
        ? [constraint.concern]
        : constraint.kind === "must-go-through"
          ? [constraint.source, constraint.target, constraint.through]
          : [constraint.source, constraint.target];
    losses.add(
      "unsupported-constraint",
      `constraints[${index}]`,
      ids,
      `Structurizr has no lossless Canon constraint construct for ${constraint.kind}`,
    );
  }
  for (let index = 0; index < document.repositoryMappings.length; index += 1) {
    const mapping = document.repositoryMappings[index];
    losses.add(
      "unsupported-repository-mapping",
      `repositoryMappings[${index}]`,
      [mapping.canonId],
      `Structurizr has no lossless repository mapping construct for ${mapping.canonId}`,
    );
  }
  for (let index = 0; index < document.decisions.decisions.length; index += 1) {
    const decision = document.decisions.decisions[index];
    losses.add(
      "unsupported-decision",
      `decisions.decisions[${index}]`,
      [decision.id, ...decision.targetIds, ...decision.referenceIds, ...decision.supersedes],
      `Structurizr ADR extensions cannot preserve Canon decision semantics for ${decision.id}`,
    );
  }
  for (let index = 0; index < document.decisions.references.length; index += 1) {
    const reference = document.decisions.references[index];
    losses.add(
      "unsupported-reference",
      `decisions.references[${index}]`,
      [reference.id],
      `Structurizr cannot preserve Canon reference ${reference.id} without a renderer-specific document source`,
    );
  }
  for (let index = 0; index < document.decisions.referenceAttachments.length; index += 1) {
    const attachment = document.decisions.referenceAttachments[index];
    losses.add(
      "unsupported-reference-attachment",
      `decisions.referenceAttachments[${index}]`,
      [attachment.targetId, ...attachment.referenceIds],
      `Structurizr cannot preserve Canon reference attachment for ${attachment.targetId}`,
    );
  }
  const projectedFlows = new Set<string>();
  for (const view of document.views) {
    if (view.kind === "dynamic") {
      for (const reference of view.scope.include) if (reference.kind === "flow") projectedFlows.add(reference.id);
    }
  }
  for (let index = 0; index < document.flows.length; index += 1) {
    const flow = document.flows[index];
    if (!projectedFlows.has(flow.id)) {
      losses.add(
        "unsupported-flow",
        `flows[${index}]`,
        [flow.id],
        `Canon flow ${flow.id} is not declared in a projected dynamic view`,
      );
    }
  }
}

function renderWorkspace(context: ProjectionContext, views: readonly string[]): string {
  const document = context.document;
  const lines = [
    `workspace ${quote(document.documentId)} {`,
    "    properties {",
    `        ${quote("canon.version")} ${quote(String(document.canonVersion))}`,
    `        ${quote("canon.documentId")} ${quote(document.documentId)}`,
    `        ${quote("canon.rootId")} ${quote(document.root.id)}`,
    "    }",
    "    model {",
    "        !identifiers flat",
    ...renderElements(context),
    ...renderRelationships(context),
    ...renderDeployment(context),
    "    }",
    "    views {",
    ...views.map((line) => line),
    "    }",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/** Project a validated Architecture Canon into current Structurizr DSL plus explicit losses. */
export function projectArchitectureDocumentToStructurizr(document: ArchitectureDocumentV1): StructurizrProjection {
  const validation = validateArchitectureDocument(document);
  if (!validation.valid) {
    const diagnostics = validation.diagnostics.map(({ code, path }) => `${code} at ${path}`).join(", ");
    throw new Error(`cannot project invalid Architecture Canon: ${diagnostics}`);
  }

  const losses = new LossCollector();
  const context = createContext(document, losses);
  const renderedViews = renderViews(context);
  addUnsupportedCanonSemantics(context);

  return Object.freeze({
    canonVersion: document.canonVersion,
    documentId: document.documentId,
    dsl: renderWorkspace(context, renderedViews.lines),
    identityMappings: addIdentityMappings(document),
    viewMappings: renderedViews.mappings,
    losses: losses.finish(),
  });
}

export const projectArchitectureToStructurizr = projectArchitectureDocumentToStructurizr;
