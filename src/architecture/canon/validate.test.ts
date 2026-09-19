import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "./document.js";
import { validateArchitectureDocument } from "./validate.js";

function createCompleteDocument() {
  return createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: [
      { id: "orders", kind: "service" },
      { id: "payments", kind: "service" },
    ],
    interfaces: [{ id: "orders-api", owner: "orders" }],
    relationships: [{ source: "orders", target: "payments", kind: "calls" }],
    responsibilities: {
      responsibilities: [
        { id: "orders-responsibility", target: { kind: "object", id: "orders" }, concern: "orders" },
        { id: "platform-responsibility", target: { kind: "architecture", id: "architecture" }, concern: "platform" },
      ],
    },
    authority: {
      authority: [{ concern: "orders", owner: "orders" }],
      ownership: [{ resource: "payments", owner: "payments" }],
    },
    boundaries: [{ id: "orders-boundary", kind: "semantic", memberIds: ["orders", "payments"] }],
    constraints: [
      { kind: "may-call", source: "orders", target: "payments" },
      { kind: "single-authority", concern: "orders" },
    ],
    flows: [{ id: "checkout-flow", steps: [{ interfaceId: "orders-api" }] }],
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

test("accepts a complete document when every cross-section reference is eligible", () => {
  const document = createCompleteDocument();
  const result = validateArchitectureDocument(document);

  assert.deepEqual(result, { valid: true, diagnostics: [] });
});

test("fails closed for unknown, incompatible, and excluded view roots", () => {
  const document = createCompleteDocument();
  const invalidDocument = {
    ...document,
    views: [
      {
        ...document.views[0],
        root: { kind: "element", id: "missing-root" },
      },
      {
        ...document.views[1],
        root: { kind: "runtime-environment", id: "production" },
      },
      {
        ...document.views[2],
        root: { kind: "runtime-environment", id: "production" },
        scope: {
          ...document.views[2]?.scope,
          exclude: [{ kind: "runtime-environment", id: "production" }],
        },
      },
    ],
  } as unknown as typeof document;

  const first = validateArchitectureDocument(invalidDocument);
  const second = validateArchitectureDocument(invalidDocument);

  assert.deepEqual(first, second);
  assert.equal(first.valid, false);
  assert.ok(first.diagnostics.some(({ path, code }) => path === "views[0].root" && code === "invalid-view-root"));
  assert.ok(first.diagnostics.some(({ path, code }) => path === "views[1].root" && code === "invalid-view-root"));
  assert.ok(
    first.diagnostics.some(({ path, code }) => path === "views[2].scope.exclude[0]" && code === "invalid-view-root"),
  );
});

test("rejects a single-authority concern without an authority owner", () => {
  const document = createCompleteDocument();
  const invalidDocument = {
    ...document,
    authority: { ...document.authority, authority: [] },
  } as typeof document;

  const result = validateArchitectureDocument(invalidDocument);

  assert.deepEqual(result.diagnostics, [
    {
      code: "invalid-single-authority",
      path: "constraints[1]",
      message: "single-authority constraint requires exactly one authority owner for concern: orders; found 0",
    },
  ]);
});

test("rejects a single-authority concern with multiple distinct authority owners", () => {
  const document = createCompleteDocument();
  const invalidDocument = {
    ...document,
    authority: {
      ...document.authority,
      authority: [...document.authority.authority, { kind: "authority", concern: "orders", owner: "payments" }],
    },
  } as typeof document;

  const result = validateArchitectureDocument(invalidDocument);

  assert.deepEqual(result.diagnostics, [
    {
      code: "invalid-single-authority",
      path: "constraints[1]",
      message: "single-authority constraint requires exactly one authority owner for concern: orders; found 2",
    },
  ]);
});

test("does not evaluate single-authority cardinality when its concern is invalid", () => {
  const document = createCompleteDocument();
  const invalidDocument = {
    ...document,
    constraints: document.constraints.map((constraint) =>
      constraint.kind === "single-authority" ? { ...constraint, concern: "missing-concern" } : constraint,
    ),
  } as unknown as typeof document;

  const result = validateArchitectureDocument(invalidDocument);

  assert.deepEqual(result.diagnostics, [
    {
      code: "invalid-constraint-target",
      path: "constraints[1].concern",
      message: "constraint concern references unknown element: missing-concern",
    },
  ]);
});

test("returns deterministic, path-addressed diagnostics and does not mutate Canon", () => {
  const document = createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service" }],
    interfaces: [{ id: "orders-api", owner: "missing-owner" }],
    relationships: [{ source: "missing-source", target: "orders", kind: "calls" }],
    responsibilities: {
      responsibilities: [{ id: "responsibility", target: { kind: "object", id: "missing-target" }, concern: "orders" }],
    },
    boundaries: [{ id: "boundary", kind: "semantic", memberIds: ["missing-member"] }],
    authority: { authority: [{ concern: "missing-concern", owner: "orders" }] },
    constraints: [{ kind: "may-call", source: "missing-source", target: "orders" }],
    flows: [{ id: "flow", steps: [{ interfaceId: "missing-interface" }, { relationshipId: "missing-relationship" }] }],
    deployment: {
      deploymentNodes: [{ id: "node", environmentId: "missing-environment" }],
      deploymentInstances: [{ id: "instance", nodeId: "missing-node" }],
      mappings: [{ softwareElementId: "missing-element", deploymentInstanceId: "missing-instance" }],
    },
    repositoryMappings: [{ canonId: "missing-canon", paths: ["src/missing.ts"] }],
    decisions: {
      decisions: [
        {
          id: "decision",
          title: "Decision",
          status: "accepted",
          type: "architecture",
          rationale: "Rationale",
        },
      ],
    },
    views: [
      {
        key: "view",
        kind: "structural",
        scope: {
          include: [
            { kind: "element", id: "missing-element" },
            { kind: "relationship", id: "missing-relationship" },
            { kind: "runtime-environment", id: "missing-environment" },
          ],
        },
      },
    ],
  });
  const invalidDocument = {
    ...document,
    elements: [{ ...document.elements[0], parentId: "missing-parent" }],
    decisions: {
      ...document.decisions,
      decisions: [
        {
          ...document.decisions.decisions[0],
          targetIds: ["missing-target"],
          referenceIds: ["missing-reference"],
          supersedes: ["missing-decision"],
        },
      ],
    },
  } as unknown as typeof document;
  const before = structuredClone(invalidDocument);

  const first = validateArchitectureDocument(invalidDocument);
  const second = validateArchitectureDocument(invalidDocument);

  assert.deepEqual(first, second);
  assert.equal(first.valid, false);
  assert.ok(first.diagnostics.every(({ path, code }) => path.length > 0 && code.length > 0));
  assert.ok(
    first.diagnostics.some(
      ({ path, code }) => path === "flows[0].steps[0].interfaceId" && code === "invalid-flow-reference",
    ),
  );
  assert.ok(
    first.diagnostics.some(
      ({ path, code }) => path === "views[0].scope.include[1]" && code === "invalid-view-reference",
    ),
  );
  assert.deepEqual(invalidDocument, before);
});

test("fails closed when the global identity registry disagrees with its sections", () => {
  const document = createCompleteDocument();
  const forged = {
    ...document,
    globalIdentityRegistry: {
      entries: document.globalIdentityRegistry.entries.filter((entry) => entry.id !== "orders"),
    },
  } as typeof document;

  const result = validateArchitectureDocument(forged);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "identity-registry-mismatch"));
  assert.ok(
    result.diagnostics.some(
      ({ path, code }) => path === "repositoryMappings[0].canonId" && code === "invalid-repository-mapping",
    ),
  );
});
