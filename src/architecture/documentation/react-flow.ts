import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type {
  ReactFlowEdge,
  ReactFlowEdgeSection,
  ReactFlowNode,
  ReactFlowNodeData,
  ReactFlowProjection,
  ReactFlowViewProjection,
} from "../projection/react-flow.js";

export interface ReactFlowStaticAsset {
  readonly path: "wabachi-react-flow.css";
  readonly contentType: "text/css";
  readonly content: string;
}

export interface ReactFlowStaticRenderResult {
  /** An HTML fragment that can be inserted into a Wabachi-owned document. */
  readonly markup: string;
  /** Local assets required by the fragment; no network request is needed. */
  readonly assets: readonly ReactFlowStaticAsset[];
}

export class ReactFlowStaticRenderError extends Error {
  readonly code = "invalid-projection" as const;

  constructor(message: string) {
    super(message);
    this.name = "ReactFlowStaticRenderError";
  }
}

const require = createRequire(import.meta.url);

function reactFlowStylesheet(): string {
  try {
    return readFileSync(require.resolve("@xyflow/react/dist/style.css"), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new ReactFlowStaticRenderError(`React Flow stylesheet is unavailable${detail}`);
  }
}

const WABACHI_REACT_FLOW_CSS = `.wabachi-react-flow-diagrams {
  --wabachi-flow-ink: #202124;
  --wabachi-flow-muted: #5f6368;
  --wabachi-flow-border: #aeb7c4;
  --wabachi-flow-edge: #53657a;
  --wabachi-flow-surface: #ffffff;
  --wabachi-flow-canvas: #f8fafc;
  display: grid;
  gap: 2rem;
  color: var(--wabachi-flow-ink);
  font-family: system-ui, sans-serif;
}

.wabachi-react-flow-diagram {
  min-inline-size: 0;
}

.wabachi-react-flow-diagram > header {
  margin-block-end: 1rem;
}

.wabachi-react-flow-diagram > header h2,
.wabachi-react-flow-diagram > header p {
  margin-block: 0.25rem;
}

.wabachi-react-flow-diagram > header p,
.wabachi-react-flow-losses {
  color: var(--wabachi-flow-muted);
}

.wabachi-react-flow-canvas {
  display: block;
  inline-size: 100%;
  min-block-size: 12rem;
  overflow: hidden;
  background: var(--wabachi-flow-canvas);
  border: 1px solid var(--wabachi-flow-border);
  border-radius: 0.5rem;
}

.wabachi-react-flow-surface {
  color: var(--wabachi-flow-ink);
  background: var(--wabachi-flow-canvas);
}

.wabachi-react-flow-node {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  inline-size: 100%;
  block-size: 100%;
  padding: 0.75rem;
  color: var(--wabachi-flow-ink);
  background: var(--wabachi-flow-surface);
  border: 2px solid var(--wabachi-flow-border);
  border-radius: 0.5rem;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.wabachi-react-flow-node--parent {
  border-style: dashed;
}

.wabachi-react-flow-node[data-kind="service"],
.wabachi-react-flow-node[data-kind="system"] {
  background: #eef6ff;
}

.wabachi-react-flow-node[data-kind="component"] {
  background: #f4f0ff;
}

.wabachi-react-flow-node[data-kind="actor"] {
  background: #fff7e6;
}

.wabachi-react-flow-node[data-delta-state="added"] {
  border-color: #188038;
}

.wabachi-react-flow-node[data-delta-state="removed"] {
  border-color: #c5221f;
  border-style: dashed;
}

.wabachi-react-flow-node[data-delta-state="modified"] {
  border-color: #b06000;
}

.wabachi-react-flow-node > .react-flow__handle {
  opacity: 0;
}

.wabachi-react-flow-edge .react-flow__edge-path {
  stroke: var(--wabachi-flow-edge);
  stroke-width: 2;
}

.wabachi-react-flow-edge .react-flow__edge-text {
  fill: var(--wabachi-flow-ink);
  font-size: 12px;
}

.wabachi-react-flow-edge .react-flow__edge-textbg {
  fill: var(--wabachi-flow-canvas);
  opacity: 0.95;
}

.wabachi-react-flow-edge--delta-added .react-flow__edge-path {
  stroke: #188038;
}

.wabachi-react-flow-edge--delta-removed .react-flow__edge-path {
  stroke: #c5221f;
  stroke-dasharray: 6 4;
}

.wabachi-react-flow-edge--delta-modified .react-flow__edge-path {
  stroke: #b06000;
}
`;

export const REACT_FLOW_DIAGRAM_CSS = `${reactFlowStylesheet()}\n${WABACHI_REACT_FLOW_CSS}`;

export const REACT_FLOW_STATIC_ASSETS: readonly ReactFlowStaticAsset[] = Object.freeze([
  Object.freeze({
    path: "wabachi-react-flow.css" as const,
    contentType: "text/css" as const,
    content: REACT_FLOW_DIAGRAM_CSS,
  }),
]);

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}

