import assert from "node:assert/strict";
import test from "node:test";

import { createDeploymentMapping, createDeploymentTopology, createInfrastructureReference } from "./deployment.js";

test("represents a runtime and multi-node deployment topology", () => {
  const topology = createDeploymentTopology({
    runtimeEnvironments: [{ id: "production", displayName: "Production" }],
    deploymentNodes: [
      { id: "node-b", environmentId: "production" },
      { id: "node-a", environmentId: "production" },
    ],
    deploymentInstances: [
      { id: "orders-b", nodeId: "node-b" },
      { id: "orders-a", nodeId: "node-a" },
    ],
    infrastructureReferences: [{ id: "cluster", reference: "cluster/prod" }],
    mappings: [
      { softwareElementId: "orders", deploymentInstanceId: "orders-b" },
      { softwareElementId: "orders", deploymentInstanceId: "orders-a" },
    ],
  });

  assert.deepEqual(
    topology.runtimeEnvironments.map((entry) => entry.id),
    ["production"],
  );
  assert.deepEqual(
    topology.deploymentNodes.map((entry) => entry.id),
    ["node-a", "node-b"],
  );
  assert.deepEqual(
    topology.deploymentInstances.map((entry) => entry.id),
    ["orders-a", "orders-b"],
  );
  assert.deepEqual(topology.mappings, [
    {
      kind: "deployment-mapping",
      softwareElementId: "orders",
      deploymentInstanceId: "orders-a",
    },
    {
      kind: "deployment-mapping",
      softwareElementId: "orders",
      deploymentInstanceId: "orders-b",
    },
  ]);
});

test("normalizes equivalent topology declarations without changing identities", () => {
  const first = createDeploymentTopology({
    deploymentNodes: [
      { id: "cafe\u0301-node", environmentId: "prod" },
      { id: "a-node", environmentId: "prod" },
    ],
    runtimeEnvironments: [{ id: "prod" }],
    deploymentInstances: [{ id: "instance-b", nodeId: "cafe\u0301-node" }],
  });
  const second = createDeploymentTopology({
    runtimeEnvironments: [{ id: "prod" }],
    deploymentNodes: [
      { id: "a-node", environmentId: "prod" },
      { id: "café-node", environmentId: "prod" },
    ],
    deploymentInstances: [{ id: "instance-b", nodeId: "café-node" }],
  });

  assert.deepEqual(first, second);
  assert.equal(first.deploymentNodes[1]?.id, "café-node");
});

test("keeps infrastructure references opaque and deployment identity separate", () => {
  const reference = createInfrastructureReference({ id: "cluster", reference: "k8s/prod" });
  const mapping = createDeploymentMapping({
    softwareElementId: "orders",
    deploymentInstanceId: "orders-a",
  });

  assert.deepEqual(reference, {
    kind: "infrastructure-reference",
    id: "cluster",
    reference: "k8s/prod",
  });
  assert.deepEqual(mapping, {
    kind: "deployment-mapping",
    softwareElementId: "orders",
    deploymentInstanceId: "orders-a",
  });
});

test("rejects malformed and duplicate topology declarations", () => {
  assert.throws(() => createInfrastructureReference({ id: "cluster", reference: " " }), /is malformed/);
  assert.throws(
    () =>
      createDeploymentTopology({
        deploymentNodes: [
          { id: "node-a", environmentId: "prod" },
          { id: "node-a", environmentId: "prod" },
        ],
      }),
    /duplicate deployment node id: node-a/,
  );
  assert.throws(
    () =>
      createDeploymentTopology({
        mappings: [
          { softwareElementId: "orders", deploymentInstanceId: "orders-a" },
          { softwareElementId: "orders", deploymentInstanceId: "orders-a" },
        ],
      }),
    /duplicate deployment mapping/,
  );
});
