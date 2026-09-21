import {
  createArchitectureDocument,
  CODE_INTENT_SCHEMA_VERSION,
  type ArchitectureDocumentInput,
  type ArchitectureDocumentV1,
  type GlobalIdentityNamespace,
} from "./document.js";
import { CANON_VERSION } from "./identity.js";
import { validateArchitectureDocument } from "./validate.js";

type JsonRecord = Record<string, unknown>;

const CANON_DOCUMENT_FIELDS = [
  "canonVersion",
  "documentId",
  "root",
  "elements",
  "interfaces",
  "relationships",
  "responsibilities",
  "authority",
  "boundaries",
  "constraints",
  "flows",
  "deployment",
  "repositoryMappings",
  "decisions",
  "views",
  "codeIntents",
  "globalIdentityRegistry",
] as const;

const REQUIRED_CANON_DOCUMENT_FIELDS = CANON_DOCUMENT_FIELDS.filter((field) => field !== "codeIntents");

const GLOBAL_IDENTITY_NAMESPACES: readonly GlobalIdentityNamespace[] = [
  "architecture",
  "element",
  "interface",
  "responsibility",
  "boundary",
  "flow",
  "decision",
  "reference",
  "code-intent",
];

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a JSON object`);
  }

  return value as JsonRecord;
}

function assertKnownFields(record: JsonRecord, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label} contains unknown field: ${key}`);
    }
  }
}

function readRecord(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): JsonRecord {
  const record = assertRecord(value, label);
  assertKnownFields(record, allowed, label);
  for (const key of required) {
    if (!Object.hasOwn(record, key) || record[key] === undefined) {
      throw new TypeError(`${label} is missing required field: ${key}`);
    }
  }
  return record;
}

function readRequiredString(record: JsonRecord, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new TypeError(`${label} ${field} must be a string`);
  }
  return value;
}

function readOptionalString(record: JsonRecord, field: string, label: string): string | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return readRequiredString(record, field, label);
}

function readRequiredNumber(record: JsonRecord, field: string, label: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} ${field} must be a finite number`);
  }
  return value;
}

function readOptionalNumber(record: JsonRecord, field: string, label: string): number | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return readRequiredNumber(record, field, label);
}

function readArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${label} must not contain sparse entries`);
    }
  }
  return value;
}

function readArrayField(record: JsonRecord, field: string, label: string): readonly unknown[] {
  return readArray(record[field], `${label} ${field}`);
}

function readKind(record: JsonRecord, expected: string, label: string): void {
  const kind = readRequiredString(record, "kind", label);
  if (kind !== expected) {
    throw new TypeError(`${label} kind must be ${expected}`);
  }
}

function readRoot(value: unknown): { readonly id: string } {
  const record = readRecord(value, "root", ["kind", "id"], ["kind", "id"]);
  readKind(record, "architecture", "root");
  return { id: readRequiredString(record, "id", "root") };
}

function readElement(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "element",
    ["id", "kind", "displayName", "technology", "tags", "properties", "parentId"],
    ["id", "kind"],
  );
  const displayName = readOptionalString(record, "displayName", "element");
  const technology = readOptionalString(record, "technology", "element");
  const tags = Object.hasOwn(record, "tags")
    ? readArray(record.tags, "element tags").map((tag) => {
        if (typeof tag !== "string") throw new TypeError("element tags must contain strings");
        return tag;
      })
    : undefined;
  const properties = Object.hasOwn(record, "properties")
    ? Object.fromEntries(
        Object.entries(assertRecord(record.properties, "element properties")).map(([key, propertyValue]) => {
          if (typeof propertyValue !== "string") throw new TypeError("element properties must contain string values");
          return [key, propertyValue];
        }),
      )
    : undefined;
  const parentId = readOptionalString(record, "parentId", "element");
  return {
    id: readRequiredString(record, "id", "element"),
    kind: readRequiredString(record, "kind", "element"),
    ...(displayName === undefined ? {} : { displayName }),
    ...(technology === undefined ? {} : { technology }),
    ...(tags === undefined ? {} : { tags }),
    ...(properties === undefined ? {} : { properties }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function readInterface(value: unknown): JsonRecord {
  const record = readRecord(value, "interface", ["id", "owner", "protocol", "technology"], ["id", "owner"]);
  const protocol = readOptionalString(record, "protocol", "interface");
  const technology = readOptionalString(record, "technology", "interface");
  return {
    id: readRequiredString(record, "id", "interface"),
    owner: readRequiredString(record, "owner", "interface"),
    ...(protocol === undefined ? {} : { protocol }),
    ...(technology === undefined ? {} : { technology }),
  };
}

function readRelationship(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "relationship",
    ["source", "target", "kind", "interfaceId"],
    ["source", "target", "kind"],
  );
  const interfaceId = readOptionalString(record, "interfaceId", "relationship");
  return {
    source: readRequiredString(record, "source", "relationship"),
    target: readRequiredString(record, "target", "relationship"),
    kind: readRequiredString(record, "kind", "relationship"),
    ...(interfaceId === undefined ? {} : { interfaceId }),
  };
}

function readResponsibilityTarget(value: unknown): JsonRecord {
  const record = readRecord(value, "responsibility target", ["kind", "id"], ["kind", "id"]);
  const kind = readRequiredString(record, "kind", "responsibility target");
  if (kind !== "architecture" && kind !== "object") {
    throw new TypeError("responsibility target kind is invalid");
  }
  return { kind, id: readRequiredString(record, "id", "responsibility target") };
}

function readResponsibility(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "responsibility",
    ["kind", "id", "target", "concern"],
    ["kind", "id", "target", "concern"],
  );
  readKind(record, "responsibility", "responsibility");
  return {
    id: readRequiredString(record, "id", "responsibility"),
    target: readResponsibilityTarget(record.target),
    concern: readRequiredString(record, "concern", "responsibility"),
  };
}

