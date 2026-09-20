import type {
  ReactFlowEdge,
  ReactFlowEdgeSection,
  ReactFlowNode,
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

export const REACT_FLOW_DIAGRAM_CSS = `.wabachi-react-flow-diagrams {
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
  block-size: auto;
  min-block-size: 12rem;
  overflow: visible;
  background: var(--wabachi-flow-canvas);
  border: 1px solid var(--wabachi-flow-border);
  border-radius: 0.5rem;
}

.wabachi-react-flow-edge {
  fill: none;
  stroke: var(--wabachi-flow-edge);
  stroke-width: 2;
}

.wabachi-react-flow-edge-label {
  fill: var(--wabachi-flow-ink);
  font-size: 12px;
  paint-order: stroke;
  stroke: var(--wabachi-flow-canvas);
  stroke-width: 5px;
  stroke-linejoin: round;
}

.wabachi-react-flow-node {
  color: var(--wabachi-flow-ink);
}

.wabachi-react-flow-node > rect {
  fill: var(--wabachi-flow-surface);
  stroke: var(--wabachi-flow-border);
  stroke-width: 2;
}

.wabachi-react-flow-node--parent > rect {
  stroke-dasharray: 6 3;
}

.wabachi-react-flow-node[data-kind="service"] > rect,
.wabachi-react-flow-node[data-kind="system"] > rect {
  fill: #eef6ff;
}

.wabachi-react-flow-node[data-kind="component"] > rect {
  fill: #f4f0ff;
}

.wabachi-react-flow-node[data-kind="actor"] > rect {
  fill: #fff7e6;
}

.wabachi-react-flow-node > text {
  dominant-baseline: middle;
  fill: currentColor;
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
  text-anchor: middle;
}

.wabachi-react-flow-node > title,
.wabachi-react-flow-edge > title {
  pointer-events: none;
}
`;

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

function attr(name: string, value: string): string {
  return ` ${name}="${escapeHtml(value)}"`;
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

function edgePath(
  edge: ReactFlowEdge,
  viewKey: string,
): { readonly path: string; readonly labelPoint: { x: number; y: number } } {
  if (edge.data.sections.length === 0) {
    throw new ReactFlowStaticRenderError(`view ${viewKey} edge ${edge.id} has no routed sections`);
  }

  const paths: string[] = [];
  let labelPoint: { x: number; y: number } | undefined;
  edge.data.sections.forEach((section, sectionIndex) => {
    const points = sectionPoints(section, `views[${viewKey}].edges[${edge.id}].sections[${sectionIndex}]`);
    if (points.length < 2) {
      throw new ReactFlowStaticRenderError(`view ${viewKey} edge ${edge.id} has an incomplete routed section`);
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
      if (nodeIds.has(node.id))
        throw new ReactFlowStaticRenderError(`view ${view.key} contains duplicate node id: ${node.id}`);
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
      edgePath(edge, view.key);
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

function renderEdge(edge: ReactFlowEdge, view: ReactFlowViewProjection, markerId: string): string {
  const routed = edgePath(edge, view.key);
  const relationshipId =
    edge.data.canonRelationshipId === undefined
      ? ""
      : attr("data-canon-relationship-id", edge.data.canonRelationshipId);
  return `<g id="${escapeHtml(`edge-${identityToken(edge.id)}`)}" class="wabachi-react-flow-edge-group" data-edge-id="${escapeHtml(edge.id)}" data-view-key="${escapeHtml(view.key)}" data-canon-source-id="${escapeHtml(edge.data.canonSourceId)}" data-canon-target-id="${escapeHtml(edge.data.canonTargetId)}"${relationshipId} data-section-count="${String(edge.data.sections.length)}">
<title>${escapeHtml(`${edge.data.canonSourceId} → ${edge.data.canonTargetId}: ${edge.label}`)}</title>
<path class="wabachi-react-flow-edge" d="${escapeHtml(routed.path)}" marker-end="url(#${escapeHtml(markerId)})"/>
<text class="wabachi-react-flow-edge-label" x="${formatNumber(routed.labelPoint.x)}" y="${formatNumber(routed.labelPoint.y)}" text-anchor="middle">${escapeHtml(edge.label)}</text>
</g>`;
}

function renderNode(
  node: ReactFlowNode,
  view: ReactFlowViewProjection,
  childrenByParent: ReadonlyMap<string, readonly ReactFlowNode[]>,
  depth: number,
): string {
  const children = childrenByParent.get(node.id) ?? [];
  const size = nodeSize(node, `node ${node.id}`);
  const position = nodePosition(node, `node ${node.id}`);
  const parentId = node.parentId === undefined ? "" : attr("data-parent-id", node.parentId);
  const className =
    children.length === 0 ? "wabachi-react-flow-node" : "wabachi-react-flow-node wabachi-react-flow-node--parent";
  const nested = children.map((child) => renderNode(child, view, childrenByParent, depth + 1)).join("\n");

  return `<g id="${escapeHtml(`node-${identityToken(node.id)}`)}" class="${className}" data-node-id="${escapeHtml(node.id)}" data-canon-id="${escapeHtml(node.data.canonId)}" data-view-key="${escapeHtml(view.key)}" data-kind="${escapeHtml(node.data.kind)}"${parentId} aria-level="${String(depth)}" transform="translate(${formatNumber(position.x)} ${formatNumber(position.y)})" role="group">
<title>${escapeHtml(`${node.data.label} (${node.data.canonId})`)}</title>
<rect width="${formatNumber(size.width)}" height="${formatNumber(size.height)}" rx="8"/>
<text x="${formatNumber(size.width / 2)}" y="${formatNumber(size.height / 2)}">${escapeHtml(node.data.label)}</text>
${nested}
</g>`;
}

function viewBounds(
  view: ReactFlowViewProjection,
  absolutePositions: ReadonlyMap<string, { x: number; y: number }>,
): string {
  const bounds: Bounds = { minX: 0, minY: 0, maxX: 320, maxY: 160 };
  for (const node of view.nodes) {
    const position = absolutePositions.get(node.id) as { x: number; y: number };
    addNodeBounds(bounds, node, position, `node ${node.id}`);
  }
  for (const edge of view.edges) {
    for (const [sectionIndex, section] of edge.data.sections.entries()) {
      for (const point of sectionPoints(section, `edge ${edge.id}.sections[${sectionIndex}]`)) {
        includePoint(bounds, point.x, point.y);
      }
    }
  }
  const padding = 32;
  return [
    bounds.minX - padding,
    bounds.minY - padding,
    Math.max(320, bounds.maxX - bounds.minX + padding * 2),
    Math.max(160, bounds.maxY - bounds.minY + padding * 2),
  ]
    .map(formatNumber)
    .join(" ");
}

function renderView(projection: ReactFlowProjection, view: ReactFlowViewProjection): string {
  const nodes = [...view.nodes].sort((left, right) => compareStrings(left.id, right.id));
  const edges = [...view.edges].sort((left, right) => compareStrings(left.id, right.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const absolutePositions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) absoluteNodePosition(node, nodesById, absolutePositions, new Set<string>());

  const childrenByParent = new Map<string, ReactFlowNode[]>();
  for (const node of nodes) {
    if (node.parentId === undefined) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort((left, right) => compareStrings(left.id, right.id));

  const roots = nodes.filter((node) => node.parentId === undefined);
  const viewToken = identityToken(view.key);
  const titleId = `react-flow-title-${viewToken}`;
  const markerId = `react-flow-arrow-${viewToken}`;
  const title = view.title ?? view.key;
  const description = view.description === undefined ? "" : `<p>${escapeHtml(view.description)}</p>`;
  const losses =
    view.losses.length === 0
      ? ""
      : `<p class="wabachi-react-flow-losses" data-loss-count="${String(view.losses.length)}">Projection losses: ${String(view.losses.length)}</p>`;
  const edgeMarkup = edges.map((edge) => renderEdge(edge, view, markerId)).join("\n");
  const nodeMarkup = roots.map((node) => renderNode(node, view, childrenByParent, 1)).join("\n");

  return `<section id="react-flow-view-${viewToken}" class="wabachi-react-flow-diagram" data-view-key="${escapeHtml(view.key)}" data-canon-document-id="${escapeHtml(projection.documentId)}" data-canon-version="${escapeHtml(String(projection.canonVersion))}" data-projection-loss-count="${String(view.losses.length)}">
<header>
<h2 id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>
${description}${losses}
</header>
<svg class="wabachi-react-flow-canvas" role="img" aria-labelledby="${escapeHtml(titleId)}" viewBox="${viewBounds(view, absolutePositions)}" xmlns="http://www.w3.org/2000/svg">
<defs>
<marker id="${escapeHtml(markerId)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth">
<path d="M 0 0 L 10 5 L 0 10 z"/>
</marker>
</defs>
<g class="wabachi-react-flow-edges" data-view-key="${escapeHtml(view.key)}">${edgeMarkup}</g>
<g class="wabachi-react-flow-nodes" data-view-key="${escapeHtml(view.key)}">${nodeMarkup}</g>
</svg>
</section>`;
}

/** Render the React Flow projection as deterministic HTML and local assets. */
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
