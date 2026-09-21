import type { DesignIntentCanonView } from "../contracts.js";
import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import {
  projectArchitectureDocumentToReactFlow,
  type ReactFlowEdge,
  type ReactFlowNode,
  type ReactFlowProjection,
  type ReactFlowProjectionOptions,
  type ReactFlowViewProjection,
} from "../../architecture/projection/react-flow.js";

/** The state of one graph item when two Canon projections are compared. */
export type GraphDeltaState = "unchanged" | "added" | "removed" | "modified";

/** Optional renderer data attached by the semantic graph-delta projection. */
export interface GraphDeltaAnnotation {
  readonly deltaState: GraphDeltaState;
}

export type GraphDeltaNodeData = ReactFlowNode["data"] & Partial<GraphDeltaAnnotation>;
export type GraphDeltaEdgeData = ReactFlowEdge["data"] & Partial<GraphDeltaAnnotation>;

export type GraphDeltaNode = Omit<ReactFlowNode, "data"> & { readonly data: GraphDeltaNodeData };
export type GraphDeltaEdge = Omit<ReactFlowEdge, "data"> & { readonly data: GraphDeltaEdgeData };

export type GraphDeltaViewProjection = Omit<ReactFlowViewProjection, "nodes" | "edges"> & {
  readonly nodes: readonly GraphDeltaNode[];
  readonly edges: readonly GraphDeltaEdge[];
};

export type GraphDeltaProjection = Omit<ReactFlowProjection, "nodes" | "edges" | "views"> & {
  readonly nodes: readonly GraphDeltaNode[];
  readonly edges: readonly GraphDeltaEdge[];
  readonly views: readonly GraphDeltaViewProjection[];
};

/** Independently valid current and proposed projections with semantic annotations. */
export interface DesignIntentGraphDelta {
  readonly current: GraphDeltaProjection;
  readonly proposed?: GraphDeltaProjection;
}

