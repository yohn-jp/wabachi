import {
  createArchitectureDocument,
  type ArchitectureDocumentInput,
  type ArchitectureDocumentV1,
} from "../../architecture/canon/document.js";
import { validateArchitectureDocument } from "../../architecture/canon/validate.js";
import {
  createSemanticEntryKey,
  SEMANTIC_ENTRY_COLLECTIONS,
  type SemanticEntryCollection,
  type SemanticEntryKey,
} from "../entry-key.js";
import { digestJson, type Digest, type JsonValue } from "../digest.js";
import type { DesignChangeOperation, DesignChangeSetPayload } from "../contracts.js";

type MutableRecord = Record<string, unknown>;

interface ParsedEntryKey {
  readonly collection: SemanticEntryCollection;
  readonly identity: readonly string[];
  readonly encoded: string;
}

interface WorkingCanon {
  documentId: unknown;
  root: unknown;
  elements: unknown[];
  interfaces: unknown[];
  relationships: unknown[];
  responsibilities: { responsibilities: unknown[] };
  authority: { authority: unknown[]; ownership: unknown[] };
  boundaries: unknown[];
  constraints: unknown[];
  flows: unknown[];
  deployment: {
    runtimeEnvironments: unknown[];
    deploymentNodes: unknown[];
    deploymentInstances: unknown[];
    infrastructureReferences: unknown[];
    mappings: unknown[];
  };
  repositoryMappings: unknown[];
  decisions: {
    decisions: unknown[];
    references: unknown[];
    referenceAttachments: unknown[];
  };
  views: unknown[];
}

interface EntrySlot {
  readonly token: string;
  readonly category: string;
  readonly value: unknown;
  replace(value: unknown): void;
  remove(): void;
}

interface CurrentEntry {
  readonly slot: EntrySlot;
  readonly aliases: readonly string[];
}

interface PreparedOperation {
  readonly operation: DesignChangeOperation;
  readonly target?: CurrentEntry;
  readonly addition?: EntrySlot;
}

const COLLECTIONS = new Set<string>(SEMANTIC_ENTRY_COLLECTIONS);

function fail(message: string): never {
  throw new Error("cannot apply Design Change: " + message);
}

function asRecord(value: unknown, label: string): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(label + " must be an object");
  }
  return value as MutableRecord;
}

function stringProperty(record: MutableRecord, property: string): string | undefined {
  const value = record[property];
  return typeof value === "string" ? value : undefined;
}

function keyFor(collection: SemanticEntryCollection, identity: readonly string[]): string {
  return createSemanticEntryKey({ collection, identity });
}

function parseEntryKey(entryKey: SemanticEntryKey): ParsedEntryKey {
  if (typeof entryKey !== "string") fail("entry key must be a string");

  let parsed: unknown;
  try {
    parsed = JSON.parse(entryKey);
  } catch {
    fail("entry key must be a canonical JSON tuple");
  }

  if (!Array.isArray(parsed) || parsed.length < 2 || typeof parsed[0] !== "string") {
    fail("entry key must contain a collection and identity tuple");
  }
  const collection = parsed[0];
  const identity = parsed.slice(1);
  if (!COLLECTIONS.has(collection) || identity.some((part) => typeof part !== "string")) {
    fail("entry key contains an unsupported collection or malformed identity");
  }

  let canonical: string;
  try {
    canonical = keyFor(collection as SemanticEntryCollection, identity as string[]);
  } catch {
    fail("entry key contains a malformed identity");
  }
  if (canonical !== entryKey) fail("entry key is not canonically encoded");

  return {
    collection: collection as SemanticEntryCollection,
    identity: identity as string[],
    encoded: entryKey,
  };
}