function readResponsibilities(value: unknown): JsonRecord {
  const record = readRecord(value, "responsibilities", ["responsibilities"], ["responsibilities"]);
  return {
    responsibilities: readArrayField(record, "responsibilities", "responsibilities").map(readResponsibility),
  };
}

function readAuthorityFact(value: unknown): JsonRecord {
  const record = readRecord(value, "authority fact", ["kind", "concern", "owner"], ["kind", "concern", "owner"]);
  readKind(record, "authority", "authority fact");
  return {
    concern: readRequiredString(record, "concern", "authority fact"),
    owner: readRequiredString(record, "owner", "authority fact"),
  };
}

function readOwnershipFact(value: unknown): JsonRecord {
  const record = readRecord(value, "ownership fact", ["kind", "resource", "owner"], ["kind", "resource", "owner"]);
  readKind(record, "ownership", "ownership fact");
  return {
    resource: readRequiredString(record, "resource", "ownership fact"),
    owner: readRequiredString(record, "owner", "ownership fact"),
  };
}

function readAuthority(value: unknown): JsonRecord {
  const record = readRecord(value, "authority/ownership facts", ["authority", "ownership"], ["authority", "ownership"]);
  return {
    authority: readArrayField(record, "authority", "authority/ownership facts").map(readAuthorityFact),
    ownership: readArrayField(record, "ownership", "authority/ownership facts").map(readOwnershipFact),
  };
}

function readBoundary(value: unknown): JsonRecord {
  const record = readRecord(value, "boundary", ["id", "kind", "memberIds"], ["id", "kind", "memberIds"]);
  return {
    id: readRequiredString(record, "id", "boundary"),
    kind: readRequiredString(record, "kind", "boundary"),
    memberIds: readArrayField(record, "memberIds", "boundary").map((memberId) => {
      if (typeof memberId !== "string") throw new TypeError("boundary memberIds must contain strings");
      return memberId;
    }),
  };
}

function readConstraint(value: unknown): JsonRecord {
  const initial = assertRecord(value, "constraint");
  const kind = readRequiredString(initial, "kind", "constraint");
  switch (kind) {
    case "must-go-through": {
      const record = readRecord(
        value,
        "constraint",
        ["kind", "source", "target", "through"],
        ["kind", "source", "target", "through"],
      );
      return {
        kind,
        source: readRequiredString(record, "source", "constraint"),
        target: readRequiredString(record, "target", "constraint"),
        through: readRequiredString(record, "through", "constraint"),
      };
    }
    case "single-authority": {
      const record = readRecord(value, "constraint", ["kind", "concern"], ["kind", "concern"]);
      return { kind, concern: readRequiredString(record, "concern", "constraint") };
    }
    case "may-depend-on":
    case "must-not-depend-on":
    case "may-call": {
      const record = readRecord(value, "constraint", ["kind", "source", "target"], ["kind", "source", "target"]);
      return {
        kind,
        source: readRequiredString(record, "source", "constraint"),
        target: readRequiredString(record, "target", "constraint"),
      };
    }
    default:
      readRecord(value, "constraint", ["kind"], ["kind"]);
      return { kind };
  }
}

