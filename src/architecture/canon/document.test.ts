import assert from "node:assert/strict";
import test from "node:test";

import { CANON_VERSION } from "./identity.js";
import { CANON_SECTION_ORDER, createArchitectureDocument } from "./document.js";

function createCompleteInput() {
  return {
    documentId: "document",
    root: { id: "architecture" },
    elements: [
      { id: "element", kind: "service" as const },
      { id: "parent", kind: "system" as const },
    ],
    interfaces: [{ id: "interface", owner: "element" }],
    relationships: [{ source: "not-declared", target: "also-not-declared", kind: "calls" as const }],
    responsibilities: {
      responsibilities: [
        { id: "responsibility", target: { kind: "object" as const, id: "element" }, concern: "operations" },
      ],
    },
    authority: {
      authority: [{ concern: "element", owner: "owner" }],
      ownership: [{ resource: "resource", owner: "owner" }],
    },
    boundaries: [{ id: "boundary", kind: "semantic" as const, memberIds: ["element"] }],
    constraints: [{ kind: "may-call" as const, source: "element", target: "target" }],
    flows: [{ id: "flow", steps: [{ relationshipId: "not-declared" }] }],
    deployment: {
      runtimeEnvironments: [{ id: "production" }],
      deploymentNodes: [{ id: "node", environmentId: "production" }],
      deploymentInstances: [{ id: "instance", nodeId: "node" }],
      infrastructureReferences: [{ id: "infrastructure", reference: "cluster/prod" }],
      mappings: [{ softwareElementId: "element", deploymentInstanceId: "instance" }],
    },
    repositoryMappings: [{ canonId: "element", paths: ["src/element.ts"] }],
    decisions: {
      decisions: [
        {
          id: "decision",
          title: "Use the service",
          status: "accepted" as const,
          type: "architecture" as const,
          rationale: "It is the canonical service boundary.",
          targetIds: ["element"],
          referenceIds: ["reference"],
        },
      ],
      references: [{ id: "reference", label: "Design", uri: "https://example.test/design" }],
      referenceAttachments: [{ targetId: "element", referenceIds: ["reference"] }],
    },
    views: [
      {
        key: "view",
        kind: "structural" as const,
        scope: { include: [{ kind: "element" as const, id: "not-declared" }] },
      },
    ],
  };
}

test("composes every Canon v1 section in deterministic order", () => {
  const document = createArchitectureDocument(createCompleteInput());

  assert.equal(document.canonVersion, CANON_VERSION);
  assert.deepEqual(Object.keys(document).slice(3, -1), CANON_SECTION_ORDER);
  assert.deepEqual(document.globalIdentityRegistry.entries, [
    { id: "architecture", namespace: "architecture" },
    { id: "boundary", namespace: "boundary" },
    { id: "decision", namespace: "decision" },
    { id: "element", namespace: "element" },
    { id: "flow", namespace: "flow" },
    { id: "interface", namespace: "interface" },
    { id: "parent", namespace: "element" },
    { id: "reference", namespace: "reference" },
    { id: "responsibility", namespace: "responsibility" },
  ]);
  assert.equal(document.deployment.deploymentInstances[0]?.id, "instance");
  assert.equal(document.decisions.decisions[0]?.id, "decision");
  assert.equal(document.views[0]?.key, "view");
  assert.equal(Object.isFrozen(document), true);
  assert.equal(Object.isFrozen(document.globalIdentityRegistry.entries), true);
});

test("normalizes all sections and registry entries independently of declaration order", () => {
  const first = createCompleteInput();
  const second = createCompleteInput();

  first.elements.reverse();
  second.elements.reverse();
  first.relationships.reverse();
  first.boundaries.reverse();
  first.constraints.reverse();
  first.flows.reverse();
  first.deployment.runtimeEnvironments?.reverse();
  first.deployment.deploymentNodes?.reverse();
  first.deployment.deploymentInstances?.reverse();
  first.deployment.infrastructureReferences?.reverse();
  first.deployment.mappings?.reverse();
  first.repositoryMappings.reverse();
  first.views.reverse();

  assert.deepEqual(createArchitectureDocument(first), createArchitectureDocument(second));
});

test("rejects duplicate canonical IDs across namespaces deterministically", () => {
  assert.throws(
    () =>
      createArchitectureDocument({
        documentId: "document",
        root: { id: "architecture" },
        elements: [{ id: "shared", kind: "service" }],
        interfaces: [{ id: "shared", owner: "not-declared" }],
      }),
    /duplicate canonical id: shared \(element, interface\)/,
  );
});

test("leaves cross-section reference resolution to a later validation boundary", () => {
  assert.doesNotThrow(() =>
    createArchitectureDocument({
      documentId: "document",
      root: { id: "architecture" },
      relationships: [{ source: "missing", target: "also-missing", kind: "uses" }],
      flows: [{ id: "flow", steps: [{ relationshipId: "missing" }] }],
      views: [{ key: "view", kind: "dynamic", scope: { include: [{ kind: "flow", id: "missing" }] } }],
    }),
  );
});