function keyAliases(collection: SemanticEntryCollection, value: unknown): readonly string[] {
  const record = asRecord(value, collection + " entry");
  const aliases: string[][] = [];
  const add = (identity: readonly string[]): void => {
    try {
      const encoded = keyFor(collection, identity);
      if (!aliases.some((candidate) => keyFor(collection, candidate) === encoded)) aliases.push([...identity]);
    } catch {
      // Invalid values are rejected by the composer; they cannot identify an entry during preflight.
    }
  };

  switch (collection) {
    case "architecture": {
      const id = stringProperty(record, "id");
      if (id !== undefined) add([id]);
      break;
    }
    case "element":
    case "interface":
    case "responsibility":
    case "boundary":
    case "flow":
    case "repository-mapping": {
      const id = collection === "repository-mapping" ? stringProperty(record, "canonId") : stringProperty(record, "id");
      if (id !== undefined) add([id]);
      break;
    }
    case "relationship": {
      const source = stringProperty(record, "source");
      const target = stringProperty(record, "target");
      const kind = stringProperty(record, "kind");
      if (source !== undefined && target !== undefined && kind !== undefined) {
        const identity = [source, target, kind];
        const interfaceId = stringProperty(record, "interfaceId");
        if (interfaceId !== undefined) identity.push(interfaceId);
        add(identity);
      }
      break;
    }
    case "authority": {
      const kind = stringProperty(record, "kind");
      const owner = stringProperty(record, "owner");
      const target = stringProperty(record, "concern") ?? stringProperty(record, "resource");
      if (kind !== undefined && target !== undefined && owner !== undefined) {
        add([target, owner]);
        add([kind, target, owner]);
      }
      break;
    }
    case "constraint": {
      const kind = stringProperty(record, "kind");
      if (kind === "single-authority") {
        const concern = stringProperty(record, "concern");
        if (concern !== undefined) add([kind, concern]);
      } else if (kind === "must-go-through") {
        const source = stringProperty(record, "source");
        const target = stringProperty(record, "target");
        const through = stringProperty(record, "through");
        if (source !== undefined && target !== undefined && through !== undefined) add([kind, source, target, through]);
      } else if (kind !== undefined) {
        const source = stringProperty(record, "source");
        const target = stringProperty(record, "target");
        if (source !== undefined && target !== undefined) add([kind, source, target]);
      }
      break;
    }
    case "deployment": {
      const kind = stringProperty(record, "kind");
      if (kind === "deployment-mapping") {
        const softwareElementId = stringProperty(record, "softwareElementId");
        const deploymentInstanceId = stringProperty(record, "deploymentInstanceId");
        if (softwareElementId !== undefined && deploymentInstanceId !== undefined) {
          add([softwareElementId, deploymentInstanceId]);
          add([kind, softwareElementId, deploymentInstanceId]);
        }
      } else {
        const id = stringProperty(record, "id");
        if (kind !== undefined && id !== undefined) {
          add([id]);
          add([kind, id]);
        }
      }
      break;
    }
    case "decision": {
      const id = stringProperty(record, "id");
      if (id !== undefined) {
        add([id]);
        add(["decision", id]);
        add(["reference", id]);
      }
      const targetId = stringProperty(record, "targetId");
      if (targetId !== undefined && Array.isArray(record.referenceIds)) {
        add([targetId]);
        add(["reference-attachment", targetId]);
      }
      break;
    }
    case "view": {
      const key = stringProperty(record, "key");
      if (key !== undefined) add([key]);
      break;
    }
    case "code-intent":
      break;
  }

  return aliases.map((identity) => keyFor(collection, identity));
}

function categoryFor(collection: SemanticEntryCollection, value: unknown): string {
  const record = asRecord(value, collection + " entry");
  switch (collection) {
    case "authority": {
      const kind = stringProperty(record, "kind");
      if (kind === "authority" || kind === "ownership") return kind;
      break;
    }
    case "deployment": {
      const kind = stringProperty(record, "kind");
      if (
        kind === "runtime-environment" ||
        kind === "deployment-node" ||
        kind === "deployment-instance" ||
        kind === "infrastructure-reference" ||
        kind === "deployment-mapping"
      ) {
        return kind;
      }
      break;
    }
    case "decision":
      if (stringProperty(record, "title") !== undefined) return "decision";
      if (stringProperty(record, "label") !== undefined) return "reference";
      if (stringProperty(record, "targetId") !== undefined) return "reference-attachment";
      break;
    default:
      return collection;
  }
  fail(collection + " entry has an unsupported shape");
}