function readFlowStep(value: unknown): JsonRecord {
  const record = readRecord(value, "flow step", ["relationshipId", "interfaceId", "operation", "information"], []);
  const relationshipId = readOptionalString(record, "relationshipId", "flow step");
  const interfaceId = readOptionalString(record, "interfaceId", "flow step");
  const operation = readOptionalString(record, "operation", "flow step");
  const information = readOptionalString(record, "information", "flow step");
  return {
    ...(relationshipId === undefined ? {} : { relationshipId }),
    ...(interfaceId === undefined ? {} : { interfaceId }),
    ...(operation === undefined ? {} : { operation }),
    ...(information === undefined ? {} : { information }),
  };
}

function readFlow(value: unknown): JsonRecord {
  const record = readRecord(value, "flow", ["id", "steps"], ["id", "steps"]);
  return {
    id: readRequiredString(record, "id", "flow"),
    steps: readArrayField(record, "steps", "flow").map(readFlowStep),
  };
}

function readDeploymentRecord(
  value: unknown,
  kind: string,
  fields: readonly string[],
  required: readonly string[],
): JsonRecord {
  const record = readRecord(value, kind, fields, required);
  readKind(record, kind, kind);
  const result: JsonRecord = {};
  for (const field of required) {
    if (field !== "kind") result[field] = readRequiredString(record, field, kind);
  }
  for (const field of fields) {
    if (field === "kind" || required.includes(field)) continue;
    const optional = readOptionalString(record, field, kind);
    if (optional !== undefined) result[field] = optional;
  }
  return result;
}

function readDeploymentMapping(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "deployment mapping",
    ["kind", "softwareElementId", "deploymentInstanceId"],
    ["kind", "softwareElementId", "deploymentInstanceId"],
  );
  readKind(record, "deployment-mapping", "deployment mapping");
  return {
    softwareElementId: readRequiredString(record, "softwareElementId", "deployment mapping"),
    deploymentInstanceId: readRequiredString(record, "deploymentInstanceId", "deployment mapping"),
  };
}

function readDeployment(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "deployment topology",
    ["runtimeEnvironments", "deploymentNodes", "deploymentInstances", "infrastructureReferences", "mappings"],
    ["runtimeEnvironments", "deploymentNodes", "deploymentInstances", "infrastructureReferences", "mappings"],
  );
  return {
    runtimeEnvironments: readArrayField(record, "runtimeEnvironments", "deployment topology").map((item) =>
      readDeploymentRecord(item, "runtime-environment", ["kind", "id", "displayName"], ["kind", "id"]),
    ),
    deploymentNodes: readArrayField(record, "deploymentNodes", "deployment topology").map((item) =>
      readDeploymentRecord(
        item,
        "deployment-node",
        ["kind", "id", "environmentId", "displayName"],
        ["kind", "id", "environmentId"],
      ),
    ),
    deploymentInstances: readArrayField(record, "deploymentInstances", "deployment topology").map((item) =>
      readDeploymentRecord(
        item,
        "deployment-instance",
        ["kind", "id", "nodeId", "displayName"],
        ["kind", "id", "nodeId"],
      ),
    ),
    infrastructureReferences: readArrayField(record, "infrastructureReferences", "deployment topology").map((item) =>
      readDeploymentRecord(item, "infrastructure-reference", ["kind", "id", "reference"], ["kind", "id", "reference"]),
    ),
    mappings: readArrayField(record, "mappings", "deployment topology").map(readDeploymentMapping),
  };
}

function readRepositoryPath(value: unknown): JsonRecord {
  const record = readRecord(value, "repository path mapping", ["path", "scope"], ["path", "scope"]);
  return {
    path: readRequiredString(record, "path", "repository path mapping"),
    scope: readRequiredString(record, "scope", "repository path mapping"),
  };
}

function readRepositorySymbol(value: unknown): JsonRecord {
  const record = readRecord(value, "repository symbol mapping", ["path", "symbol", "exportName"], ["path", "symbol"]);
  const exportName = readOptionalString(record, "exportName", "repository symbol mapping");
  return {
    path: readRequiredString(record, "path", "repository symbol mapping"),
    symbol: readRequiredString(record, "symbol", "repository symbol mapping"),
    ...(exportName === undefined ? {} : { exportName }),
  };
}

