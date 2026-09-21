import {
  createArchitectureDocument,
  type ArchitectureDocumentInput,
  type ArchitectureDocumentV1,
} from "../../architecture/canon/document.js";
import { decodeArchitectureDocument, serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import { validateArchitectureDocument } from "../../architecture/canon/validate.js";
import type { CodeIntent } from "../../architecture/canon/code-intent-contract.js";
import type { CanonVersion } from "../../architecture/canon/identity.js";
import type { JsonValue } from "../digest.js";
import { SEMANTIC_ENTRY_COLLECTIONS, type SemanticEntryCollection } from "../entry-key.js";

/** The semantic collections that may participate in a Design Change delta. */
export const CANON_DELTA_COLLECTIONS = Object.freeze([...SEMANTIC_ENTRY_COLLECTIONS]);

export type CanonDeltaCollection = SemanticEntryCollection;

/**
 * A lossless, collection-oriented Canon view. The identity registry is
 * intentionally absent: it is derived by the Canon factory when the view is
 * recomposed and is never a Design Change collection.
 */
export type CanonCollectionSet = Readonly<{
  readonly canonVersion: CanonVersion;
  readonly documentId: string;
  readonly architecture: readonly JsonValue[];
  readonly element: readonly JsonValue[];
  readonly interface: readonly JsonValue[];
  readonly relationship: readonly JsonValue[];
  readonly responsibility: readonly JsonValue[];
  readonly authority: readonly JsonValue[];
  readonly boundary: readonly JsonValue[];
  readonly constraint: readonly JsonValue[];
  readonly flow: readonly JsonValue[];
  readonly deployment: readonly JsonValue[];
  readonly "repository-mapping": readonly JsonValue[];
  readonly decision: readonly JsonValue[];
  readonly view: readonly JsonValue[];
  readonly "code-intent": readonly JsonValue[];
  /** Preserve the distinction between an absent and an explicitly empty section. */
  readonly codeIntentsPresent: boolean;
}>;

interface CanonJsonDocument {
  readonly canonVersion: CanonVersion;
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
  readonly codeIntents?: { readonly schemaVersion: 1; readonly entries: readonly JsonValue[] };
}

function freezeEntries(entries: readonly JsonValue[]): readonly JsonValue[] {
  return Object.freeze([...entries]);
}

function jsonDocument(document: ArchitectureDocumentV1): CanonJsonDocument {
  return JSON.parse(serializeCanonicalArchitectureDocument(document)) as CanonJsonDocument;
}

/** Split a validated Architecture Canon into the fixed semantic collection set. */
export function splitCanon(document: ArchitectureDocumentV1): CanonCollectionSet {
  const json = jsonDocument(document);
  const codeIntents = json.codeIntents?.entries ?? [];
  return Object.freeze({
    canonVersion: json.canonVersion,
    documentId: json.documentId,
    architecture: freezeEntries([json.root]),
    element: freezeEntries(json.elements),
    interface: freezeEntries(json.interfaces),
    relationship: freezeEntries(json.relationships),
    responsibility: freezeEntries(json.responsibilities.responsibilities),
    authority: freezeEntries([...json.authority.authority, ...json.authority.ownership]),
    boundary: freezeEntries(json.boundaries),
    constraint: freezeEntries(json.constraints),
    flow: freezeEntries(json.flows),
    deployment: freezeEntries([
      ...json.deployment.runtimeEnvironments,
      ...json.deployment.deploymentNodes,
      ...json.deployment.deploymentInstances,
      ...json.deployment.infrastructureReferences,
      ...json.deployment.mappings,
    ]),
    "repository-mapping": freezeEntries(json.repositoryMappings),
    decision: freezeEntries([
      ...json.decisions.decisions,
      ...json.decisions.references,
      ...json.decisions.referenceAttachments,
    ]),
    view: freezeEntries(json.views),
    "code-intent": freezeEntries(codeIntents),
    codeIntentsPresent: json.codeIntents !== undefined,
  });
}

export const splitArchitectureCanon = splitCanon;
export const splitCanonicalArchitectureDocument = splitCanon;

type MutableRecord = Record<string, unknown>;

function record(value: JsonValue, label: string): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as MutableRecord;
}

function entries(value: unknown, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value as readonly JsonValue[];
}

function exactCollectionKeys(value: unknown): asserts value is CanonCollectionSet {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Canon collection set must be an object");
  }
  const keys = new Set(Object.keys(value));
  const allowed = new Set(["canonVersion", "documentId", ...CANON_DELTA_COLLECTIONS, "codeIntentsPresent"]);
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new TypeError(`Canon collection set contains unsupported field: ${key}`);
    }
  }
  for (const key of ["canonVersion", "documentId", ...CANON_DELTA_COLLECTIONS]) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`Canon collection set is missing field: ${key}`);
  }
}