function identityToken(value: string): string {
  const token = Array.from(value, (character) => {
    if (/^[A-Za-z0-9]$/u.test(character)) return character;
    return `_u${character.codePointAt(0)?.toString(16) ?? "0"}_`;
  }).join("");
  return token.length === 0 ? "empty" : token;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReactFlowStaticRenderError(`${path} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function formatNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function nodePosition(node: ReactFlowNode, path: string): { readonly x: number; readonly y: number } {
  return Object.freeze({
    x: finiteNumber(node.position.x, `${path}.position.x`),
    y: finiteNumber(node.position.y, `${path}.position.y`),
  });
}

function nodeSize(node: ReactFlowNode, path: string): { readonly width: number; readonly height: number } {
  const width = finiteNumber(node.width, `${path}.width`);
  const height = finiteNumber(node.height, `${path}.height`);
  if (width <= 0 || height <= 0) {
    throw new ReactFlowStaticRenderError(`${path} dimensions must be positive`);
  }
  return Object.freeze({ width, height });
}

function sectionPoints(section: ReactFlowEdgeSection, path: string): readonly { x: number; y: number }[] {
  const points = [section.startPoint, ...section.bendPoints, section.endPoint];
  return Object.freeze(
    points.map((point, index) => ({
      x: finiteNumber(point.x, `${path}[${index}].x`),
      y: finiteNumber(point.y, `${path}[${index}].y`),
    })),
  );
}

function edgePath(edge: Pick<ReactFlowEdge, "id" | "data">): {
  readonly path: string;
  readonly labelPoint: { x: number; y: number };
} {
  if (edge.data.sections.length === 0) {
    throw new ReactFlowStaticRenderError(`view ${edge.data.viewKey} edge ${edge.id} has no routed sections`);
  }

  const paths: string[] = [];
  let labelPoint: { x: number; y: number } | undefined;
  edge.data.sections.forEach((section, sectionIndex) => {
    const points = sectionPoints(section, `views[${edge.data.viewKey}].edges[${edge.id}].sections[${sectionIndex}]`);
    if (points.length < 2) {
      throw new ReactFlowStaticRenderError(
        `view ${edge.data.viewKey} edge ${edge.id} has an incomplete routed section`,
      );
    }
    const [first, ...rest] = points;
    paths.push(
      `M ${formatNumber(first.x)} ${formatNumber(first.y)} ${rest.map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`).join(" ")}`,
    );
    if (labelPoint === undefined) {
      const midpoint = Math.floor((points.length - 1) / 2);
      const start = points[midpoint];
      const end = points[midpoint + 1];
      labelPoint = Object.freeze({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
    }
  });

  return Object.freeze({ path: paths.join(" "), labelPoint: labelPoint as { x: number; y: number } });
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function includePoint(bounds: Bounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function addNodeBounds(bounds: Bounds, node: ReactFlowNode, absolute: { x: number; y: number }, path: string): void {
  const size = nodeSize(node, path);
  includePoint(bounds, absolute.x, absolute.y);
  includePoint(bounds, absolute.x + size.width, absolute.y + size.height);
}

function validateProjection(projection: ReactFlowProjection): void {
  if (projection === null || typeof projection !== "object" || !Array.isArray(projection.views)) {
    throw new ReactFlowStaticRenderError("React Flow renderer requires a projection with views");
  }

  const viewKeys = new Set<string>();
  for (const [viewIndex, view] of projection.views.entries()) {
    if (typeof view.key !== "string" || view.key.length === 0) {
      throw new ReactFlowStaticRenderError(`views[${viewIndex}].key must be a non-empty string`);
    }
    if (viewKeys.has(view.key)) {
      throw new ReactFlowStaticRenderError(`projection contains duplicate view key: ${view.key}`);
    }
    viewKeys.add(view.key);

    const nodeIds = new Set<string>();
    for (const [nodeIndex, node] of view.nodes.entries()) {
      const path = `views[${viewIndex}].nodes[${nodeIndex}]`;
      if (typeof node.id !== "string" || node.id.length === 0) {
        throw new ReactFlowStaticRenderError(`${path}.id must be a non-empty string`);
      }
      if (nodeIds.has(node.id)) {
        throw new ReactFlowStaticRenderError(`view ${view.key} contains duplicate node id: ${node.id}`);
      }
      nodeIds.add(node.id);
      if (node.data.viewKey !== view.key) {
        throw new ReactFlowStaticRenderError(`${path}.data.viewKey does not match view key ${view.key}`);
      }
      nodePosition(node, path);
      nodeSize(node, path);
    }

    for (const node of view.nodes) {
      if (node.parentId !== undefined && !nodeIds.has(node.parentId)) {
        throw new ReactFlowStaticRenderError(
          `view ${view.key} node ${node.id} refers to missing parent ${node.parentId}`,
        );
      }
    }

    for (const [edgeIndex, edge] of view.edges.entries()) {
      const path = `views[${viewIndex}].edges[${edgeIndex}]`;
      if (typeof edge.id !== "string" || edge.id.length === 0) {
        throw new ReactFlowStaticRenderError(`${path}.id must be a non-empty string`);
      }
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        throw new ReactFlowStaticRenderError(`view ${view.key} edge ${edge.id} refers to a missing endpoint`);
      }
      if (edge.data.viewKey !== view.key) {
        throw new ReactFlowStaticRenderError(`${path}.data.viewKey does not match view key ${view.key}`);
      }
      edgePath(edge);
    }
  }
}

function absoluteNodePosition(
  node: ReactFlowNode,
  nodesById: ReadonlyMap<string, ReactFlowNode>,
  cache: Map<string, { x: number; y: number }>,
  visiting: Set<string>,
): { readonly x: number; readonly y: number } {
  const cached = cache.get(node.id);
  if (cached !== undefined) return cached;
  if (visiting.has(node.id)) throw new ReactFlowStaticRenderError(`view contains a parent cycle at node ${node.id}`);
  visiting.add(node.id);
  const position = nodePosition(node, `node ${node.id}`);
  const parent = node.parentId === undefined ? undefined : nodesById.get(node.parentId);
  const parentPosition =
    parent === undefined ? { x: 0, y: 0 } : absoluteNodePosition(parent, nodesById, cache, visiting);
  const result = Object.freeze({ x: position.x + parentPosition.x, y: position.y + parentPosition.y });
  visiting.delete(node.id);
  cache.set(node.id, result);
  return result;
}

interface ViewportBounds {
  readonly width: number;
  readonly height: number;
  readonly defaultViewport: { readonly x: number; readonly y: number; readonly zoom: 1 };
}

function viewBounds(
  view: ReactFlowViewProjection,
  absolutePositions: ReadonlyMap<string, { x: number; y: number }>,
): ViewportBounds {
  const bounds: Bounds = { minX: 0, minY: 0, maxX: 320, maxY: 160 };
  for (const node of view.nodes) {
    const position = absolutePositions.get(node.id) as { x: number; y: number };
    addNodeBounds(bounds, node, position, `node ${node.id}`);
  }
  for (const edge of view.edges) {
    edge.data.sections.forEach((section, sectionIndex) => {
      for (const point of sectionPoints(section, `edge ${edge.id}.sections[${sectionIndex}]`)) {
        includePoint(bounds, point.x, point.y);
      }
    });
  }
  const padding = 32;
  return Object.freeze({
    width: Math.max(320, bounds.maxX - bounds.minX + padding * 2),
    height: Math.max(160, bounds.maxY - bounds.minY + padding * 2),
    defaultViewport: Object.freeze({ x: padding - bounds.minX, y: padding - bounds.minY, zoom: 1 as const }),
  });
}

type ArchitectureFlowNodeData = ReactFlowNodeData & { readonly isParent: boolean } & Record<string, unknown>;

type ArchitectureFlowNode = Node<ArchitectureFlowNodeData, "architecture">;
type ArchitectureFlowEdgeData = ReactFlowEdge["data"] & Record<string, unknown>;
type ArchitectureFlowEdge = Edge<ArchitectureFlowEdgeData, "routed">;

type ReactFlowDeltaState = "unchanged" | "added" | "removed" | "modified";

function readDeltaState(value: unknown): ReactFlowDeltaState | undefined {
  return value === "unchanged" || value === "added" || value === "removed" || value === "modified" ? value : undefined;
}

function ArchitectureNode({ data, parentId }: NodeProps<ArchitectureFlowNode>): React.ReactElement {
  const deltaState = readDeltaState(data.deltaState);
  const className = [
    data.isParent ? "wabachi-react-flow-node wabachi-react-flow-node--parent" : "wabachi-react-flow-node",
    deltaState === undefined ? undefined : `wabachi-react-flow-node--delta-${deltaState}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Handle, { type: "target", position: Position.Left, "aria-hidden": true }),
    React.createElement(
      "div",
      {
        className,
        "data-canon-id": data.canonId,
        "data-view-key": data.viewKey,
        "data-kind": data.kind,
        ...(deltaState === undefined ? {} : { "data-delta-state": deltaState }),
        ...(parentId === undefined ? {} : { "data-parent-id": parentId }),
        role: "group",
      },
      data.label,
    ),
    React.createElement(Handle, { type: "source", position: Position.Right, "aria-hidden": true }),
  );
}

function RoutedEdge({ id, data, label, markerEnd }: EdgeProps<ArchitectureFlowEdge>): React.ReactElement {
  if (data === undefined) {
    throw new ReactFlowStaticRenderError(`React Flow edge ${id} has no projection data`);
  }
  const routed = edgePath({ id, data });
  const deltaState = readDeltaState(data.deltaState);
  return React.createElement(
    "g",
    {
      "data-view-key": data.viewKey,
      "data-canon-source-id": data.canonSourceId,
      "data-canon-target-id": data.canonTargetId,
      ...(data.canonRelationshipId === undefined ? {} : { "data-canon-relationship-id": data.canonRelationshipId }),
      ...(deltaState === undefined ? {} : { "data-delta-state": deltaState }),
      "data-section-count": String(data.sections.length),
    },
    React.createElement(BaseEdge, {
      id,
      path: routed.path,
      label,
      labelX: routed.labelPoint.x,
      labelY: routed.labelPoint.y,
      markerEnd,
      className: [
        "wabachi-react-flow-edge",
        deltaState === undefined ? undefined : `wabachi-react-flow-edge--delta-${deltaState}`,
      ]
        .filter((value): value is string => value !== undefined)
        .join(" "),
    }),
  );
}

const NODE_TYPES = Object.freeze({ architecture: ArchitectureNode });
const EDGE_TYPES = Object.freeze({ routed: RoutedEdge });

function flowNodes(view: ReactFlowViewProjection): readonly ArchitectureFlowNode[] {
  const nodes = [...view.nodes].sort((left, right) => compareStrings(left.id, right.id));
  const parentIds = new Set(nodes.flatMap((node) => (node.parentId === undefined ? [] : [node.parentId])));
  return Object.freeze(
    nodes
      .map((node) => ({
        id: node.id,
        type: "architecture" as const,
        data: { ...node.data, isParent: parentIds.has(node.id) },
        position: { ...node.position },
        width: node.width,
        height: node.height,
        handles: [
          { type: "target" as const, position: Position.Left, x: 0, y: node.height / 2 },
          { type: "source" as const, position: Position.Right, x: node.width, y: node.height / 2 },
        ],
        ...(node.parentId === undefined ? {} : { parentId: node.parentId, extent: "parent" as const }),
      }))
      .map((node) => ({
        ...node,
        data: node.data as ArchitectureFlowNodeData,
      })),
  );
}

function flowEdges(view: ReactFlowViewProjection): readonly ArchitectureFlowEdge[] {
  const edges = [...view.edges].sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(
    edges
      .map((edge) => ({
        id: edge.id,
        type: "routed" as const,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: edge.data as ArchitectureFlowEdgeData,
      }))
      .map((edge) => edge as ArchitectureFlowEdge),
  );
}

function renderView(projection: ReactFlowProjection, view: ReactFlowViewProjection): string {
  const nodes = [...flowNodes(view)];
  const edges = [...flowEdges(view)];
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
  const absolutePositions = new Map<string, { x: number; y: number }>();
  for (const node of view.nodes) absoluteNodePosition(node, nodesById, absolutePositions, new Set<string>());
  const bounds = viewBounds(view, absolutePositions);
  const viewToken = identityToken(view.key);
  const titleId = `react-flow-title-${viewToken}`;
  const title = view.title ?? view.key;
  const description = view.description === undefined ? "" : `<p>${escapeHtml(view.description)}</p>`;
  const losses =
    view.losses.length === 0
      ? ""
      : `<p class="wabachi-react-flow-losses" data-loss-count="${String(view.losses.length)}">Projection losses: ${String(view.losses.length)}</p>`;
  const flowMarkup = renderToStaticMarkup(
    React.createElement(ReactFlowProvider, {
      initialNodes: nodes,
      initialEdges: edges,
      children: React.createElement(ReactFlow, {
        id: `react-flow-${viewToken}`,
        nodes,
        edges,
        nodeTypes: NODE_TYPES,
        edgeTypes: EDGE_TYPES,
        defaultViewport: bounds.defaultViewport,
        nodesDraggable: false,
        nodesConnectable: false,
        elementsSelectable: false,
        panOnDrag: false,
        zoomOnScroll: false,
        zoomOnPinch: false,
        zoomOnDoubleClick: false,
        proOptions: { hideAttribution: true },
        className: "wabachi-react-flow-surface",
        style: { width: "100%", height: `${formatNumber(bounds.height)}px` },
        "aria-label": `${title} architecture diagram`,
      }),
    }),
  );

  return `<section id="react-flow-view-${escapeHtml(viewToken)}" class="wabachi-react-flow-diagram" data-view-key="${escapeHtml(view.key)}" data-canon-document-id="${escapeHtml(projection.documentId)}" data-canon-version="${escapeHtml(String(projection.canonVersion))}" data-projection-loss-count="${String(view.losses.length)}">
<header>
<h2 id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>
${description}${losses}
</header>
<div class="wabachi-react-flow-canvas" data-view-key="${escapeHtml(view.key)}" data-canon-document-id="${escapeHtml(projection.documentId)}" data-canon-version="${escapeHtml(String(projection.canonVersion))}" style="height: ${formatNumber(bounds.height)}px" role="img" aria-labelledby="${escapeHtml(titleId)}">
${flowMarkup}
</div>
</section>`;
}

/** Render the React Flow projection with @xyflow/react's ReactFlow component and local assets. */
export function renderReactFlowStatic(projection: ReactFlowProjection): ReactFlowStaticRenderResult {
  validateProjection(projection);
  const views = [...projection.views].sort((left, right) => compareStrings(left.key, right.key));
  const markup = `<div class="wabachi-react-flow-diagrams" data-canon-document-id="${escapeHtml(projection.documentId)}" data-canon-version="${escapeHtml(String(projection.canonVersion))}">
${views.map((view) => renderView(projection, view)).join("\n")}
</div>`;
  return Object.freeze({ markup, assets: REACT_FLOW_STATIC_ASSETS });
}

/** Convenience form for callers that only need the composable HTML fragment. */
export function renderReactFlowHtml(projection: ReactFlowProjection): string {
  return renderReactFlowStatic(projection).markup;
}

export const renderReactFlowProjection = renderReactFlowStatic;