function readRepositoryTest(value: unknown): JsonRecord {
  const record = readRecord(value, "repository test mapping", ["path", "selector"], ["path", "selector"]);
  return {
    path: readRequiredString(record, "path", "repository test mapping"),
    selector: readRequiredString(record, "selector", "repository test mapping"),
  };
}

function readRepositoryMapping(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "repository mapping",
    ["canonId", "paths", "symbols", "tests"],
    ["canonId", "paths", "symbols", "tests"],
  );
  return {
    canonId: readRequiredString(record, "canonId", "repository mapping"),
    paths: readArrayField(record, "paths", "repository mapping").map(readRepositoryPath),
    symbols: readArrayField(record, "symbols", "repository mapping").map(readRepositorySymbol),
    tests: readArrayField(record, "tests", "repository mapping").map(readRepositoryTest),
  };
}

function readDecision(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "decision",
    ["id", "title", "status", "type", "rationale", "targetIds", "referenceIds", "supersedes"],
    ["id", "title", "status", "type", "rationale", "targetIds", "referenceIds", "supersedes"],
  );
  return {
    id: readRequiredString(record, "id", "decision"),
    title: readRequiredString(record, "title", "decision"),
    status: readRequiredString(record, "status", "decision"),
    type: readRequiredString(record, "type", "decision"),
    rationale: readRequiredString(record, "rationale", "decision"),
    targetIds: readArrayField(record, "targetIds", "decision").map((id) => {
      if (typeof id !== "string") throw new TypeError("decision targetIds must contain strings");
      return id;
    }),
    referenceIds: readArrayField(record, "referenceIds", "decision").map((id) => {
      if (typeof id !== "string") throw new TypeError("decision referenceIds must contain strings");
      return id;
    }),
    supersedes: readArrayField(record, "supersedes", "decision").map((id) => {
      if (typeof id !== "string") throw new TypeError("decision supersedes must contain strings");
      return id;
    }),
  };
}

function readReference(value: unknown): JsonRecord {
  const record = readRecord(value, "reference", ["id", "label", "uri", "description"], ["id", "label", "uri"]);
  const description = readOptionalString(record, "description", "reference");
  return {
    id: readRequiredString(record, "id", "reference"),
    label: readRequiredString(record, "label", "reference"),
    uri: readRequiredString(record, "uri", "reference"),
    ...(description === undefined ? {} : { description }),
  };
}

function readReferenceAttachment(value: unknown): JsonRecord {
  const record = readRecord(value, "reference attachment", ["targetId", "referenceIds"], ["targetId", "referenceIds"]);
  return {
    targetId: readRequiredString(record, "targetId", "reference attachment"),
    referenceIds: readArrayField(record, "referenceIds", "reference attachment").map((id) => {
      if (typeof id !== "string") throw new TypeError("reference attachment referenceIds must contain strings");
      return id;
    }),
  };
}

function readDecisions(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "architecture decisions",
    ["decisions", "references", "referenceAttachments"],
    ["decisions", "references", "referenceAttachments"],
  );
  return {
    decisions: readArrayField(record, "decisions", "architecture decisions").map(readDecision),
    references: readArrayField(record, "references", "architecture decisions").map(readReference),
    referenceAttachments: readArrayField(record, "referenceAttachments", "architecture decisions").map(
      readReferenceAttachment,
    ),
  };
}

function readCodeIntentStatement(value: unknown, label: string): JsonRecord {
  const record = readRecord(value, label, ["id", "text"], ["id", "text"]);
  return {
    id: readRequiredString(record, "id", label),
    text: readRequiredString(record, "text", label),
  };
}

function readCodeIntentObligation(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "code intent verification obligation",
    ["id", "statementId", "mode", "predicate"],
    ["id", "statementId", "mode", "predicate"],
  );
  return {
    id: readRequiredString(record, "id", "code intent verification obligation"),
    statementId: readRequiredString(record, "statementId", "code intent verification obligation"),
    mode: readRequiredString(record, "mode", "code intent verification obligation"),
    predicate: readRequiredString(record, "predicate", "code intent verification obligation"),
  };
}

