import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeArchitectureDocument, serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import { createArchitectureDocument, type ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import { createSemanticEntryKey } from "../entry-key.js";
import { digestJson, type Digest } from "../digest.js";
import {
  checkerResultDigest,
  implementationLinkageDigest,
  implementationSubjectDigest,
  type CertificationRecord,
  type GitImplementationSubject,
} from "../certification/certify.js";
import { createDesignChangeSet } from "../change/diff.js";
import type {
  CanonRevisionReference,
  DesignChangeSet,
  DesignIntentLifecycleRecord,
  RepositoryRevisionReference,
} from "../contracts.js";
import type { FileDigest } from "../storage/transaction.js";
import type { StorageWritePlan } from "../storage/store.js";
import {
  DesignPromotionService,
  type PromotionArtifact,
  type PromotionCurrentArtifact,
  type PromotionStorePort,
} from "./service.js";

const subject: GitImplementationSubject = { path: "src/service.ts", mode: "100644", objectId: "a".repeat(40) };
const implementationRevision: RepositoryRevisionReference = {
  repository: "github.com/example/project",
  revision: "b".repeat(40),
};

class MemoryPromotionStore implements PromotionStorePort {
  readonly commits: StorageWritePlan[][] = [];
  readonly files = new Map<string, Uint8Array>();
  currentRevision: CanonRevisionReference;
  change: PromotionArtifact<DesignChangeSet>;
  lifecycle: PromotionArtifact<DesignIntentLifecycleRecord>;
  failCommit: Error | undefined;
  conflictOnCommit = false;

  constructor(current: ArchitectureDocumentV1, change: DesignChangeSet, lifecycle: DesignIntentLifecycleRecord) {
    const currentBytes = serializeCanonicalArchitectureDocument(current);
    this.files.set(".wabachi/architecture.json", bytes(currentBytes));
    this.currentRevision = {
      repositoryRevision: "c".repeat(40),
      canonVersion: current.canonVersion,
      canonDigest: digestJson(current),
    };
    this.change = artifact(change);
    this.lifecycle = artifact(lifecycle);
    this.files.set(".wabachi/changes/change-1/lifecycle.json", bytes(this.lifecycle.bytes));
  }

  async readCurrent(): Promise<PromotionCurrentArtifact> {
    const value = this.files.get(".wabachi/architecture.json");
    assert.ok(value);
    const document = decodeArchitectureDocument(JSON.parse(Buffer.from(value).toString("utf8")) as unknown);
    return { revision: this.currentRevision, document, bytes: value };
  }

  async readChangeArtifact(): Promise<PromotionArtifact<DesignChangeSet>> {
    return this.change;
  }

  async readLifecycleArtifact(): Promise<PromotionArtifact<DesignIntentLifecycleRecord>> {
    return this.lifecycle;
  }

  async readReceiptArtifact(): Promise<PromotionArtifact<never> | undefined> {
    const value = this.files.get(".wabachi/changes/change-1/promotion-receipt.json");
    if (value === undefined) return undefined;
    return artifact(JSON.parse(Buffer.from(value).toString("utf8")) as never);
  }

  async commit(
    plans: readonly StorageWritePlan[],
  ): Promise<{ readonly transactionId: string; readonly state: "committed" }> {
    this.commits.push([...plans]);
    if (this.failCommit !== undefined) throw this.failCommit;
    if (this.conflictOnCommit) {
      this.files.set(".wabachi/architecture.json", bytes("writer changed the Canon"));
    }
    for (const plan of plans) {
      const current = this.files.get(plan.path);
      const actual = current === undefined ? null : sha256(current);
      if (actual !== plan.expectedDigest) throw new Error("CAS conflict for " + plan.path);
      this.files.set(plan.path, bytes(plan.nextBytes));
    }
    const current = await this.readCurrent();
    this.currentRevision = { ...current.revision, canonDigest: digestJson(current.document) };
    this.lifecycle = artifact(
      JSON.parse(Buffer.from(this.files.get(".wabachi/changes/change-1/lifecycle.json")!).toString()),
    );
    return { transactionId: "transaction-1", state: "committed" };
  }
}

test("executes promotion and an identical retry returns the original receipt without another commit", async () => {
  const fixture = createFixture();
  const service = new DesignPromotionService(fixture.store);
  const first = await service.promote(fixture.input);
  const second = await service.promote(fixture.input);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(fixture.store.commits.length, 1);
});

test("writer conflict is surfaced without retrying an obsolete plan", async () => {
  const fixture = createFixture();
  fixture.store.conflictOnCommit = true;
  await assert.rejects(() => new DesignPromotionService(fixture.store).promote(fixture.input), /CAS conflict/);
  assert.equal(fixture.store.commits.length, 1);
});

test("idempotent retry rejects semantically equivalent but byte-different current Canon", async () => {
  const fixture = createFixture();
  const service = new DesignPromotionService(fixture.store);
  await service.promote(fixture.input);
  fixture.store.files.set(
    ".wabachi/architecture.json",
    bytes(" \n" + serializeCanonicalArchitectureDocument(fixture.input.certifiedTarget) + "\n"),
  );

  await assert.rejects(() => service.promote(fixture.input), /bytes do not match the certified post-image/);
  assert.equal(fixture.store.commits.length, 1);
});

test("an interrupted transaction never reports promotion success", async () => {
  const fixture = createFixture();
  fixture.store.failCommit = new Error("interrupted transaction");
  await assert.rejects(
    () => new DesignPromotionService(fixture.store).promote(fixture.input),
    /interrupted transaction/,
  );
  assert.equal(fixture.store.commits.length, 1);
});

function createFixture(): {
  readonly store: MemoryPromotionStore;
  readonly input: {
    readonly changeId: string;
    readonly certifiedTarget: ArchitectureDocumentV1;
    readonly promotionTransition: { readonly state: "promoted" };
    readonly implementationRevision: RepositoryRevisionReference;
  };
} {
  const current = createArchitectureDocument({ documentId: "promotion-service", root: { id: "architecture" } });
  const target = createArchitectureDocument({
    documentId: "promotion-service",
    root: { id: "architecture" },
    elements: [{ id: "service", kind: "service" }],
  });
  const change = createDesignChangeSet({
    changeId: "change-1",
    base: {
      repositoryRevision: "c".repeat(40),
      canonVersion: current.canonVersion,
      canonDigest: digestJson(current),
    },
    baseCanon: current,
    targetCanon: target,
  });
  const entryKey = createSemanticEntryKey({ collection: "element", identity: ["service"] });
  const link = {
    linkId: "link-1",
    changeId: change.changeId,
    changeDigest: change.digest,
    implementation: { repositoryHost: "github.com", repositoryId: "repo", number: 1 },
    targetEntryKeys: [entryKey],
  } as const;
  const certification: CertificationRecord = {
    certificationId: "certification-1",
    changeId: change.changeId,
    changeDigest: change.digest,
    proposalDigest: change.digest,
    targetCanonDigest: digestJson(target),
    linkageDigest: implementationLinkageDigest([link]),
    implementationSubjectDigest: implementationSubjectDigest([subject]),
    checkerDigest: checkerResultDigest([{ checkId: "canon-valid", result: "match" }]),
    implementationSubject: [subject],
    implementationRevision,
    result: "match",
    checks: [{ checkId: "canon-valid", result: "match" }],
    recordedAt: "2026-01-01T00:00:00.000Z",
  };
  const lifecycle: DesignIntentLifecycleRecord = {
    changeId: change.changeId,
    changeDigest: change.digest,
    state: "certification-review",
    review: {
      reviewId: "review-1",
      changeId: change.changeId,
      proposalDigest: change.digest,
      proposalRevision: "d".repeat(40),
      decision: "approved",
      actor: "architect",
      reason: "approved",
      timestamp: "2026-01-01T00:00:00.000Z",
      evidence: [],
    },
    implementations: [link],
    certification,
  };
  const store = new MemoryPromotionStore(current, change, lifecycle);
  return {
    store,
    input: {
      changeId: change.changeId,
      certifiedTarget: target,
      promotionTransition: { state: "promoted" },
      implementationRevision,
    },
  };
}

function artifact<T>(value: T): PromotionArtifact<T> {
  const encodedBytes = bytes(JSON.stringify(value));
  return { value, bytes: encodedBytes, byteDigest: sha256(encodedBytes) };
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value);
}

function sha256(value: string | Uint8Array): FileDigest {
  return createHash("sha256").update(value).digest("hex");
}