function createArraySlot(token: string, category: string, values: unknown[], value: unknown): EntrySlot {
  return {
    token,
    category,
    value,
    replace(next: unknown): void {
      const index = values.indexOf(value);
      if (index < 0) fail(category + " entry disappeared during preflight");
      values[index] = next;
    },
    remove(): void {
      const index = values.indexOf(value);
      if (index < 0) fail(category + " entry disappeared during preflight");
      values.splice(index, 1);
    },
  };
}

function createAppendSlot(token: string, category: string, values: unknown[]): EntrySlot {
  return {
    token,
    category,
    value: undefined,
    replace(next: unknown): void {
      values.push(next);
    },
    remove(): void {
      fail(category + " addition cannot be removed during preflight");
    },
  };
}

function addCurrentEntries(
  entries: CurrentEntry[],
  collection: SemanticEntryCollection,
  values: unknown[],
  category: (value: unknown) => string = () => collection,
  path: string = collection,
): void {
  for (const value of values) {
    const slot = createArraySlot(path + ":" + entries.length, category(value), values, value);
    entries.push({ slot, aliases: keyAliases(collection, value) });
  }
}

function workingCanon(base: ArchitectureDocumentV1): WorkingCanon {
  return {
    documentId: base.documentId,
    root: base.root,
    elements: [...base.elements],
    interfaces: [...base.interfaces],
    relationships: [...base.relationships],
    responsibilities: { responsibilities: [...base.responsibilities.responsibilities] },
    authority: {
      authority: [...base.authority.authority],
      ownership: [...base.authority.ownership],
    },
    boundaries: [...base.boundaries],
    constraints: [...base.constraints],
    flows: [...base.flows],
    deployment: {
      runtimeEnvironments: [...base.deployment.runtimeEnvironments],
      deploymentNodes: [...base.deployment.deploymentNodes],
      deploymentInstances: [...base.deployment.deploymentInstances],
      infrastructureReferences: [...base.deployment.infrastructureReferences],
      mappings: [...base.deployment.mappings],
    },
    repositoryMappings: [...base.repositoryMappings],
    decisions: {
      decisions: [...base.decisions.decisions],
      references: [...base.decisions.references],
      referenceAttachments: [...base.decisions.referenceAttachments],
    },
    views: [...base.views],
  };
}

function currentEntries(working: WorkingCanon): CurrentEntry[] {
  const entries: CurrentEntry[] = [];
  const rootSlot: EntrySlot = {
    token: "architecture:root",
    category: "architecture",
    value: working.root,
    replace(value: unknown): void {
      working.root = value;
    },
    remove(): void {
      fail("the architecture root cannot be removed");
    },
  };
  entries.push({ slot: rootSlot, aliases: keyAliases("architecture", working.root) });

  addCurrentEntries(entries, "element", working.elements);
  addCurrentEntries(entries, "interface", working.interfaces);
  addCurrentEntries(entries, "relationship", working.relationships);
  addCurrentEntries(entries, "responsibility", working.responsibilities.responsibilities);
  addCurrentEntries(entries, "authority", working.authority.authority, () => "authority", "authority:authority");
  addCurrentEntries(entries, "authority", working.authority.ownership, () => "ownership", "authority:ownership");
  addCurrentEntries(entries, "boundary", working.boundaries);
  addCurrentEntries(entries, "constraint", working.constraints);
  addCurrentEntries(entries, "flow", working.flows);
  addCurrentEntries(
    entries,
    "deployment",
    working.deployment.runtimeEnvironments,
    (value) => categoryFor("deployment", value),
    "deployment:runtime-environments",
  );
  addCurrentEntries(
    entries,
    "deployment",
    working.deployment.deploymentNodes,
    (value) => categoryFor("deployment", value),
    "deployment:deployment-nodes",
  );
  addCurrentEntries(
    entries,
    "deployment",
    working.deployment.deploymentInstances,
    (value) => categoryFor("deployment", value),
    "deployment:deployment-instances",
  );
  addCurrentEntries(
    entries,
    "deployment",
    working.deployment.infrastructureReferences,
    (value) => categoryFor("deployment", value),
    "deployment:infrastructure-references",
  );
  addCurrentEntries(
    entries,
    "deployment",
    working.deployment.mappings,
    (value) => categoryFor("deployment", value),
    "deployment:mappings",
  );
  addCurrentEntries(entries, "repository-mapping", working.repositoryMappings);
  addCurrentEntries(
    entries,
    "decision",
    working.decisions.decisions,
    (value) => categoryFor("decision", value),
    "decision:decisions",
  );
  addCurrentEntries(
    entries,
    "decision",
    working.decisions.references,
    (value) => categoryFor("decision", value),
    "decision:references",
  );
  addCurrentEntries(
    entries,
    "decision",
    working.decisions.referenceAttachments,
    (value) => categoryFor("decision", value),
    "decision:reference-attachments",
  );
  addCurrentEntries(entries, "view", working.views);
  return entries;
}

