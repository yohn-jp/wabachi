import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument, type ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { digestJson } from "../digest.js";
import {
  CANON_DELTA_COLLECTIONS,
  recomposeCanon,
  splitCanon,
  validateCodeIntentSourceTargets,
} from "./canon-adapter.js";

function completeCanon(): ArchitectureDocumentV1 {
  return createArchitectureDocument({
    documentId: "canon-adapter-test",
    root: { id: "architecture" },
    elements: [
      { id: "orders", kind: "service", displayName: "Orders" },
      { id: "worker", kind: "component", parentId: "orders" },
    ],
    interfaces: [{ id: "orders-api", owner: "orders", protocol: "https" }],
    relationships: [{ source: "orders", target: "worker", kind: "calls" }],
    responsibilities: {
      responsibilities: [{ id: "orders-responsibility", target: { kind: "object", id: "orders" }, concern: "orders" }],
    },
    authority: {
      authority: [{ concern: "orders", owner: "orders" }],
      ownership: [{ resource: "worker", owner: "orders" }],
    },
    boundaries: [{ id: "orders-boundary", kind: "semantic", memberIds: ["orders", "worker"] }],
    constraints: [
      { kind: "may-depend-on", source: "orders", target: "worker" },
      { kind: "must-go-through", source: "orders", target: "worker", through: "orders" },
    ],
    flows: [{ id: "order-flow", steps: [{ interfaceId: "orders-api", operation: "create" }] }],
    deployment: {
      runtimeEnvironments: [{ id: "production" }],
      deploymentNodes: [{ id: "orders-node", environmentId: "production" }],
      deploymentInstances: [{ id: "orders-instance", nodeId: "orders-node" }],
      infrastructureReferences: [{ id: "cluster", reference: "k8s/prod" }],
      mappings: [{ softwareElementId: "orders", deploymentInstanceId: "orders-instance" }],
    },
    repositoryMappings: [
      {
        canonId: "intent",
        paths: [{ path: "planned/not-yet-created.ts", scope: "file" }],
        symbols: [{ path: "planned/not-yet-created.ts", symbol: "OrdersService" }],
        tests: [{ path: "planned/not-yet-created.test.ts", selector: "orders" }],
      },
    ],
    decisions: {
      decisions: [
        {
          id: "orders-decision",
          title: "Orders owns order creation",
          status: "accepted",
          type: "architecture",
          rationale: "Orders is the service boundary.",
          targetIds: ["orders"],
        },
      ],
      references: [{ id: "orders-reference", label: "Orders ADR", uri: "https://example.invalid/orders" }],
      referenceAttachments: [{ targetId: "orders", referenceIds: ["orders-reference"] }],
    },
    views: [
      {
        key: "orders-view",
        kind: "structural",
        scope: { include: [{ kind: "element", id: "orders" }] },
      },
    ],
    codeIntents: {
      schemaVersion: 1,
      entries: [
        {
          id: "intent",
          ownerId: "orders",
          responsibilityIds: ["orders-responsibility"],
          decisionIds: ["orders-decision"],
          invariants: [{ id: "orders-invariant", text: "orders remain durable" }],
        },
      ],
    },
  });
}

test("split and recompose preserve every supported Canon collection", () => {
  const original = completeCanon();
  const split = splitCanon(original);

  assert.deepEqual(CANON_DELTA_COLLECTIONS, [
    "architecture",
    "element",
    "interface",
    "relationship",
    "responsibility",
    "authority",
    "boundary",
    "constraint",
    "flow",
    "deployment",
    "repository-mapping",
    "decision",
    "view",
    "code-intent",
  ]);
  assert.deepEqual(recomposeCanon(split), original);
  assert.equal(digestJson(recomposeCanon(split)), digestJson(original));
});

test("the identity registry is derived and cannot be supplied as a delta collection", () => {
  const split = splitCanon(completeCanon());
  assert.throws(
    () => recomposeCanon({ ...split, globalIdentityRegistry: { entries: [] } } as never),
    /unsupported field: globalIdentityRegistry/,
  );
});

test("planned source symbols are valid design targets without filesystem access", () => {
  const result = validateCodeIntentSourceTargets(completeCanon());
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("owner mismatch and dangling source mappings fail closed", () => {
  const document = completeCanon();
  const forged = {
    ...document,
    codeIntents: {
      ...document.codeIntents!,
      entries: [{ ...document.codeIntents!.entries[0]!, id: "missing-source", ownerId: "missing-owner" }],
    },
  } as ArchitectureDocumentV1;
  const result = validateCodeIntentSourceTargets(forged);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "owner-mismatch"));
  assert.ok(result.diagnostics.some(({ code }) => code === "dangling-source-mapping"));
});
