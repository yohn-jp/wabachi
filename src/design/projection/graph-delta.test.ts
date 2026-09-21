import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { projectDesignIntentGraphDelta } from "./graph-delta.js";

function document(proposed: boolean) {
  return createArchitectureDocument({
    documentId: "commerce",
    root: { id: "architecture" },
    elements: proposed
      ? [
          { id: "orders", kind: "service", displayName: "Orders API" },
          { id: "worker", kind: "component", parentId: "payments" },
          { id: "payments", kind: "service", displayName: "Payments" },
          { id: "shipping", kind: "service", displayName: "Shipping" },
          { id: "catalog", kind: "service", displayName: "Catalog" },
        ]
      : [
          { id: "orders", kind: "service", displayName: "Orders" },
          { id: "worker", kind: "component", parentId: "orders" },
          { id: "payments", kind: "service", displayName: "Payments" },
          { id: "catalog", kind: "service", displayName: "Catalog" },
        ],
    relationships: proposed
      ? [{ source: "orders", target: "shipping", kind: "depends-on" }]
      : [{ source: "orders", target: "payments", kind: "calls" }],
    authority: {
      ownership: [
        {
          resource: "payments",
          owner: proposed ? "shipping" : "orders",
        },
      ],
    },
    views: [
      {
        key: "structure",
        kind: "structural",
        scope: {
          include: (proposed
            ? ["orders", "worker", "payments", "shipping", "catalog"]
            : ["orders", "worker", "payments", "catalog"]
          ).map((id) => ({ kind: "element" as const, id })),
        },
        root: { kind: "element", id: "orders" },
        presentation: { direction: "lr" },
      },
    ],
  });
}

test("projects current and proposed Canons independently and annotates graph deltas", async () => {
  const result = await projectDesignIntentGraphDelta({
    current: document(false),
    proposed: document(true),
    // Code Intent entries are semantic obligations, not graph nodes.
    codeIntent: [
      {
        id: "intent-orders",
        ownerId: "orders",
        responsibilityIds: [],
        decisionIds: [],
        invariants: [],
        prohibitions: [],
        verificationObligations: [],
      },
    ],
  });

  const currentView = result.current.views[0];
  const proposedView = result.proposed?.views[0];
  assert.ok(currentView);
  assert.ok(proposedView);
  assert.equal(currentView.nodes.length, 4);
  assert.equal(proposedView.nodes.length, 5);

  const currentOrders = currentView.nodes.find(({ data }) => data.canonId === "orders");
  const proposedOrders = proposedView.nodes.find(({ data }) => data.canonId === "orders");
  const currentWorker = currentView.nodes.find(({ data }) => data.canonId === "worker");
  const proposedWorker = proposedView.nodes.find(({ data }) => data.canonId === "worker");
  const currentPayments = currentView.nodes.find(({ data }) => data.canonId === "payments");
  const proposedPayments = proposedView.nodes.find(({ data }) => data.canonId === "payments");
  const proposedShipping = proposedView.nodes.find(({ data }) => data.canonId === "shipping");
  const currentCatalog = currentView.nodes.find(({ data }) => data.canonId === "catalog");
  const proposedCatalog = proposedView.nodes.find(({ data }) => data.canonId === "catalog");

  assert.equal(currentOrders?.id, proposedOrders?.id, "stable Canon IDs correlate across projections");
  assert.equal(currentPayments?.id, proposedPayments?.id, "stable Canon IDs correlate across projections");
  assert.equal(currentOrders?.data.deltaState, "modified");
  assert.equal(proposedOrders?.data.deltaState, "modified");
  assert.equal(currentWorker?.data.deltaState, "modified", "owner changes remain visible");
  assert.equal(proposedWorker?.data.deltaState, "modified", "owner changes remain visible");
  assert.equal(currentPayments?.data.deltaState, "modified", "ownership changes remain visible");
  assert.equal(proposedPayments?.data.deltaState, "modified", "ownership changes remain visible");
  assert.equal(currentCatalog?.data.deltaState, "unchanged");
  assert.equal(proposedCatalog?.data.deltaState, "unchanged");
  assert.equal(proposedShipping?.data.deltaState, "added");
  assert.equal(currentView.edges[0]?.data.deltaState, "removed");
  assert.equal(proposedView.edges[0]?.data.deltaState, "added");
  assert.equal(currentView.nodes.filter(({ data }) => data.canonId.startsWith("intent-")).length, 0);
});

test("keeps a current-only view compatible when no proposal exists", async () => {
  const current = document(false);
  const result = await projectDesignIntentGraphDelta({ current });

  assert.equal(result.proposed, undefined);
  assert.equal(
    result.current.nodes.every(({ data }) => data.deltaState === undefined),
    true,
  );
});