function appendTarget(working: WorkingCanon, key: ParsedEntryKey, value: unknown): EntrySlot {
  const category = categoryFor(key.collection, value);
  switch (key.collection) {
    case "element":
      return createAppendSlot("element:add", category, working.elements);
    case "interface":
      return createAppendSlot("interface:add", category, working.interfaces);
    case "relationship":
      return createAppendSlot("relationship:add", category, working.relationships);
    case "responsibility":
      return createAppendSlot("responsibility:add", category, working.responsibilities.responsibilities);
    case "authority":
      return createAppendSlot(
        "authority:" + category + ":add",
        category,
        category === "authority" ? working.authority.authority : working.authority.ownership,
      );
    case "boundary":
      return createAppendSlot("boundary:add", category, working.boundaries);
    case "constraint":
      return createAppendSlot("constraint:add", category, working.constraints);
    case "flow":
      return createAppendSlot("flow:add", category, working.flows);
    case "deployment":
      if (category === "runtime-environment") {
        return createAppendSlot("deployment:runtime-environment:add", category, working.deployment.runtimeEnvironments);
      }
      if (category === "deployment-node") {
        return createAppendSlot("deployment:node:add", category, working.deployment.deploymentNodes);
      }
      if (category === "deployment-instance") {
        return createAppendSlot("deployment:instance:add", category, working.deployment.deploymentInstances);
      }
      if (category === "infrastructure-reference") {
        return createAppendSlot(
          "deployment:infrastructure-reference:add",
          category,
          working.deployment.infrastructureReferences,
        );
      }
      return createAppendSlot("deployment:mapping:add", category, working.deployment.mappings);
    case "repository-mapping":
      return createAppendSlot("repository-mapping:add", category, working.repositoryMappings);
    case "decision":
      if (category === "decision") return createAppendSlot("decision:add", category, working.decisions.decisions);
      if (category === "reference") return createAppendSlot("reference:add", category, working.decisions.references);
      return createAppendSlot("reference-attachment:add", category, working.decisions.referenceAttachments);
    case "view":
      return createAppendSlot("view:add", category, working.views);
    case "architecture":
      fail("the architecture root cannot be added");
    case "code-intent":
      fail("code-intent entries are not part of ArchitectureDocumentV1");
  }
}

function findCurrent(entries: readonly CurrentEntry[], encoded: string): readonly CurrentEntry[] {
  return entries.filter((entry) => entry.aliases.includes(encoded));
}

function assertIdentity(key: ParsedEntryKey, value: unknown, label: string): string {
  if (!keyAliases(key.collection, value).includes(key.encoded)) {
    fail(label + " changes the identity of " + key.encoded);
  }
  return categoryFor(key.collection, value);
}

function assertBeforeDigest(current: unknown, before: JsonValue, key: string): void {
  let expected: Digest;
  try {
    expected = digestJson(before);
  } catch {
    fail("before value for " + key + " is not valid JSON");
  }
  if (digestJson(current) !== expected) fail("before digest mismatch for " + key);
}

