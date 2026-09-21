import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import type { JsonObject, JsonValue } from "../digest.js";
import { createRelationshipEntryKey, createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";

/** The Canon section represented by one semantic change operation. */
export type EntryGroup =
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

export interface SemanticEntry {
  readonly entryKey: SemanticEntryKey;
  readonly group: EntryGroup;
  readonly value: JsonValue;
}

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

/**
 * Derive the one canonical identity for every Canon entry.  Both semantic
 * diff and Design Change apply consume this function; neither may reconstruct
 * collection keys independently.
 */
export function deriveSemanticEntries(document: ArchitectureDocumentV1): readonly SemanticEntry[] {
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
    entries.push(
      entry(
        "authority",
        key("authority", "authority", text(record.concern, "authority concern"), text(record.owner, "authority owner")),
        value,
      ),
    );
  }
  for (const value of json.authority.ownership) {
    const record = asRecord(value, "ownership fact");
    entries.push(
      entry(
        "ownership",
        key(
          "authority",
          "ownership",
          text(record.resource, "ownership resource"),
          text(record.owner, "ownership owner"),
        ),
        value,
      ),
    );
  }
  for (const value of json.boundaries) {
    const record = asRecord(value, "boundary");
    entries.push(entry("boundaries", key("boundary", text(record.id, "boundary id")), value));
  }
  for (const value of json.constraints) {
    const record = asRecord(value, "constraint");
    const kind = text(record.kind, "constraint kind");
    if (kind === "single-authority") {
      entries.push(entry("constraints", key("constraint", kind, text(record.concern, "constraint concern")), value));
    } else if (kind === "must-go-through") {
      entries.push(
        entry(
          "constraints",
          key(
            "constraint",
            kind,
            text(record.source, "constraint source"),
            text(record.target, "constraint target"),
            text(record.through, "constraint through"),
          ),
          value,
        ),
      );
    } else {
      entries.push(
        entry(
          "constraints",
          key("constraint", kind, text(record.source, "constraint source"), text(record.target, "constraint target")),
          value,
        ),
      );
    }
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
          "deployment-mapping",
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
