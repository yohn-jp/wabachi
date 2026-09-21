import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import type {
  AddedSemanticEntry,
  CanonRevisionReference,
  DesignChangeOperation,
  DesignChangeSet,
  DesignChangeSetPayload,
  ModifiedSemanticEntry,
  RemovedSemanticEntry,
} from "../contracts.js";
import { canonicalizeJson, digestJson, type Digest, type JsonObject, type JsonValue } from "../digest.js";
import { createRelationshipEntryKey, createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";

interface SemanticEntry {
  readonly entryKey: SemanticEntryKey;
  readonly group: EntryGroup;
  readonly value: JsonValue;
}

type EntryGroup =
  | "architecture"
  | "elements"
  | "interfaces"
  | "relationships"
  | "responsibilities"
  | "authority"
  | "ownership"
  | "boundaries"
  | "constraints"
  | "flows"
  | "runtimeEnvironments"
  | "deploymentNodes"
  | "deploymentInstances"
  | "infrastructureReferences"
  | "deploymentMappings"
  | "repositoryMappings"
  | "decisions"
  | "decisionReferences"
  | "referenceAttachments"
  | "views";

interface CanonJson {
  readonly canonVersion: number;
  readonly documentId: string;
  readonly root: JsonValue;
  readonly elements: readonly JsonValue[];
  readonly interfaces: readonly JsonValue[];
  readonly relationships: readonly JsonValue[];
  readonly responsibilities: { readonly responsibilities: readonly JsonValue[] };
  readonly authority: { readonly authority: readonly JsonValue[]; readonly ownership: readonly JsonValue[] };
  readonly boundaries: readonly JsonValue[];
  readonly constraints: readonly JsonValue[];
  readonly flows: readonly JsonValue[];
  readonly deployment: {
    readonly runtimeEnvironments: readonly JsonValue[];
    readonly deploymentNodes: readonly JsonValue[];
    readonly deploymentInstances: readonly JsonValue[];
    readonly infrastructureReferences: readonly JsonValue[];
    readonly mappings: readonly JsonValue[];
  };
  readonly repositoryMappings: readonly JsonValue[];
  readonly decisions: {
    readonly decisions: readonly JsonValue[];
    readonly references: readonly JsonValue[];
    readonly referenceAttachments: readonly JsonValue[];
  };
  readonly views: readonly JsonValue[];
}

function asRecord(value: JsonValue, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function text(value: JsonValue, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a string`);
  return value;
}

function key(
  collection: Parameters<typeof createSemanticEntryKey>[0]["collection"],
  ...identity: string[]
): SemanticEntryKey {
  return createSemanticEntryKey({ collection, identity });
}

function entry(group: EntryGroup, entryKey: SemanticEntryKey, value: JsonValue): SemanticEntry {
  return { group, entryKey, value };
}

function flattenDocument(document: ArchitectureDocumentV1): readonly SemanticEntry[] {
  // Passing through the Canon codec first removes object-key/order formatting
  // differences and validates all cross-section references.
  const json = JSON.parse(serializeCanonicalArchitectureDocument(document)) as CanonJson;
  const entries: SemanticEntry[] = [];
  const root = asRecord(json.root, "Canon root");
  entries.push(entry("architecture", key("architecture", text(root.id, "Canon root id")), json.root));

  for (const value of json.elements) {
    const record = asRecord(value, "element");
    entries.push(entry("elements", key("element", text(record.id, "element id")), value));
  }
  for (const value of json.interfaces) {
    const record = asRecord(value, "interface");
    entries.push(entry("interfaces", key("interface", text(record.id, "interface id")), value));
  }
  for (const value of json.relationships) {
    const record = asRecord(value, "relationship");
    const interfaceId =
      record.interfaceId === undefined ? undefined : text(record.interfaceId, "relationship interfaceId");
    entries.push(
      entry(
        "relationships",
        createRelationshipEntryKey({
          source: text(record.source, "relationship source"),
          target: text(record.target, "relationship target"),
          kind: text(record.kind, "relationship kind") as never,
          ...(interfaceId === undefined ? {} : { interfaceId }),
        }),
        value,
      ),
    );
  }
  for (const value of json.responsibilities.responsibilities) {
    const record = asRecord(value, "responsibility");
    entries.push(entry("responsibilities", key("responsibility", text(record.id, "responsibility id")), value));
  }
  for (const value of json.authority.authority) {
    const record = asRecord(value, "authority fact");
    entries.push(entry("authority", key("authority", "authority", text(record.concern, "authority concern")), value));
  }
  for (const value of json.authority.ownership) {
    const record = asRecord(value, "ownership fact");
    entries.push(entry("ownership", key("authority", "ownership", text(record.resource, "ownership resource")), value));
  }
  for (const value of json.boundaries) {
    const record = asRecord(value, "boundary");
    entries.push(entry("boundaries", key("boundary", text(record.id, "boundary id")), value));
  }
  for (const value of json.constraints) {
    entries.push(entry("constraints", key("constraint", digestJson(value)), value));
  }
  for (const value of json.flows) {
    const record = asRecord(value, "flow");
    entries.push(entry("flows", key("flow", text(record.id, "flow id")), value));
  }
  for (const value of json.deployment.runtimeEnvironments) {
    const record = asRecord(value, "runtime environment");
    entries.push(
      entry(
        "runtimeEnvironments",
        key("deployment", "runtime-environment", text(record.id, "runtime environment id")),
        value,
      ),
    );
  }
  for (const value of json.deployment.deploymentNodes) {
    const record = asRecord(value, "deployment node");
    entries.push(
      entry("deploymentNodes", key("deployment", "deployment-node", text(record.id, "deployment node id")), value),
    );
  }
  for (const value of json.deployment.deploymentInstances) {
    const record = asRecord(value, "deployment instance");
    entries.push(
      entry(
        "deploymentInstances",
        key("deployment", "deployment-instance", text(record.id, "deployment instance id")),
        value,
      ),
    );
  }
  for (const value of json.deployment.infrastructureReferences) {
    const record = asRecord(value, "infrastructure reference");
    entries.push(
      entry(
        "infrastructureReferences",
        key("deployment", "infrastructure-reference", text(record.id, "infrastructure reference id")),
        value,
      ),
    );
  }
  for (const value of json.deployment.mappings) {
    const record = asRecord(value, "deployment mapping");
    entries.push(
      entry(
        "deploymentMappings",
        key(
          "deployment",
          "mapping",
          text(record.softwareElementId, "deployment mapping softwareElementId"),
          text(record.deploymentInstanceId, "deployment mapping deploymentInstanceId"),
        ),
        value,
      ),
    );
  }
  for (const value of json.repositoryMappings) {
    const record = asRecord(value, "repository mapping");
    entries.push(
      entry("repositoryMappings", key("repository-mapping", text(record.canonId, "repository mapping canonId")), value),
    );
  }
  for (const value of json.decisions.decisions) {
    const record = asRecord(value, "decision");
    entries.push(entry("decisions", key("decision", "decision", text(record.id, "decision id")), value));
  }
  for (const value of json.decisions.references) {
    const record = asRecord(value, "decision reference");
    entries.push(
      entry("decisionReferences", key("decision", "reference", text(record.id, "decision reference id")), value),
    );
  }
  for (const value of json.decisions.referenceAttachments) {
    const record = asRecord(value, "reference attachment");
    entries.push(
      entry(
        "referenceAttachments",
        key("decision", "reference-attachment", text(record.targetId, "reference attachment targetId")),
        value,
      ),
    );
  }
  for (const value of json.views) {
    const record = asRecord(value, "view");
    entries.push(entry("views", key("view", text(record.key, "view key")), value));
  }
  return entries;
}

function documentJson(document: ArchitectureDocumentV1): CanonJson {
  return JSON.parse(serializeCanonicalArchitectureDocument(document)) as CanonJson;
}

/** Computes a digest over a validated, Canon-normalized document. */
export function architectureCanonDigest(document: ArchitectureDocumentV1): Digest {
  return digestJson(documentJson(document));
}

/** Returns deterministic semantic operations between two Canon documents. */
export function diffArchitectureDocuments(
  base: ArchitectureDocumentV1,
  target: ArchitectureDocumentV1,
): readonly DesignChangeOperation[] {
  const baseEntries = new Map(flattenDocument(base).map((item) => [item.entryKey, item]));
  const targetEntries = new Map(flattenDocument(target).map((item) => [item.entryKey, item]));
  const operations: DesignChangeOperation[] = [];
  const keys = [...new Set([...baseEntries.keys(), ...targetEntries.keys()])].sort();

  for (const entryKey of keys) {
    const before = baseEntries.get(entryKey);
    const after = targetEntries.get(entryKey);
    if (before === undefined && after !== undefined) {
      operations.push({ kind: "added", entryKey, value: after.value } satisfies AddedSemanticEntry);
    } else if (before !== undefined && after === undefined) {
      operations.push({ kind: "removed", entryKey, before: before.value } satisfies RemovedSemanticEntry);
    } else if (
      before !== undefined &&
      after !== undefined &&
      canonicalizeJson(before.value) !== canonicalizeJson(after.value)
    ) {
      operations.push({
        kind: "modified",
        entryKey,
        before: before.value,
        after: after.value,
      } satisfies ModifiedSemanticEntry);
    }
  }
  return operations;
}

export const diffArchitectureCanon = diffArchitectureDocuments;
export const diffCanonicalDocuments = diffArchitectureDocuments;
export const diffCanon = diffArchitectureDocuments;

export interface DesignChangeAuthoringInput {
  readonly changeId: string;
  readonly base: CanonRevisionReference;
  readonly baseCanon: ArchitectureDocumentV1;
  readonly targetCanon: ArchitectureDocumentV1;
}

function payloadFor(input: DesignChangeAuthoringInput): DesignChangeSetPayload {
  if (input.base.canonVersion !== 1) throw new Error("base Canon version is incompatible");
  const baseDigest = architectureCanonDigest(input.baseCanon);
  if (input.base.canonDigest !== baseDigest) throw new Error("base Canon digest does not match the supplied Canon");
  const target = documentJson(input.targetCanon);
  if (target.canonVersion !== input.base.canonVersion) throw new Error("target Canon version is incompatible");
  if (target.documentId !== documentJson(input.baseCanon).documentId) {
    throw new Error("target Canon document identity does not match the base Canon");
  }
  return {
    contractVersion: 1,
    changeId: input.changeId,
    base: input.base,
    target: {
      canonVersion: 1,
      operations: diffArchitectureDocuments(input.baseCanon, input.targetCanon),
      targetCanonDigest: architectureCanonDigest(input.targetCanon),
    },
  };
}

/** Authors a deterministic Design Change Set from an explicit target Canon. */
export function createDesignChangeSet(input: DesignChangeAuthoringInput): DesignChangeSet {
  const payload = payloadFor(input);
  return Object.freeze({ ...payload, digest: digestJson(payload) });
}

export const authorDesignChange = createDesignChangeSet;
export const authorDesignChangeSet = createDesignChangeSet;
export const createDesignChange = createDesignChangeSet;