function prepareOperations(working: WorkingCanon, operations: readonly DesignChangeOperation[]): PreparedOperation[] {
  if (!Array.isArray(operations)) fail("target operations must be an array");
  const entries = currentEntries(working);
  const seenKeys = new Set<string>();
  const seenSlots = new Set<string>();
  const prepared: PreparedOperation[] = [];

  for (const operation of operations) {
    if (operation === null || typeof operation !== "object") fail("operation must be an object");
    const key = parseEntryKey(operation.entryKey);
    if (key.collection === "code-intent") fail("code-intent entries are not part of ArchitectureDocumentV1");
    if (seenKeys.has(key.encoded)) fail("duplicate operation target " + key.encoded);
    seenKeys.add(key.encoded);

    if (operation.kind === "added") {
      const occupied = findCurrent(entries, key.encoded);
      if (occupied.length > 0) fail("added target is already occupied: " + key.encoded);
      assertIdentity(key, operation.value, "added entry");
      const addition = appendTarget(working, key, operation.value);
      prepared.push({ operation, addition });
      continue;
    }

    const matches = findCurrent(entries, key.encoded);
    if (matches.length === 0) fail("operation target is missing: " + key.encoded);
    if (matches.length > 1) fail("operation target is ambiguous: " + key.encoded);
    const target = matches[0];
    if (seenSlots.has(target.slot.token)) fail("duplicate operation target " + key.encoded);
    seenSlots.add(target.slot.token);

    if (operation.kind === "removed") {
      assertBeforeDigest(target.slot.value, operation.before, key.encoded);
      assertIdentity(key, operation.before, "removed entry");
      if (target.slot.category === "architecture") fail("the architecture root cannot be removed");
      prepared.push({ operation, target });
      continue;
    }

    assertBeforeDigest(target.slot.value, operation.before, key.encoded);
    assertIdentity(key, operation.before, "modified entry");
    const afterCategory = assertIdentity(key, operation.after, "modified entry");
    if (afterCategory !== target.slot.category) {
      fail("modified entry changes the identity kind of " + key.encoded);
    }
    prepared.push({ operation, target });
  }

  return prepared;
}

function composeProposedCanon(working: WorkingCanon): ArchitectureDocumentV1 {
  let composed: ArchitectureDocumentV1;
  try {
    composed = createArchitectureDocument({
      documentId: working.documentId,
      root: working.root,
      elements: working.elements,
      interfaces: working.interfaces,
      relationships: working.relationships,
      responsibilities: working.responsibilities,
      authority: working.authority,
      boundaries: working.boundaries,
      constraints: working.constraints,
      flows: working.flows,
      deployment: working.deployment,
      repositoryMappings: working.repositoryMappings,
      decisions: working.decisions,
      views: working.views,
    } as ArchitectureDocumentInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail("proposed Canon could not be composed: " + message);
  }

  const validation = validateArchitectureDocument(composed);
  if (!validation.valid) {
    fail(
      "proposed Canon is invalid: " +
        validation.diagnostics.map((diagnostic) => diagnostic.code + " at " + diagnostic.path).join(", "),
    );
  }
  return composed;
}

function applyPreparedOperations(prepared: readonly PreparedOperation[]): void {
  for (const { operation, target, addition } of prepared) {
    if (operation.kind === "added") {
      addition?.replace(operation.value);
    } else if (operation.kind === "modified") {
      target?.slot.replace(operation.after);
    } else {
      target?.slot.remove();
    }
  }
}

/**
 * Preflights and applies a Design Change against one exact Canon revision.
 * The returned document is newly composed and the supplied base is never mutated.
 */
export function applyDesignChange(
  change: DesignChangeSetPayload,
  base: ArchitectureDocumentV1,
): ArchitectureDocumentV1 {
  if (change === null || typeof change !== "object") fail("change must be an object");
  if (change.base.canonVersion !== base.canonVersion) fail("base Canon version mismatch");
  if (change.target.canonVersion !== base.canonVersion) fail("target Canon version mismatch");

  const actualBaseDigest = digestJson(base);
  if (actualBaseDigest !== change.base.canonDigest) fail("base Canon digest mismatch");

  const working = workingCanon(base);
  const prepared = prepareOperations(working, change.target.operations);
  applyPreparedOperations(prepared);

  const proposed = composeProposedCanon(working);
  const actualTargetDigest = digestJson(proposed);
  if (actualTargetDigest !== change.target.targetCanonDigest) fail("target Canon digest mismatch");
  return proposed;
}

/** Alias matching the DesignChangePort operation vocabulary. */
export const apply = applyDesignChange;
