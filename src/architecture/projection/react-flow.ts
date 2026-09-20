import { validateArchitectureDocument } from "../canon/validate.js";
import type { ArchitectureDocumentV1 } from "../canon/document.js";
import type { ElementKind, ElementRecord } from "../canon/elements.js";
import type { RelationshipKind, RelationshipRecord } from "../canon/relationships.js";
import type { ViewReference, ViewSpec } from "../canon/views.js";
import ELK, { type ElkEdgeSection, type ElkExtendedEdge, type ElkNode } from "elkjs/lib/main.js";

type ElkConstructor = new () => {
  layout(graph: ElkNode): Promise<ElkNode>;
};

const ElkLayout = ELK as unknown as ElkConstructor;

export const REACT_FLOW_PROJECTION_LOSS_CODES = [
  "unsupported-view-kind",
  "unsupported-view-reference",
  "unsupported-view-exclusion",
  "unsupported-view-root",
  "unsupported-presentation",
  "unsupported-containment",
  "unsupported-relationship",
] as const;

export type ReactFlowProjectionLossCode = (typeof REACT_FLOW_PROJECTION_LOSS_CODES)[number];

export interface ReactFlowProjectionLoss {
  readonly code: ReactFlowProjectionLossCode;
  readonly path: string;
  readonly canonIds: readonly string[];
  readonly message: string;
}

export interface ReactFlowPosition {
  readonly x: number;
  readonly y: number;
}

export interface ReactFlowNodeData {
  readonly canonId: string;
  readonly viewKey: string;
  readonly kind: ElementKind;
  readonly label: string;
}

/** The renderer-neutral subset of a React Flow node emitted by this projection. */
export interface ReactFlowNode {
  readonly id: string;
  readonly type: "architecture";
  readonly data: ReactFlowNodeData;
  readonly position: ReactFlowPosition;
  readonly width: number;
  readonly height: number;
  readonly parentId?: string;
  readonly extent?: "parent";
}

export interface ReactFlowEdgePoint extends ReactFlowPosition {}

export interface ReactFlowEdgeSection {
  readonly startPoint: ReactFlowEdgePoint;
  readonly endPoint: ReactFlowEdgePoint;
  readonly bendPoints: readonly ReactFlowEdgePoint[];
}

export interface ReactFlowEdgeData {
  readonly viewKey: string;
  readonly canonSourceId: string;
  readonly canonTargetId: string;
  readonly canonRelationshipId?: string;
  readonly kind: RelationshipKind;
  readonly interfaceId?: string;
  readonly sections: readonly ReactFlowEdgeSection[];
}

/** The renderer-neutral subset of a React Flow edge emitted by this projection. */
export interface ReactFlowEdge {
  readonly id: string;
  readonly type: "default";
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly data: ReactFlowEdgeData;
}

export type ReactFlowLayoutDirection = "RIGHT" | "LEFT" | "DOWN" | "UP";

export interface ReactFlowLayoutSummary {
  readonly algorithm: "layered";
  readonly direction: ReactFlowLayoutDirection;
  readonly nodeWidth: number;
  readonly nodeHeight: number;
}

export interface ReactFlowViewProjection {
  readonly key: string;
  readonly kind: ViewSpec["kind"];
  readonly title?: string;
  readonly description?: string;
  readonly layout: ReactFlowLayoutSummary;
  readonly nodes: readonly ReactFlowNode[];
  readonly edges: readonly ReactFlowEdge[];
  readonly losses: readonly ReactFlowProjectionLoss[];
}

export interface ReactFlowProjection {
  readonly canonVersion: ArchitectureDocumentV1["canonVersion"];
  readonly documentId: ArchitectureDocumentV1["documentId"];
  readonly nodes: readonly ReactFlowNode[];
  readonly edges: readonly ReactFlowEdge[];
  readonly views: readonly ReactFlowViewProjection[];
  readonly losses: readonly ReactFlowProjectionLoss[];
}

export interface ReactFlowProjectionOptions {
  /** Project one declared view; when omitted, all declared views are projected. */
  readonly viewKey?: string;
  readonly nodeWidth?: number;
  readonly nodeHeight?: number;
  readonly layerSpacing?: number;
  readonly nodeSpacing?: number;
}

interface RelationshipEntry {
  readonly record: RelationshipRecord;
  readonly index: number;
  readonly identity?: string;
  readonly key: string;
}

interface LayoutOptions {
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  readonly layerSpacing: number;
  readonly nodeSpacing: number;
}

