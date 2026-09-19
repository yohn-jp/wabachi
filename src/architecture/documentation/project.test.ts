import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../canon/document.js";
import { projectArchitectureDocument } from "./project.js";
import type { DocumentationModel } from "./model.js";

function createCompleteDocument(reverse = false) {
  const ordered = <T>(values: readonly T[]): readonly T[] => (reverse ? [...values].reverse() : values);

  return createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: ordered([
      {
        id: "customer",
        kind: "actor" as const,
        displayName: "Customer",
        technology: "Browser",
        tags: ordered(["external", "person"]),
        properties: reverse ? { region: "global", channel: "web" } : { channel: "web", region: "global" },
      },
      { id: "orders", kind: "service" as const },
      { id: "payments", kind: "service" as const },
      { id: "store", kind: "data-store" as const },
    ]),
    interfaces: ordered([
      { id: "orders-api", owner: "orders" },
      { id: "payments-api", owner: "payments" },
    ]),
    relationships: ordered([
      { source: "orders", target: "payments", kind: "calls" as const },
      { source: "payments", target: "store", kind: "data" as const },
    ]),
    responsibilities: {
      responsibilities: ordered([
        { id: "orders-responsibility", target: { kind: "object" as const, id: "orders" }, concern: "orders" },
        {
          id: "platform-responsibility",
          target: { kind: "architecture" as const, id: "architecture" },
          concern: "platform",
        },
      ]),
    },
    authority: {
      authority: [{ concern: "orders", owner: "orders" }],
      ownership: [{ resource: "store", owner: "payments" }],
    },
    boundaries: [{ id: "orders-boundary", kind: "semantic", memberIds: ["orders", "payments"] }],
    constraints: ordered([
      { kind: "may-call" as const, source: "orders", target: "payments" },
      { kind: "single-authority" as const, concern: "orders" },
    ]),
    flows: ordered([
      { id: "checkout-flow", steps: [{ interfaceId: "orders-api" }] },
      { id: "payment-flow", steps: [{ interfaceId: "payments-api" }] },
    ]),
    deployment: {
      runtimeEnvironments: [{ id: "production" }],
      deploymentNodes: [{ id: "orders-node", environmentId: "production" }],
      deploymentInstances: [{ id: "orders-instance", nodeId: "orders-node" }],
      infrastructureReferences: [{ id: "production-cluster", reference: "cluster/production" }],
      mappings: [{ softwareElementId: "orders", deploymentInstanceId: "orders-instance" }],
    },
    repositoryMappings: [{ canonId: "orders", paths: ["src/orders.ts"] }],
    decisions: {
      decisions: [
        {
          id: "orders-decision",
          title: "Use the orders service",
          status: "accepted",
          type: "architecture",
          rationale: "The service owns order processing.",
          targetIds: ["orders"],
          referenceIds: ["orders-design"],
        },
      ],
      references: [{ id: "orders-design", label: "Design", uri: "https://example.test/orders" }],
      referenceAttachments: [{ targetId: "orders", referenceIds: ["orders-design"] }],
    },
    views: [
      { key: "structure", kind: "structural", scope: { include: [{ kind: "element", id: "orders" }] } },
      { key: "flow", kind: "dynamic", scope: { include: [{ kind: "flow", id: "checkout-flow" }] } },
      {
        key: "deployment",
        kind: "deployment",
        scope: {
          include: [
            { kind: "element", id: "orders" },
            { kind: "deployment-instance", id: "orders-instance" },
            { kind: "infrastructure-reference", id: "production-cluster" },
          ],
        },
      },
    ],
  });
}

function section(model: DocumentationModel, key: string) {
  return model.sections.find((candidate) => candidate.key === key);
}

function group(model: DocumentationModel, sectionKey: string, groupKey: string) {
  const candidate = section(model, sectionKey)?.groups.find((item) => item.key === groupKey);
  assert.ok(candidate);
  return candidate;
}

test("projects all v1 Canon categories into deterministic anchored documentation data", () => {
  const document = createCompleteDocument();
  const model = projectArchitectureDocument(document);

  assert.deepEqual(model.navigation, [
    { section: "structure", groupKeys: ["elements", "interfaces", "relationships", "boundaries"] },
    { section: "responsibility", groupKeys: ["responsibilities"] },
    { section: "authority", groupKeys: ["authority", "ownership"] },
    { section: "constraints", groupKeys: ["constraints"] },
    { section: "flows", groupKeys: ["flows"] },
    {
      section: "deployment",
      groupKeys: [
        "runtimeEnvironments",
        "deploymentNodes",
        "deploymentInstances",
        "infrastructureReferences",
        "mappings",
      ],
    },
    { section: "mappings", groupKeys: ["repositoryMappings"] },
    { section: "decisions", groupKeys: ["decisions"] },
    { section: "references", groupKeys: ["references", "attachments"] },
    { section: "views", groupKeys: ["views"] },
  ]);
  assert.deepEqual(model.root, { canonId: "architecture" });
  assert.deepEqual(group(model, "structure", "elements").entries[0], {
    key: "customer",
    anchors: [{ canonId: "customer" }],
    data: {
      id: "customer",
      kind: "actor",
      displayName: "Customer",
      technology: "Browser",
      tags: ["external", "person"],
      properties: { channel: "web", region: "global" },
    },
  });
  assert.deepEqual(
    group(model, "structure", "relationships").entries.map((entry) => entry.data),
    document.relationships,
  );
  assert.deepEqual(
    group(model, "responsibility", "responsibilities").entries.map((entry) => entry.data),
    document.responsibilities.responsibilities,
  );
  assert.deepEqual(
    group(model, "deployment", "mappings").entries.map((entry) => entry.data),
    document.deployment.mappings,
  );
  assert.deepEqual(
    group(model, "mappings", "repositoryMappings").entries.map((entry) => entry.data),
    document.repositoryMappings,
  );
  assert.deepEqual(group(model, "decisions", "decisions").entries[0]?.anchors, [
    { canonId: "orders-decision" },
    { canonId: "orders" },
    { canonId: "orders-design" },
  ]);
  assert.deepEqual(group(model, "references", "references").entries[0]?.data, document.decisions.references[0]);
  assert.deepEqual(
    group(model, "views", "views").entries.map((entry) => entry.data),
    document.views,
  );
  assert.equal("html" in model, false);
  assert.equal("structurizr" in model, false);
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.sections), true);
});

test("equivalent Canon input produces equivalent documentation data", () => {
  assert.deepEqual(
    projectArchitectureDocument(createCompleteDocument()),
    projectArchitectureDocument(createCompleteDocument(true)),
  );
});

test("projection refuses an Architecture Canon that has not passed complete-document validation", () => {
  const invalid = createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service" }],
    repositoryMappings: [{ canonId: "missing", paths: ["src/missing.ts"] }],
  });

  assert.throws(() => projectArchitectureDocument(invalid), /cannot project invalid Architecture Canon/);
});
