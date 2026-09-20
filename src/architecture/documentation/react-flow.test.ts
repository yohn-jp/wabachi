import assert from "node:assert/strict";
import test from "node:test";

import type {
  ReactFlowEdge,
  ReactFlowNode,
  ReactFlowProjection,
  ReactFlowViewProjection,
} from "../projection/react-flow.js";
import { REACT_FLOW_DIAGRAM_CSS, ReactFlowStaticRenderError, renderReactFlowStatic } from "./react-flow.js";

function node(
  id: string,
  canonId: string,
  position: { readonly x: number; readonly y: number },
  parentId?: string,
): ReactFlowNode {
  return {
    id,
    type: "architecture",
    data: { canonId, viewKey: "structure", kind: parentId === undefined ? "service" : "component", label: canonId },
    position,
    width: 180,
    height: 80,
    ...(parentId === undefined ? {} : { parentId, extent: "parent" as const }),
  };
}

function view(nodes: readonly ReactFlowNode[], edges: readonly ReactFlowEdge[]): ReactFlowViewProjection {
  return {
    key: "structure",
    kind: "structural",
    title: "Commerce structure",
    description: "A projected architecture view",
    layout: { algorithm: "layered", direction: "RIGHT", nodeWidth: 180, nodeHeight: 80 },
    nodes,
    edges,
    losses: [],
  };
}

function projection(reverse = false): ReactFlowProjection {
  const orders = node("react_flow_structure_element_orders", "orders", { x: 40, y: 40 });
  const component = node(
    "react_flow_structure_element_orders_x2d_component",
    "orders-component",
    { x: 16, y: 24 },
    orders.id,
  );
  const payments = node("react_flow_structure_element_payments", "payments", { x: 320, y: 40 });
  const edge: ReactFlowEdge = {
    id: "react_flow_structure_relationship_orders_u0_calls_u0_payments_u0_",
    type: "default",
    source: orders.id,
    target: payments.id,
    label: "calls",
    data: {
      viewKey: "structure",
      canonSourceId: "orders",
      canonTargetId: "payments",
      canonRelationshipId: "relationship-orders-payments",
      kind: "calls",
      sections: [
        {
          startPoint: { x: 220, y: 80 },
          bendPoints: [
            { x: 270, y: 80 },
            { x: 270, y: 120 },
          ],
          endPoint: { x: 320, y: 120 },
        },
      ],
    },
  };
  const nodes = reverse ? [payments, component, orders] : [orders, component, payments];
  return {
    canonVersion: 1,
    documentId: "commerce" as unknown as ReactFlowProjection["documentId"],
    nodes,
    edges: [edge],
    views: [view(nodes, [edge])],
    losses: [],
  };
}

test("renders hierarchy, labels, routed direction, and Canon/view identities", () => {
  const result = renderReactFlowStatic(projection());

  assert.match(result.markup, /data-canon-document-id="commerce"/);
  assert.match(result.markup, /data-view-key="structure"/);
  assert.match(result.markup, /data-canon-id="orders-component"/);
  assert.match(result.markup, /data-parent-id="react_flow_structure_element_orders"/);
  assert.match(result.markup, /data-canon-source-id="orders"/);
  assert.match(result.markup, /data-canon-target-id="payments"/);
  assert.match(result.markup, /data-canon-relationship-id="relationship-orders-payments"/);
  assert.match(result.markup, /data-section-count="1"/);
  assert.match(result.markup, /data-testid="rf__wrapper"/);
  assert.match(result.markup, /class="react-flow__edges"/);
  assert.match(result.markup, /class="react-flow__nodes"/);
  assert.match(result.markup, /class="react-flow__edge react-flow__edge-routed/);
  assert.match(result.markup, /marker-end="url\(&#x27;#react-flow-structure__type=arrowclosed&#x27;\)"/);
  assert.match(result.markup, /M 220 80 L 270 80 L 270 120 L 320 120/);
  assert.match(result.markup, /class="react-flow__edge-text"[^>]*>calls<\/text>/);
  assert.match(result.markup, /class="wabachi-react-flow-node wabachi-react-flow-node--parent"[^>]*>orders<\/div>/);
  assert.doesNotMatch(result.markup, /<svg class="wabachi-react-flow-canvas"/u);
});

test("renders equivalent projection data deterministically and keeps assets offline", () => {
  const first = renderReactFlowStatic(projection());
  const second = renderReactFlowStatic(projection(true));

  assert.deepEqual(first, second);
  assert.equal(first.assets.length, 1);
  assert.equal(first.assets[0]?.path, "wabachi-react-flow.css");
  assert.equal(first.assets[0]?.content, REACT_FLOW_DIAGRAM_CSS);
  assert.doesNotMatch(first.assets[0]?.content ?? "", /https?:\/\//u);
  assert.doesNotMatch(first.assets[0]?.content ?? "", /url\(/u);
});

test("fails explicitly when an edge has no routed sections", () => {
  const invalid = projection();
  const edge = invalid.edges[0] as ReactFlowEdge;
  const invalidEdge = { ...edge, data: { ...edge.data, sections: [] } };
  const invalidProjection = { ...invalid, edges: [invalidEdge], views: [view(invalid.nodes, [invalidEdge])] };

  assert.throws(
    () => renderReactFlowStatic(invalidProjection),
    (error: unknown) => {
      assert.ok(error instanceof ReactFlowStaticRenderError);
      assert.match(error.message, /has no routed sections/);
      return true;
    },
  );
});
