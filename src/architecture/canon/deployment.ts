import { createObjectId, type ObjectId, normalizeIdentityId } from "./identity.js";

declare const runtimeEnvironmentIdBrand: unique symbol;
declare const deploymentNodeIdBrand: unique symbol;
declare const deploymentInstanceIdBrand: unique symbol;
declare const infrastructureReferenceIdBrand: unique symbol;

/** An identity in the deployment namespace, not an architecture object identity. */
export type RuntimeEnvironmentId = string & {
  readonly [runtimeEnvironmentIdBrand]: never;
};
export type DeploymentNodeId = string & {
  readonly [deploymentNodeIdBrand]: never;
};
export type DeploymentInstanceId = string & {
  readonly [deploymentInstanceIdBrand]: never;
};
export type InfrastructureReferenceId = string & {
  readonly [infrastructureReferenceIdBrand]: never;
};

export interface RuntimeEnvironmentInput {
  readonly id: string;
  readonly displayName?: string;
}

export interface RuntimeEnvironment {
  readonly kind: "runtime-environment";
  readonly id: RuntimeEnvironmentId;
  readonly displayName?: string;
}

export interface DeploymentNodeInput {
  readonly id: string;
  readonly environmentId: string;
  readonly displayName?: string;
}

export interface DeploymentNode {
  readonly kind: "deployment-node";
  readonly id: DeploymentNodeId;
  readonly environmentId: RuntimeEnvironmentId;
  readonly displayName?: string;
}

export interface DeploymentInstanceInput {
  readonly id: string;
  readonly nodeId: string;
  readonly displayName?: string;
}

export interface DeploymentInstance {
  readonly kind: "deployment-instance";
  readonly id: DeploymentInstanceId;
  readonly nodeId: DeploymentNodeId;
  readonly displayName?: string;
}

export interface InfrastructureReferenceInput {
  readonly id: string;
  readonly reference: string;
}

export interface InfrastructureReference {
  readonly kind: "infrastructure-reference";
  readonly id: InfrastructureReferenceId;
  /** An opaque declaration; resolving or provisioning it is out of scope. */
  readonly reference: string;
}

export interface DeploymentMappingInput {
  readonly softwareElementId: string;
  readonly deploymentInstanceId: string;
}

export interface DeploymentMapping {
  readonly kind: "deployment-mapping";
  readonly softwareElementId: ObjectId;
  readonly deploymentInstanceId: DeploymentInstanceId;
}

export interface DeploymentTopologyInput {
  readonly runtimeEnvironments?: readonly RuntimeEnvironmentInput[];
  readonly deploymentNodes?: readonly DeploymentNodeInput[];
  readonly deploymentInstances?: readonly DeploymentInstanceInput[];
  readonly infrastructureReferences?: readonly InfrastructureReferenceInput[];
  readonly mappings?: readonly DeploymentMappingInput[];
}

export interface DeploymentTopology {
  readonly runtimeEnvironments: readonly RuntimeEnvironment[];
  readonly deploymentNodes: readonly DeploymentNode[];
  readonly deploymentInstances: readonly DeploymentInstance[];
  readonly infrastructureReferences: readonly InfrastructureReference[];
  readonly mappings: readonly DeploymentMapping[];
}

function assertRecord(input: unknown, label: string): asserts input is object {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeDeploymentId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = normalizeIdentityId(value);
  return normalized;
}

function normalizeDisplayName(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value.normalize("NFC");
}

function readDisplayName(input: object, label: string): string | undefined {
  return normalizeDisplayName((input as { displayName?: unknown }).displayName, `${label} displayName`);
}

function asRuntimeEnvironmentId(value: unknown): RuntimeEnvironmentId {
  return normalizeDeploymentId(value, "runtime environment id") as RuntimeEnvironmentId;
}

function asDeploymentNodeId(value: unknown): DeploymentNodeId {
  return normalizeDeploymentId(value, "deployment node id") as DeploymentNodeId;
}

function asDeploymentInstanceId(value: unknown): DeploymentInstanceId {
  return normalizeDeploymentId(value, "deployment instance id") as DeploymentInstanceId;
}

function asInfrastructureReferenceId(value: unknown): InfrastructureReferenceId {
  return normalizeDeploymentId(value, "infrastructure reference id") as InfrastructureReferenceId;
}

function sortById<T extends { readonly id: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function rejectDuplicateIds(records: readonly { readonly id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`duplicate ${label} id: ${record.id}`);
    }
    seen.add(record.id);
  }
}

function freezeArray<T>(records: readonly T[]): readonly T[] {
  return Object.freeze([...records]);
}

export function createRuntimeEnvironment(input: RuntimeEnvironmentInput): RuntimeEnvironment {
  assertRecord(input, "runtime environment");
  const candidate = input as { id?: unknown; displayName?: unknown };
  const displayName = readDisplayName(input, "runtime environment");
  const record: RuntimeEnvironment = {
    kind: "runtime-environment",
    id: asRuntimeEnvironmentId(candidate.id),
    ...(displayName === undefined ? {} : { displayName }),
  };
  return Object.freeze(record);
}