function readCodeIntent(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "code intent",
    ["id", "ownerId", "responsibilityIds", "decisionIds", "invariants", "prohibitions", "verificationObligations"],
    ["id", "ownerId", "responsibilityIds", "decisionIds", "invariants", "prohibitions", "verificationObligations"],
  );
  return {
    id: readRequiredString(record, "id", "code intent"),
    ownerId: readRequiredString(record, "ownerId", "code intent"),
    responsibilityIds: readArrayField(record, "responsibilityIds", "code intent").map((id) => {
      if (typeof id !== "string") throw new TypeError("code intent responsibilityIds must contain strings");
      return id;
    }),
    decisionIds: readArrayField(record, "decisionIds", "code intent").map((id) => {
      if (typeof id !== "string") throw new TypeError("code intent decisionIds must contain strings");
      return id;
    }),
    invariants: readArrayField(record, "invariants", "code intent").map((statement, index) =>
      readCodeIntentStatement(statement, `code intent invariants[${index}]`),
    ),
    prohibitions: readArrayField(record, "prohibitions", "code intent").map((statement, index) =>
      readCodeIntentStatement(statement, `code intent prohibitions[${index}]`),
    ),
    verificationObligations: readArrayField(record, "verificationObligations", "code intent").map(
      readCodeIntentObligation,
    ),
  };
}

function readCodeIntents(value: unknown): JsonRecord {
  const record = readRecord(value, "code intents", ["schemaVersion", "entries"], ["schemaVersion", "entries"]);
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== CODE_INTENT_SCHEMA_VERSION) {
    throw new TypeError(`unsupported Code Intent schemaVersion: ${String(schemaVersion)}`);
  }
  return {
    schemaVersion: CODE_INTENT_SCHEMA_VERSION,
    entries: readArrayField(record, "entries", "code intents").map(readCodeIntent),
  };
}

function readViewReference(value: unknown): JsonRecord {
  const record = readRecord(value, "view reference", ["kind", "id"], ["kind", "id"]);
  return {
    kind: readRequiredString(record, "kind", "view reference"),
    id: readRequiredString(record, "id", "view reference"),
  };
}

function readViewScope(value: unknown): JsonRecord {
  const record = readRecord(value, "view scope", ["include", "exclude"], ["include", "exclude"]);
  return {
    include: readArrayField(record, "include", "view scope").map(readViewReference),
    exclude: readArrayField(record, "exclude", "view scope").map(readViewReference),
  };
}

function readPresentation(value: unknown): JsonRecord {
  const record = readRecord(value, "view presentation", ["layout", "direction", "grouping"], []);
  const layout = readOptionalString(record, "layout", "view presentation");
  const direction = readOptionalString(record, "direction", "view presentation");
  const grouping = readOptionalString(record, "grouping", "view presentation");
  return {
    ...(layout === undefined ? {} : { layout }),
    ...(direction === undefined ? {} : { direction }),
    ...(grouping === undefined ? {} : { grouping }),
  };
}

function readView(value: unknown): JsonRecord {
  const record = readRecord(
    value,
    "view",
    ["key", "kind", "scope", "root", "order", "title", "description", "presentation"],
    ["key", "kind", "scope"],
  );
  const root = Object.hasOwn(record, "root") ? readViewReference(record.root) : undefined;
  const order = readOptionalNumber(record, "order", "view");
  const title = readOptionalString(record, "title", "view");
  const description = readOptionalString(record, "description", "view");
  const presentation = Object.hasOwn(record, "presentation") ? readPresentation(record.presentation) : undefined;
  return {
    key: readRequiredString(record, "key", "view"),
    kind: readRequiredString(record, "kind", "view"),
    scope: readViewScope(record.scope),
    ...(root === undefined ? {} : { root }),
    ...(order === undefined ? {} : { order }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(presentation === undefined ? {} : { presentation }),
  };
}

function readRegistryEntry(value: unknown): JsonRecord {
  const record = readRecord(value, "global identity registry entry", ["id", "namespace"], ["id", "namespace"]);
  return {
    id: readRequiredString(record, "id", "global identity registry entry"),
    namespace: readRequiredString(record, "namespace", "global identity registry entry"),
  };
}

function readRegistry(value: unknown): readonly JsonRecord[] {
  const record = readRecord(value, "global identity registry", ["entries"], ["entries"]);
  return readArrayField(record, "entries", "global identity registry").map(readRegistryEntry);
}

function readDocumentInput(value: unknown): {
  readonly input: ArchitectureDocumentInput;
  readonly registry: readonly JsonRecord[];
} {
  const record = readRecord(value, "architecture document", CANON_DOCUMENT_FIELDS, REQUIRED_CANON_DOCUMENT_FIELDS);
  const version = record.canonVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new TypeError("architecture document canonVersion must be an integer");
  }
  if (version !== CANON_VERSION) {
    throw new TypeError(`unsupported architecture document canonVersion: ${String(version)}`);
  }

  return {
    input: {
      documentId: readRequiredString(record, "documentId", "architecture document"),
      root: readRoot(record.root),
      elements: readArrayField(record, "elements", "architecture document").map(readElement),
      interfaces: readArrayField(record, "interfaces", "architecture document").map(readInterface),
      relationships: readArrayField(record, "relationships", "architecture document").map(readRelationship),
      responsibilities: readResponsibilities(record.responsibilities),
      authority: readAuthority(record.authority),
      boundaries: readArrayField(record, "boundaries", "architecture document").map(readBoundary),
      constraints: readArrayField(record, "constraints", "architecture document").map(readConstraint),
      flows: readArrayField(record, "flows", "architecture document").map(readFlow),
      deployment: readDeployment(record.deployment),
      repositoryMappings: readArrayField(record, "repositoryMappings", "architecture document").map(
        readRepositoryMapping,
      ),
      decisions: readDecisions(record.decisions),
      views: readArrayField(record, "views", "architecture document").map(readView),
      ...(Object.hasOwn(record, "codeIntents") ? { codeIntents: readCodeIntents(record.codeIntents) } : {}),
    } as unknown as ArchitectureDocumentInput,
    registry: readRegistry(record.globalIdentityRegistry),
  };
}