function byKind(values: readonly JsonValue[], kind: string, label: string): readonly JsonValue[] {
  return values.filter((value) => record(value, label).kind === kind);
}

function withoutKinds(values: readonly JsonValue[], kinds: readonly string[], label: string): readonly JsonValue[] {
  const result: JsonValue[] = [];
  for (const value of values) {
    const candidate = record(value, label);
    if (typeof candidate.kind !== "string" || !kinds.includes(candidate.kind)) {
      throw new TypeError(`${label} has unsupported kind: ${String(candidate.kind)}`);
    }
    result.push(value);
  }
  return result;
}

function strictRecompose(input: ArchitectureDocumentInput, raw: CanonJsonDocument): ArchitectureDocumentV1 {
  // The factory supplies the derived registry, while the strict decoder reads
  // the original values again. This prevents a normalizer that drops unknown
  // fields from making malformed delta data appear valid.
  const normalized = createArchitectureDocument(input);
  const strictValue = {
    canonVersion: raw.canonVersion,
    documentId: raw.documentId,
    root: raw.root,
    elements: raw.elements,
    interfaces: raw.interfaces,
    relationships: raw.relationships,
    responsibilities: raw.responsibilities,
    authority: raw.authority,
    boundaries: raw.boundaries,
    constraints: raw.constraints,
    flows: raw.flows,
    deployment: raw.deployment,
    repositoryMappings: raw.repositoryMappings,
    decisions: raw.decisions,
    views: raw.views,
    ...(raw.codeIntents === undefined ? {} : { codeIntents: raw.codeIntents }),
    globalIdentityRegistry: normalized.globalIdentityRegistry,
  };
  return decodeArchitectureDocument(strictValue);
}

/**
 * Recompose a Canon collection set through the strict canonical codec.
 * `globalIdentityRegistry` is rejected as an input field and regenerated from
 * the recomposed semantic sections.
 */
export function recomposeCanon(collections: CanonCollectionSet): ArchitectureDocumentV1 {
  exactCollectionKeys(collections);
  if (collections.canonVersion !== 1) {
    throw new TypeError(`unsupported Canon version: ${String(collections.canonVersion)}`);
  }
  if (typeof collections.documentId !== "string") throw new TypeError("Canon documentId must be a string");

  const architecture = entries(collections.architecture, "architecture collection");
  if (architecture.length !== 1) throw new TypeError("architecture collection must contain exactly one root");
  const authority = entries(collections.authority, "authority collection");
  const deployment = entries(collections.deployment, "deployment collection");
  const decisions = entries(collections.decision, "decision collection");
  const codeIntentEntries = entries(collections["code-intent"], "code-intent collection");
  const raw: CanonJsonDocument = {
    canonVersion: collections.canonVersion,
    documentId: collections.documentId,
    root: architecture[0],
    elements: entries(collections.element, "element collection"),
    interfaces: entries(collections.interface, "interface collection"),
    relationships: entries(collections.relationship, "relationship collection"),
    responsibilities: { responsibilities: entries(collections.responsibility, "responsibility collection") },
    authority: {
      authority: byKind(authority, "authority", "authority collection"),
      ownership: byKind(authority, "ownership", "authority collection"),
    },
    boundaries: entries(collections.boundary, "boundary collection"),
    constraints: entries(collections.constraint, "constraint collection"),
    flows: entries(collections.flow, "flow collection"),
    deployment: {
      runtimeEnvironments: byKind(deployment, "runtime-environment", "deployment collection"),
      deploymentNodes: byKind(deployment, "deployment-node", "deployment collection"),
      deploymentInstances: byKind(deployment, "deployment-instance", "deployment collection"),
      infrastructureReferences: byKind(deployment, "infrastructure-reference", "deployment collection"),
      mappings: byKind(deployment, "deployment-mapping", "deployment collection"),
    },
    repositoryMappings: entries(collections["repository-mapping"], "repository-mapping collection"),
    decisions: {
      decisions: decisions.filter((value) => Object.hasOwn(record(value, "decision collection"), "title")),
      references: decisions.filter((value) => Object.hasOwn(record(value, "decision collection"), "label")),
      referenceAttachments: decisions.filter((value) =>
        Object.hasOwn(record(value, "decision collection"), "targetId"),
      ),
    },
    views: entries(collections.view, "view collection"),
    ...(collections.codeIntentsPresent
      ? { codeIntents: { schemaVersion: 1, entries: codeIntentEntries } }
      : codeIntentEntries.length === 0
        ? {}
        : { codeIntents: { schemaVersion: 1, entries: codeIntentEntries } }),
  };

  // Ensure every discriminated collection member is represented exactly once.
  withoutKinds(authority, ["authority", "ownership"], "authority collection");
  withoutKinds(
    deployment,
    ["runtime-environment", "deployment-node", "deployment-instance", "infrastructure-reference", "deployment-mapping"],
    "deployment collection",
  );
  const decisionKinds = decisions.map((value) => {
    const candidate = record(value, "decision collection");
    if (Object.hasOwn(candidate, "title")) return "decision";
    if (Object.hasOwn(candidate, "label")) return "reference";
    if (Object.hasOwn(candidate, "targetId")) return "reference-attachment";
    throw new TypeError("decision collection entry has unsupported shape");
  });
  if (decisionKinds.length !== decisions.length) throw new TypeError("decision collection is malformed");

  return strictRecompose(raw as unknown as ArchitectureDocumentInput, raw);
}

