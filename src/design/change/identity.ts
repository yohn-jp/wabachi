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
  | "views"
  | "codeIntents";

export interface SemanticEntry {
  readonly entryKey: SemanticEntryKey;
  readonly group: EntryGroup;
  readonly value: JsonValue;
}

interface CanonJson {
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
  readonly codeIntents?: { readonly entries: readonly JsonValue[] };
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

/** Derive the canonical key for one already-normalized Canon entry. */
export function deriveSemanticEntryKey(group: EntryGroup, value: JsonValue): SemanticEntryKey {
  const record = asRecord(value, `${group} entry`);
  switch (group) {
    case "architecture":
      return key("architecture", text(record.id, "Canon root id"));
    case "elements":
      return key("element", text(record.id, "element id"));
    case "interfaces":
      return key("interface", text(record.id, "interface id"));
    case "relationships": {
      const interfaceId =
        record.interfaceId === undefined ? undefined : text(record.interfaceId, "relationship interfaceId");
      return createRelationshipEntryKey({
        source: text(record.source, "relationship source"),
        target: text(record.target, "relationship target"),
        kind: text(record.kind, "relationship kind") as never,
        ...(interfaceId === undefined ? {} : { interfaceId }),
      });
    }
    case "responsibilities":
      return key("responsibility", text(record.id, "responsibility id"));
    case "authority":
      return key(
        "authority",
        "authority",
        text(record.concern, "authority concern"),
        text(record.owner, "authority owner"),
      );
    case "ownership":
      return key(
        "authority",
        "ownership",
        text(record.resource, "ownership resource"),
        text(record.owner, "ownership owner"),
      );
    case "boundaries":
      return key("boundary", text(record.id, "boundary id"));
    case "constraints": {
      const kind = text(record.kind, "constraint kind");
      if (kind === "single-authority") return key("constraint", kind, text(record.concern, "constraint concern"));
      if (kind === "must-go-through") {
        return key(
          "constraint",
          kind,
          text(record.source, "constraint source"),
          text(record.target, "constraint target"),
          text(record.through, "constraint through"),
        );
      }
      return key(
        "constraint",
        kind,
        text(record.source, "constraint source"),
        text(record.target, "constraint target"),
      );
    }
    case "flows":
      return key("flow", text(record.id, "flow id"));
    case "runtimeEnvironments":
      return key("deployment", "runtime-environment", text(record.id, "runtime environment id"));
    case "deploymentNodes":
      return key("deployment", "deployment-node", text(record.id, "deployment node id"));
    case "deploymentInstances":
      return key("deployment", "deployment-instance", text(record.id, "deployment instance id"));
    case "infrastructureReferences":
      return key("deployment", "infrastructure-reference", text(record.id, "infrastructure reference id"));
    case "deploymentMappings":
      return key(
        "deployment",
        "deployment-mapping",
        text(record.softwareElementId, "deployment mapping softwareElementId"),
        text(record.deploymentInstanceId, "deployment mapping deploymentInstanceId"),
      );
    case "repositoryMappings":
      return key("repository-mapping", text(record.canonId, "repository mapping canonId"));
    case "decisions":
      return key("decision", "decision", text(record.id, "decision id"));
    case "decisionReferences":
      return key("decision", "reference", text(record.id, "decision reference id"));
    case "referenceAttachments":
      return key("decision", "reference-attachment", text(record.targetId, "reference attachment targetId"));
    case "views":
      return key("view", text(record.key, "view key"));
    case "codeIntents":
      return key("code-intent", text(record.id, "code intent id"));
  }
}

function entry(group: EntryGroup, value: JsonValue): SemanticEntry {
  return { group, entryKey: deriveSemanticEntryKey(group, value), value };
}

/**
 * Derive the one canonical identity for every Canon entry. Both semantic diff
 * and Design Change apply consume this function; neither may reconstruct
 * collection keys independently.
 */
export function deriveSemanticEntries(document: ArchitectureDocumentV1): readonly SemanticEntry[] {
  const json = JSON.parse(serializeCanonicalArchitectureDocument(document)) as CanonJson;
  const entries: SemanticEntry[] = [entry("architecture", json.root)];
  const append = (group: EntryGroup, values: readonly JsonValue[]): void => {
    for (const value of values) entries.push(entry(group, value));
  };

  append("elements", json.elements);
  append("interfaces", json.interfaces);
  append("relationships", json.relationships);
  append("responsibilities", json.responsibilities.responsibilities);
  append("authority", json.authority.authority);
  append("ownership", json.authority.ownership);
  append("boundaries", json.boundaries);
  append("constraints", json.constraints);
  append("flows", json.flows);
  append("runtimeEnvironments", json.deployment.runtimeEnvironments);
  append("deploymentNodes", json.deployment.deploymentNodes);
  append("deploymentInstances", json.deployment.deploymentInstances);
  append("infrastructureReferences", json.deployment.infrastructureReferences);
  append("deploymentMappings", json.deployment.mappings);
  append("repositoryMappings", json.repositoryMappings);
  append("decisions", json.decisions.decisions);
  append("decisionReferences", json.decisions.references);
  append("referenceAttachments", json.decisions.referenceAttachments);
  append("views", json.views);
  append("codeIntents", json.codeIntents?.entries ?? []);
  return entries;
}