export function createDeploymentNode(input: DeploymentNodeInput): DeploymentNode {
  assertRecord(input, "deployment node");
  const candidate = input as {
    id?: unknown;
    environmentId?: unknown;
    displayName?: unknown;
  };
  const displayName = readDisplayName(input, "deployment node");
  const record: DeploymentNode = {
    kind: "deployment-node",
    id: asDeploymentNodeId(candidate.id),
    environmentId: asRuntimeEnvironmentId(candidate.environmentId),
    ...(displayName === undefined ? {} : { displayName }),
  };
  return Object.freeze(record);
}

export function createDeploymentInstance(input: DeploymentInstanceInput): DeploymentInstance {
  assertRecord(input, "deployment instance");
  const candidate = input as {
    id?: unknown;
    nodeId?: unknown;
    displayName?: unknown;
  };
  const displayName = readDisplayName(input, "deployment instance");
  const record: DeploymentInstance = {
    kind: "deployment-instance",
    id: asDeploymentInstanceId(candidate.id),
    nodeId: asDeploymentNodeId(candidate.nodeId),
    ...(displayName === undefined ? {} : { displayName }),
  };
  return Object.freeze(record);
}

export function createInfrastructureReference(input: InfrastructureReferenceInput): InfrastructureReference {
  assertRecord(input, "infrastructure reference");
  const candidate = input as { id?: unknown; reference?: unknown };
  const reference = normalizeDeploymentId(candidate.reference, "infrastructure reference");
  const record: InfrastructureReference = {
    kind: "infrastructure-reference",
    id: asInfrastructureReferenceId(candidate.id),
    reference,
  };
  return Object.freeze(record);
}

export function createDeploymentMapping(input: DeploymentMappingInput): DeploymentMapping {
  assertRecord(input, "deployment mapping");
  const candidate = input as {
    softwareElementId?: unknown;
    deploymentInstanceId?: unknown;
  };
  const record: DeploymentMapping = {
    kind: "deployment-mapping",
    softwareElementId: createObjectId(normalizeDeploymentId(candidate.softwareElementId, "software element id")),
    deploymentInstanceId: asDeploymentInstanceId(candidate.deploymentInstanceId),
  };
  return Object.freeze(record);
}

function readRecords<T>(value: unknown, label: string, create: (input: T) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value.map((record) => create(record as T));
}

export function createDeploymentTopology(input: DeploymentTopologyInput): DeploymentTopology {
  assertRecord(input, "deployment topology");
  const candidate = input as {
    runtimeEnvironments?: unknown;
    deploymentNodes?: unknown;
    deploymentInstances?: unknown;
    infrastructureReferences?: unknown;
    mappings?: unknown;
  };

  const runtimeEnvironments = readRecords(
    candidate.runtimeEnvironments,
    "runtime environments",
    createRuntimeEnvironment,
  );
  const deploymentNodes = readRecords(candidate.deploymentNodes, "deployment nodes", createDeploymentNode);
  const deploymentInstances = readRecords(
    candidate.deploymentInstances,
    "deployment instances",
    createDeploymentInstance,
  );
  const infrastructureReferences = readRecords(
    candidate.infrastructureReferences,
    "infrastructure references",
    createInfrastructureReference,
  );
  const mappings = readRecords(candidate.mappings, "deployment mappings", createDeploymentMapping);

  rejectDuplicateIds(runtimeEnvironments, "runtime environment");
  rejectDuplicateIds(deploymentNodes, "deployment node");
  rejectDuplicateIds(deploymentInstances, "deployment instance");
  rejectDuplicateIds(infrastructureReferences, "infrastructure reference");

  const mappingKeys = new Set<string>();
  for (const mapping of mappings) {
    const key = `${mapping.softwareElementId}\u0000${mapping.deploymentInstanceId}`;
    if (mappingKeys.has(key)) {
      throw new Error(`duplicate deployment mapping: ${mapping.softwareElementId} -> ${mapping.deploymentInstanceId}`);
    }
    mappingKeys.add(key);
  }

  return Object.freeze({
    runtimeEnvironments: freezeArray(sortById(runtimeEnvironments)),
    deploymentNodes: freezeArray(sortById(deploymentNodes)),
    deploymentInstances: freezeArray(sortById(deploymentInstances)),
    infrastructureReferences: freezeArray(sortById(infrastructureReferences)),
    mappings: freezeArray(
      [...mappings].sort((left, right) => {
        const softwareOrder = left.softwareElementId.localeCompare(right.softwareElementId);
        if (softwareOrder !== 0) return softwareOrder;
        return left.deploymentInstanceId.localeCompare(right.deploymentInstanceId);
      }),
    ),
  });
}