export const recomposeArchitectureCanon = recomposeCanon;
export const recomposeCanonicalArchitectureDocument = recomposeCanon;

export interface CanonSourceTargetDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface CanonSourceTargetValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly CanonSourceTargetDiagnostic[];
}

function sourceTargetDiagnostic(
  diagnostics: CanonSourceTargetDiagnostic[],
  code: string,
  path: string,
  message: string,
): void {
  diagnostics.push(Object.freeze({ code, path, message }));
}

/**
 * Validate Code Intent's Canon owner and source-mapping bindings. A declared
 * path or symbol is a design target only; this adapter deliberately does not
 * inspect the filesystem. Existence is certified by the repository evidence
 * pipeline instead.
 */
export function validateCodeIntentSourceTargets(document: ArchitectureDocumentV1): CanonSourceTargetValidationResult {
  const diagnostics: CanonSourceTargetDiagnostic[] = [];
  const architectureValidation = validateArchitectureDocument(document);
  for (const diagnostic of architectureValidation.diagnostics) {
    sourceTargetDiagnostic(diagnostics, diagnostic.code, diagnostic.path, diagnostic.message);
  }

  const mappingsByCanonId = new Map<string, number>();
  for (let mappingIndex = 0; mappingIndex < document.repositoryMappings.length; mappingIndex += 1) {
    const mapping = document.repositoryMappings[mappingIndex];
    mappingsByCanonId.set(mapping.canonId, (mappingsByCanonId.get(mapping.canonId) ?? 0) + 1);
    const seenSymbols = new Set<string>();
    for (let symbolIndex = 0; symbolIndex < mapping.symbols.length; symbolIndex += 1) {
      const symbol = mapping.symbols[symbolIndex];
      const key = `${symbol.path}\u0000${symbol.symbol}\u0000${symbol.exportName ?? ""}`;
      if (seenSymbols.has(key)) {
        sourceTargetDiagnostic(
          diagnostics,
          "ambiguous-source-target",
          `repositoryMappings[${mappingIndex}].symbols[${symbolIndex}]`,
          `repository symbol target is ambiguous: ${symbol.path}#${symbol.symbol}`,
        );
      }
      seenSymbols.add(key);
    }
  }

  const ownerIds = new Set(document.globalIdentityRegistry.entries.map((entry) => entry.id));
  for (let intentIndex = 0; intentIndex < (document.codeIntents?.entries.length ?? 0); intentIndex += 1) {
    const intent = document.codeIntents?.entries[intentIndex] as CodeIntent;
    const path = `codeIntents.entries[${intentIndex}]`;
    if (!ownerIds.has(intent.ownerId)) {
      sourceTargetDiagnostic(
        diagnostics,
        "owner-mismatch",
        `${path}.ownerId`,
        `Code Intent owner does not resolve to a Canon identity: ${intent.ownerId}`,
      );
    }
    const mappingCount = mappingsByCanonId.get(intent.id) ?? 0;
    if (mappingCount === 0) {
      sourceTargetDiagnostic(
        diagnostics,
        "dangling-source-mapping",
        `${path}.id`,
        `Code Intent has no repository mapping: ${intent.id}`,
      );
    } else if (mappingCount > 1) {
      sourceTargetDiagnostic(
        diagnostics,
        "ambiguous-source-target",
        `${path}.id`,
        `Code Intent resolves to multiple repository mappings: ${intent.id}`,
      );
    }
  }

  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

export function assertValidCodeIntentSourceTargets(document: ArchitectureDocumentV1): void {
  const result = validateCodeIntentSourceTargets(document);
  if (!result.valid) {
    const first = result.diagnostics[0];
    throw new Error(`${first?.path ?? "Canon source target"}: ${first?.message ?? "invalid source target"}`);
  }
}

export const validateCanonSourceTargets = validateCodeIntentSourceTargets;
export const assertValidCanonSourceTargets = assertValidCodeIntentSourceTargets;