function readRegistryNamespace(value: string): GlobalIdentityNamespace {
  if (!GLOBAL_IDENTITY_NAMESPACES.includes(value as GlobalIdentityNamespace)) {
    throw new TypeError(`global identity registry namespace is unsupported: ${value}`);
  }
  return value as GlobalIdentityNamespace;
}

function assertRegistryMatches(document: ArchitectureDocumentV1, suppliedEntries: readonly JsonRecord[]): void {
  const actual = suppliedEntries
    .map((entry) => ({
      id: readRequiredString(entry, "id", "global identity registry entry"),
      namespace: readRegistryNamespace(readRequiredString(entry, "namespace", "global identity registry entry")),
    }))
    .sort((left, right) => compareStrings(left.id, right.id) || compareStrings(left.namespace, right.namespace));
  const expected = [...document.globalIdentityRegistry.entries].sort(
    (left, right) => compareStrings(left.id, right.id) || compareStrings(left.namespace, right.namespace),
  );

  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry.id !== expected[index]?.id || entry.namespace !== expected[index]?.namespace)
  ) {
    throw new Error("global identity registry does not match the canonical document sections");
  }
}

function assertValidDocument(document: ArchitectureDocumentV1): void {
  const result = validateArchitectureDocument(document);
  if (!result.valid) {
    const diagnostics = result.diagnostics.map(({ path, message }) => `${path}: ${message}`).join("; ");
    throw new Error(`architecture document failed validation: ${diagnostics}`);
  }
}

/** Decode a strict canonical JSON-compatible Architecture Canon v1 value. */
export function decodeArchitectureDocument(value: unknown): ArchitectureDocumentV1 {
  const { input, registry } = readDocumentInput(value);
  const document = createArchitectureDocument(input);
  const suppliedRegistry = {
    ...document,
    globalIdentityRegistry: {
      entries: registry,
    },
  } as unknown as ArchitectureDocumentV1;

  assertValidDocument(suppliedRegistry);
  assertRegistryMatches(document, registry);
  return document;
}

/** Serialize a validated Architecture Canon v1 document deterministically. */
export function serializeCanonicalArchitectureDocument(document: ArchitectureDocumentV1): string {
  return JSON.stringify(decodeArchitectureDocument(document));
}

/** Parse canonical JSON text and decode it through the same strict boundary. */
export function parseCanonicalArchitectureDocument(source: string): ArchitectureDocumentV1 {
  if (typeof source !== "string") {
    throw new TypeError("canonical architecture document JSON must be a string");
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new SyntaxError(`invalid canonical architecture document JSON: ${String(error)}`);
  }
  return decodeArchitectureDocument(value);
}

export const encodeCanonicalJson = serializeCanonicalArchitectureDocument;
export const serializeCanonicalJson = serializeCanonicalArchitectureDocument;
export const decodeCanonicalJson = parseCanonicalArchitectureDocument;