interface ProjectionItemIndex {
  readonly nodes: ReadonlyMap<string, ReactFlowNode>;
  readonly edges: ReadonlyMap<string, ReactFlowEdge>;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    compareStrings(left, right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
}

function nodeKey(node: ReactFlowNode): string {
  return `${node.data.viewKey}\u0000${node.data.canonId}`;
}

function edgeKey(edge: ReactFlowEdge): string {
  return [
    edge.data.viewKey,
    edge.data.canonSourceId,
    edge.data.canonTargetId,
    edge.data.kind,
    edge.data.interfaceId ?? "",
  ].join("\u0000");
}

function indexProjection(projection: ReactFlowProjection): ProjectionItemIndex {
  const nodes = new Map<string, ReactFlowNode>();
  const edges = new Map<string, ReactFlowEdge>();
  for (const view of projection.views) {
    for (const node of view.nodes) nodes.set(nodeKey(node), node);
    for (const edge of view.edges) edges.set(edgeKey(edge), edge);
  }
  return { nodes, edges };
}

function elementById(
  document: ArchitectureDocumentV1,
): ReadonlyMap<string, ArchitectureDocumentV1["elements"][number]> {
  return new Map(document.elements.map((element) => [element.id, element]));
}

function interfaceById(
  document: ArchitectureDocumentV1,
): ReadonlyMap<string, ArchitectureDocumentV1["interfaces"][number]> {
  return new Map(document.interfaces.map((item) => [item.id, item]));
}

function ownerBindings(document: ArchitectureDocumentV1, canonId: string): readonly unknown[] {
  return [
    ...document.authority.authority.filter(({ concern }) => concern === canonId),
    ...document.authority.ownership.filter(({ resource }) => resource === canonId),
  ];
}

function nodeState(
  node: ReactFlowNode,
  side: "current" | "proposed",
  counterpart: ReadonlyMap<string, ReactFlowNode>,
  currentElements: ReadonlyMap<string, ArchitectureDocumentV1["elements"][number]>,
  proposedElements: ReadonlyMap<string, ArchitectureDocumentV1["elements"][number]>,
  currentDocument: ArchitectureDocumentV1,
  proposedDocument: ArchitectureDocumentV1,
): GraphDeltaState {
  const other = counterpart.get(nodeKey(node));
  if (other === undefined) return side === "current" ? "removed" : "added";

  const ownElements = side === "current" ? currentElements : proposedElements;
  const otherElements = side === "current" ? proposedElements : currentElements;
  const own = ownElements.get(node.data.canonId);
  const counterpartElement = otherElements.get(other.data.canonId);
  if (own === undefined || counterpartElement === undefined) {
    return "modified";
  }
  const elementChanged = stableSerialize(own) !== stableSerialize(counterpartElement);
  const ownerChanged =
    stableSerialize(ownerBindings(currentDocument, node.data.canonId)) !==
    stableSerialize(ownerBindings(proposedDocument, node.data.canonId));
  return elementChanged || ownerChanged ? "modified" : "unchanged";
}

function edgeState(
  edge: ReactFlowEdge,
  side: "current" | "proposed",
  counterpart: ReadonlyMap<string, ReactFlowEdge>,
  currentInterfaces: ReadonlyMap<string, ArchitectureDocumentV1["interfaces"][number]>,
  proposedInterfaces: ReadonlyMap<string, ArchitectureDocumentV1["interfaces"][number]>,
): GraphDeltaState {
  const other = counterpart.get(edgeKey(edge));
  if (other === undefined) return side === "current" ? "removed" : "added";
  const ownInterfaces = side === "current" ? currentInterfaces : proposedInterfaces;
  const otherInterfaces = side === "current" ? proposedInterfaces : currentInterfaces;
  const ownInterface = edge.data.interfaceId === undefined ? undefined : ownInterfaces.get(edge.data.interfaceId);
  const otherInterface = other.data.interfaceId === undefined ? undefined : otherInterfaces.get(other.data.interfaceId);
  return stableSerialize(ownInterface) === stableSerialize(otherInterface) ? "unchanged" : "modified";
}

function annotateNode(node: ReactFlowNode, state: GraphDeltaState): GraphDeltaNode {
  return Object.freeze({
    ...node,
    data: Object.freeze({ ...node.data, deltaState: state }),
  });
}

function annotateEdge(edge: ReactFlowEdge, state: GraphDeltaState): GraphDeltaEdge {
  return Object.freeze({
    ...edge,
    data: Object.freeze({ ...edge.data, deltaState: state }),
  });
}

function annotateProjection(
  projection: ReactFlowProjection,
  side: "current" | "proposed",
  counterpart: ReactFlowProjection,
  currentDocument: ArchitectureDocumentV1,
  proposedDocument: ArchitectureDocumentV1,
): GraphDeltaProjection {
  const counterpartIndex = indexProjection(counterpart);
  const currentElements = elementById(currentDocument);
  const proposedElements = elementById(proposedDocument);
  const currentInterfaces = interfaceById(currentDocument);
  const proposedInterfaces = interfaceById(proposedDocument);

  const views = projection.views.map((view) => {
    const nodes = view.nodes.map((node) =>
      annotateNode(
        node,
        nodeState(
          node,
          side,
          counterpartIndex.nodes,
          currentElements,
          proposedElements,
          currentDocument,
          proposedDocument,
        ),
      ),
    );
    const edges = view.edges.map((edge) =>
      annotateEdge(edge, edgeState(edge, side, counterpartIndex.edges, currentInterfaces, proposedInterfaces)),
    );
    return Object.freeze({ ...view, nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
  });

  return Object.freeze({
    ...projection,
    nodes: Object.freeze(
      projection.nodes.map((node) =>
        annotateNode(
          node,
          nodeState(
            node,
            side,
            counterpartIndex.nodes,
            currentElements,
            proposedElements,
            currentDocument,
            proposedDocument,
          ),
        ),
      ),
    ),
    edges: Object.freeze(
      projection.edges.map((edge) =>
        annotateEdge(edge, edgeState(edge, side, counterpartIndex.edges, currentInterfaces, proposedInterfaces)),
      ),
    ),
    views: Object.freeze(views),
  });
}

/**
 * Project the current and proposed Architecture Canons independently and add
 * semantic state to their graph items. The Canon documents remain the only
 * authority; the returned React Flow data is a read-only projection.
 */
export async function projectDesignIntentGraphDelta(
  view: DesignIntentCanonView,
  options: ReactFlowProjectionOptions = {},
): Promise<DesignIntentGraphDelta> {
  const current = await projectArchitectureDocumentToReactFlow(view.current, options);
  if (view.proposed === undefined) {
    return Object.freeze({ current: current as GraphDeltaProjection });
  }

  const proposed = await projectArchitectureDocumentToReactFlow(view.proposed, options);
  return Object.freeze({
    current: annotateProjection(current, "current", proposed, view.current, view.proposed),
    proposed: annotateProjection(proposed, "proposed", current, view.current, view.proposed),
  });
}

/** Descriptive alias for callers that use the architecture terminology. */
export const projectArchitectureGraphDelta = projectDesignIntentGraphDelta;

/** Descriptive alias for callers that use the Canon-view terminology. */
export const projectDesignIntentCanonView = projectDesignIntentGraphDelta;