class LossCollector {
  private readonly values: ReactFlowProjectionLoss[] = [];
  private readonly keys = new Set<string>();

  add(code: ReactFlowProjectionLossCode, path: string, canonIds: readonly string[], message: string): void {
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

  finish(): readonly ReactFlowProjectionLoss[] {
    return Object.freeze(
      [...this.values].sort(
        (left, right) => compareStrings(left.path, right.path) || compareStrings(left.code, right.code),
      ),
    );
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function identifierPart(value: string): string {
  return [...value]
    .map((character) => {
      if (/^[A-Za-z0-9]$/u.test(character)) return character;
      return `_x${character.codePointAt(0)?.toString(16)}_`;
    })
    .join("");
}

function nodeId(viewKey: string, canonId: string): string {
  return `react_flow_${identifierPart(viewKey)}_element_${identifierPart(canonId)}`;
}

function relationshipKey(record: RelationshipRecord): string {
  return [record.source, record.target, record.kind, record.interfaceId ?? ""].join("\u0000");
}

function relationshipEntries(document: ArchitectureDocumentV1): readonly RelationshipEntry[] {
  return Object.freeze(
    document.relationships.map((record, index) => {
      const candidate = record as unknown as { readonly id?: unknown };
      const identity = typeof candidate.id === "string" ? candidate.id : undefined;
      return Object.freeze({
        record,
        index,
        ...(identity === undefined ? {} : { identity }),
        key: relationshipKey(record),
      });
    }),
  );
}

function relationshipEdgeId(viewKey: string, relationship: RelationshipEntry): string {
  return `react_flow_${identifierPart(viewKey)}_relationship_${identifierPart(relationship.key)}`;
}

function relationshipLabel(relationship: RelationshipRecord): string {
  return relationship.kind;
}

function ensurePositiveFinite(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return Object.is(resolved, -0) ? 0 : resolved;
}

function readLayoutOptions(options: ReactFlowProjectionOptions): LayoutOptions {
  return {
    nodeWidth: ensurePositiveFinite(options.nodeWidth, 180, "nodeWidth"),
    nodeHeight: ensurePositiveFinite(options.nodeHeight, 80, "nodeHeight"),
    layerSpacing: ensurePositiveFinite(options.layerSpacing, 80, "layerSpacing"),
    nodeSpacing: ensurePositiveFinite(options.nodeSpacing, 40, "nodeSpacing"),
  };
}

function directionFor(view: ViewSpec, losses: LossCollector, viewIndex: number): ReactFlowLayoutDirection {
  const value = view.presentation?.direction;
  if (value === undefined) return "RIGHT";

  switch (value.toLocaleLowerCase("en-US")) {
    case "lr":
    case "right":
      return "RIGHT";
    case "rl":
    case "left":
      return "LEFT";
    case "tb":
    case "down":
      return "DOWN";
    case "bt":
    case "up":
      return "UP";
    default:
      losses.add(
        "unsupported-presentation",
        `views[${viewIndex}].presentation.direction`,
        [view.key],
        `React Flow + ELK cannot interpret view direction hint: ${value}`,
      );
      return "RIGHT";
  }
}

function addPresentationLosses(view: ViewSpec, viewIndex: number, losses: LossCollector): void {
  const presentation = view.presentation;
  if (presentation === undefined) return;

  if (
    presentation.layout !== undefined &&
    !["auto", "automatic", "layered"].includes(presentation.layout.toLocaleLowerCase("en-US"))
  ) {
    losses.add(
      "unsupported-presentation",
      `views[${viewIndex}].presentation.layout`,
      [view.key],
      `React Flow + ELK cannot preserve view layout hint: ${presentation.layout}`,
    );
  }
  if (presentation.grouping !== undefined) {
    losses.add(
      "unsupported-presentation",
      `views[${viewIndex}].presentation.grouping`,
      [view.key],
      `React Flow + ELK cannot preserve view grouping hint: ${presentation.grouping}`,
    );
  }
}

function viewPath(viewIndex: number, mode: "include" | "exclude", referenceIndex: number): string {
  return `views[${viewIndex}].scope.${mode}[${referenceIndex}]`;
}

function addUnsupportedReference(
  view: ViewSpec,
  viewIndex: number,
  mode: "include" | "exclude",
  referenceIndex: number,
  reference: ViewReference,
  losses: LossCollector,
): void {
  const code = mode === "include" ? "unsupported-view-reference" : "unsupported-view-exclusion";
  losses.add(
    code,
    viewPath(viewIndex, mode, referenceIndex),
    [view.key, reference.id],
    `React Flow + ELK cannot represent ${reference.kind} ${reference.id} in a structural view ${mode} scope`,
  );
}

function explicitRelationshipId(reference: ViewReference): string | undefined {
  return reference.kind === "relationship" ? reference.id : undefined;
}

function relationshipByIdentity(
  relationships: readonly RelationshipEntry[],
  identity: string,
): RelationshipEntry | undefined {
  return relationships.find((relationship) => relationship.identity === identity);
}

function addSelectedElement(
  selected: Set<string>,
  elementId: string,
  elementsById: ReadonlyMap<string, ElementRecord>,
): void {
  if (elementsById.has(elementId)) selected.add(elementId);
}

function finiteCoordinate(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : 0;
}

function asPoint(point: { readonly x: number; readonly y: number }): ReactFlowEdgePoint {
  return Object.freeze({ x: finiteCoordinate(point.x), y: finiteCoordinate(point.y) });
}

function edgeSections(edge: { readonly sections?: readonly ElkEdgeSection[] }): readonly ReactFlowEdgeSection[] {
  return Object.freeze(
    (edge.sections ?? []).map((section) =>
      Object.freeze({
        startPoint: asPoint(section.startPoint),
        endPoint: asPoint(section.endPoint),
        bendPoints: Object.freeze((section.bendPoints ?? []).map(asPoint)),
      }),
    ),
  );
}

function childElements(elements: readonly ElementRecord[], parentId: string | undefined): readonly ElementRecord[] {
  return elements.filter((element) => element.parentId === parentId);
}

function buildElkNodeTree(
  elements: readonly ElementRecord[],
  selected: ReadonlySet<string>,
  parentId: string | undefined,
  layout: LayoutOptions,
): ElkNode[] {
  return childElements(elements, parentId)
    .filter((element) => selected.has(element.id))
    .map((element) => {
      const children = buildElkNodeTree(elements, selected, element.id, layout);
      return {
        id: element.id,
        width: layout.nodeWidth,
        height: layout.nodeHeight,
        ...(children.length === 0 ? {} : { children }),
      } satisfies ElkNode;
    });
}

function collectLaidOutNodes(node: ElkNode, result: Map<string, ElkNode>): void {
  for (const child of node.children ?? []) {
    result.set(child.id, child);
    collectLaidOutNodes(child, result);
  }
}

function findElementIndex(document: ArchitectureDocumentV1, id: string): number {
  return document.elements.findIndex((element) => element.id === id);
}

function projectViewGraph(
  document: ArchitectureDocumentV1,
  view: ViewSpec,
  viewIndex: number,
  relationships: readonly RelationshipEntry[],
  layout: LayoutOptions,
): {
  readonly selected: ReadonlySet<string>;
  readonly entries: readonly RelationshipEntry[];
  readonly losses: LossCollector;
  readonly direction: ReactFlowLayoutDirection;
} {
  const losses = new LossCollector();
  const elementsById = new Map(document.elements.map((element) => [element.id, element]));
  const selected = new Set<string>();
  const includedRelationships = new Set<RelationshipEntry>();
  const excludedElementIds = new Set<string>();
  const excludedRelationshipIds = new Set<string>();

  if (view.kind !== "structural") {
    losses.add(
      "unsupported-view-kind",
      `views[${viewIndex}]`,
      [view.key],
      `React Flow + ELK currently projects structural views only; ${view.kind} view ${view.key} is unsupported`,
    );
    return { selected, entries: Object.freeze([]), losses, direction: "RIGHT" };
  }

  addPresentationLosses(view, viewIndex, losses);
  const direction = directionFor(view, losses, viewIndex);

  if (view.root !== undefined) {
    if (view.root.kind !== "element") {
      losses.add(
        "unsupported-view-root",
        `views[${viewIndex}].root`,
        [view.key, view.root.id],
        `React Flow + ELK structural views require an element root, not ${view.root.kind} ${view.root.id}`,
      );
    } else {
      addSelectedElement(selected, view.root.id, elementsById);
    }
  }

  for (let referenceIndex = 0; referenceIndex < view.scope.include.length; referenceIndex += 1) {
    const reference = view.scope.include[referenceIndex];
    if (reference.kind === "element") {
      addSelectedElement(selected, reference.id, elementsById);
    } else if (reference.kind === "relationship") {
      const relationship = relationshipByIdentity(relationships, reference.id);
      if (relationship !== undefined) {
        includedRelationships.add(relationship);
        addSelectedElement(selected, relationship.record.source, elementsById);
        addSelectedElement(selected, relationship.record.target, elementsById);
      }
    } else {
      addUnsupportedReference(view, viewIndex, "include", referenceIndex, reference, losses);
    }
  }

  for (let referenceIndex = 0; referenceIndex < view.scope.exclude.length; referenceIndex += 1) {
    const reference = view.scope.exclude[referenceIndex];
    if (reference.kind === "element") {
      excludedElementIds.add(reference.id);
    } else if (reference.kind === "relationship") {
      excludedRelationshipIds.add(reference.id);
    } else {
      addUnsupportedReference(view, viewIndex, "exclude", referenceIndex, reference, losses);
    }
  }

  for (const elementId of excludedElementIds) selected.delete(elementId);
  const projectedRelationships = relationships.filter((relationship) => {
    const sourceSelected = selected.has(relationship.record.source);
    const targetSelected = selected.has(relationship.record.target);
    const explicitlyIncluded = includedRelationships.has(relationship);
    const explicitlyExcluded =
      relationship.identity !== undefined && excludedRelationshipIds.has(relationship.identity);
    if (explicitlyIncluded && !explicitlyExcluded && (!sourceSelected || !targetSelected)) {
      losses.add(
        "unsupported-relationship",
        `relationships[${relationship.index}]`,
        [relationship.record.source, relationship.record.target],
        `React Flow + ELK cannot preserve relationship endpoints omitted by view scope: ${relationship.record.source} -> ${relationship.record.target}`,
      );
    }
    return sourceSelected && targetSelected && !explicitlyExcluded;
  });

  for (const element of document.elements) {
    if (!selected.has(element.id) || element.parentId === undefined) continue;
    if (!selected.has(element.parentId)) {
      losses.add(
        "unsupported-containment",
        `elements[${findElementIndex(document, element.id)}].parentId`,
        [element.id, element.parentId],
        `React Flow + ELK cannot preserve containment parent omitted by view scope: ${element.id} -> ${element.parentId}`,
      );
    }
  }

  return {
    selected,
    entries: Object.freeze(projectedRelationships),
    losses,
    direction,
  };
}

async function layoutGraph(
  document: ArchitectureDocumentV1,
  view: ViewSpec,
  selected: ReadonlySet<string>,
  relationships: readonly RelationshipEntry[],
  direction: ReactFlowLayoutDirection,
  layout: LayoutOptions,
): Promise<{
  readonly nodes: readonly ReactFlowNode[];
  readonly edges: readonly ReactFlowEdge[];
}> {
  const elements = document.elements.filter((element) => selected.has(element.id));
  const elkEdges = relationships.map((relationship) => ({
    id: relationshipEdgeId(view.key, relationship),
    sources: [relationship.record.source],
    targets: [relationship.record.target],
  }));
  const graph: ElkNode = {
    id: `react_flow_${identifierPart(view.key)}_root`,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layout.layerSpacing),
      "elk.spacing.nodeNode": String(layout.nodeSpacing),
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: buildElkNodeTree(document.elements, selected, undefined, layout),
    ...(elkEdges.length === 0 ? {} : { edges: elkEdges }),
  };

  const laidOut = await new ElkLayout().layout(graph);
  const laidOutNodes = new Map<string, ElkNode>();
  collectLaidOutNodes(laidOut, laidOutNodes);
  const nodeIds = new Map(elements.map((element) => [element.id, nodeId(view.key, element.id)]));

  const nodes = elements.map((element) => {
    const laidOutNode = laidOutNodes.get(element.id);
    const parentNodeId = element.parentId === undefined ? undefined : nodeIds.get(element.parentId);
    return Object.freeze({
      id: nodeIds.get(element.id) as string,
      type: "architecture" as const,
      data: Object.freeze({
        canonId: element.id,
        viewKey: view.key,
        kind: element.kind,
        label: element.displayName ?? element.id,
      }),
      position: Object.freeze({
        x: finiteCoordinate(laidOutNode?.x),
        y: finiteCoordinate(laidOutNode?.y),
      }),
      width: layout.nodeWidth,
      height: layout.nodeHeight,
      ...(parentNodeId === undefined ? {} : { parentId: parentNodeId, extent: "parent" as const }),
    });
  });

  const laidOutEdges = new Map((laidOut.edges ?? []).map((edge: ElkExtendedEdge) => [edge.id, edge]));
  const edges = relationships.map((relationship) => {
    const edgeId = relationshipEdgeId(view.key, relationship);
    const edge = laidOutEdges.get(edgeId);
    return Object.freeze({
      id: edgeId,
      type: "default" as const,
      source: nodeIds.get(relationship.record.source) as string,
      target: nodeIds.get(relationship.record.target) as string,
      label: relationshipLabel(relationship.record),
      data: Object.freeze({
        viewKey: view.key,
        canonSourceId: relationship.record.source,
        canonTargetId: relationship.record.target,
        ...(relationship.identity === undefined ? {} : { canonRelationshipId: relationship.identity }),
        kind: relationship.record.kind,
        ...(relationship.record.interfaceId === undefined ? {} : { interfaceId: relationship.record.interfaceId }),
        sections: edgeSections(edge ?? {}),
      }),
    });
  });

  return { nodes: Object.freeze(nodes), edges: Object.freeze(edges) };
}

async function projectView(
  document: ArchitectureDocumentV1,
  view: ViewSpec,
  viewIndex: number,
  relationships: readonly RelationshipEntry[],
  layout: LayoutOptions,
): Promise<ReactFlowViewProjection> {
  const graph = projectViewGraph(document, view, viewIndex, relationships, layout);
  const layoutSummary = Object.freeze({
    algorithm: "layered" as const,
    direction: graph.direction,
    nodeWidth: layout.nodeWidth,
    nodeHeight: layout.nodeHeight,
  });
  const result =
    view.kind === "structural"
      ? await layoutGraph(document, view, graph.selected, graph.entries, graph.direction, layout)
      : { nodes: Object.freeze([] as ReactFlowNode[]), edges: Object.freeze([] as ReactFlowEdge[]) };
  return Object.freeze({
    key: view.key,
    kind: view.kind,
    ...(view.title === undefined ? {} : { title: view.title }),
    ...(view.description === undefined ? {} : { description: view.description }),
    layout: layoutSummary,
    nodes: result.nodes,
    edges: result.edges,
    losses: graph.losses.finish(),
  });
}

function assertValidDocument(document: ArchitectureDocumentV1): void {
  const validation = validateArchitectureDocument(document);
  if (!validation.valid) {
    const diagnostics = validation.diagnostics.map(({ code, path }) => `${code} at ${path}`).join(", ");
    throw new Error(`cannot project invalid Architecture Canon: ${diagnostics}`);
  }
}

/** Project validated Architecture Canon views into deterministic React Flow + ELK data. */
export async function projectArchitectureDocumentToReactFlow(
  document: ArchitectureDocumentV1,
  options: ReactFlowProjectionOptions = {},
): Promise<ReactFlowProjection> {
  assertValidDocument(document);
  const layout = readLayoutOptions(options);
  const requestedView = options.viewKey;
  const selectedViews =
    requestedView === undefined ? document.views : document.views.filter((view) => view.key === requestedView);
  if (requestedView !== undefined && selectedViews.length === 0) {
    throw new Error(`unknown Architecture view: ${requestedView}`);
  }

  const relationships = relationshipEntries(document);
  const views: ReactFlowViewProjection[] = [];
  for (let viewIndex = 0; viewIndex < document.views.length; viewIndex += 1) {
    const view = document.views[viewIndex];
    if (selectedViews.includes(view)) {
      views.push(await projectView(document, view, viewIndex, relationships, layout));
    }
  }

  const frozenViews = Object.freeze(views);
  const nodes = Object.freeze(frozenViews.flatMap((view) => view.nodes));
  const edges = Object.freeze(frozenViews.flatMap((view) => view.edges));
  const losses = Object.freeze(
    frozenViews
      .flatMap((view) => view.losses)
      .sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.code, right.code)),
  );
  return Object.freeze({
    canonVersion: document.canonVersion,
    documentId: document.documentId,
    nodes,
    edges,
    views: frozenViews,
    losses,
  });
}

/** Project one declared Architecture Canon view for renderers that select views individually. */
export async function projectArchitectureViewToReactFlow(
  document: ArchitectureDocumentV1,
  viewKey: string,
  options: Omit<ReactFlowProjectionOptions, "viewKey"> = {},
): Promise<ReactFlowViewProjection> {
  const projection = await projectArchitectureDocumentToReactFlow(document, { ...options, viewKey });
  return projection.views[0] as ReactFlowViewProjection;
}

export const projectArchitectureToReactFlow = projectArchitectureDocumentToReactFlow;
