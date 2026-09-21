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
import { canonicalizeJson, digestJson, type Digest } from "../digest.js";
import { deriveSemanticEntries } from "./identity.js";

interface CanonJson {
  readonly canonVersion: number;
  readonly documentId: string;
  readonly root: unknown;
  readonly elements: readonly unknown[];
  readonly interfaces: readonly unknown[];
  readonly relationships: readonly unknown[];
  readonly responsibilities: unknown;
  readonly authority: unknown;
  readonly boundaries: readonly unknown[];
  readonly constraints: readonly unknown[];
  readonly flows: readonly unknown[];
  readonly deployment: unknown;
  readonly repositoryMappings: readonly unknown[];
  readonly decisions: unknown;
  readonly views: readonly unknown[];
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
  const baseEntries = new Map(deriveSemanticEntries(base).map((item) => [item.entryKey, item]));
  const targetEntries = new Map(deriveSemanticEntries(target).map((item) => [item.entryKey, item]));
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
