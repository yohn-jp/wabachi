import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { serializeCanonicalArchitectureDocument } from "../../architecture/canon/codec.js";
import { createSemanticEntryKey } from "../entry-key.js";
import { digestJson, type Digest } from "../digest.js";
import {
  checkerResultDigest,
  implementationLinkageDigest,
  implementationSubjectDigest,
  type CertificationRecord,
  type GitImplementationSubject,
} from "../certification/certify.js";
import type {
  CanonRevisionReference,
  DesignChangeSet,
  DesignIntentLifecycleRecord,
  RepositoryRevisionReference,
} from "../contracts.js";
import { preflightPromotion, type PromotionPreflightInput } from "./plan.js";

const implementationSubject: GitImplementationSubject = {
  path: "src/service.ts",
  mode: "100644",
  objectId: "git-object-1",
};

function canon(withElement = false) {
  return createArchitectureDocument({
    documentId: "promotion-test",
    root: { id: "architecture" },
    elements: withElement ? [{ id: "service", kind: "service" }] : [],
  });
}

function revision(document: ReturnType<typeof canon>, repositoryRevision = "base-revision"): CanonRevisionReference {
  return {
    repositoryRevision,
    canonVersion: document.canonVersion,
    canonDigest: digestJson(document),
  };
}

function changeFor(base: CanonRevisionReference, target: ReturnType<typeof canon>): DesignChangeSet {
  const payload = {
    contractVersion: 1 as const,
    changeId: "change-1",
    base,
    target: {
      canonVersion: target.canonVersion,
      operations: [
        {
          kind: "added" as const,
          entryKey: createSemanticEntryKey({ collection: "element", identity: ["service"] }),
          value: { id: "service", kind: "service" },
        },
      ],
      targetCanonDigest: digestJson(target),
    },
  };
  return { ...payload, digest: digestJson(payload) };
}

function lifecycleFor(
  change: DesignChangeSet,
  implementationRevision: RepositoryRevisionReference = {
    repository: "github.com/example/project",
    revision: "implementation-revision",
  },
): DesignIntentLifecycleRecord {
  return {
    changeId: change.changeId,
    changeDigest: change.digest,
    state: "certification-review",
    review: {
      reviewId: "review-1",
      changeId: change.changeId,
      proposalDigest: change.digest,
      proposalRevision: "proposal-revision",
      decision: "approved",
      actor: "architect",
      reason: "approved",
      timestamp: "2026-01-01T00:00:00.000Z",
      evidence: [],
    },
    implementations: [
      {
        linkId: "link-1",
        changeId: change.changeId,
        changeDigest: change.digest,
        implementation: {
          repositoryHost: "github.com",
          repositoryId: "repo-1",
          number: 1,
        },
        targetEntryKeys: [change.target.operations[0].entryKey],
      },
    ],
    certification: {
      certificationId: "certification-1",
      changeId: change.changeId,
      changeDigest: change.digest,
      proposalDigest: change.digest,
      targetCanonDigest: change.target.targetCanonDigest,
      linkageDigest: implementationLinkageDigest([
        {
          linkId: "link-1",
          changeId: change.changeId,
          changeDigest: change.digest,
          implementation: {
            repositoryHost: "github.com",
            repositoryId: "repo-1",
            number: 1,
          },
          targetEntryKeys: [change.target.operations[0].entryKey],
        },
      ]),
      implementationSubjectDigest: implementationSubjectDigest([implementationSubject]),
      checkerDigest: checkerResultDigest([{ checkId: "canon-valid", result: "match" }]),
      implementationSubject: [implementationSubject],
      implementationRevision,
      result: "match",
      checks: [{ checkId: "canon-valid", result: "match" }],
      recordedAt: "2026-01-02T00:00:00.000Z",
    } as CertificationRecord,
  };
}

function input(overrides: Partial<PromotionPreflightInput> = {}): PromotionPreflightInput {
  const currentDocument = canon();
  const targetDocument = canon(true);
  const current = revision(currentDocument);
  const change = changeFor(current, targetDocument);
  return {
    current: { revision: current, document: currentDocument },
    change,
    lifecycle: lifecycleFor(change),
    certifiedTarget: targetDocument,
    promotionTransition: { state: "promoted" },
    ...overrides,
  };
}

test("plans the exact certified target and terminal lifecycle mutations", () => {
  const value = input();
  const result = preflightPromotion(value);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.writes.length, 3);
  assert.deepEqual(
    result.plan.writes.map((write) => write.kind),
    ["current-canon", "lifecycle-record", "promotion-receipt"],
  );
  assert.equal(result.plan.nextCurrentCanonBytes, serializeCanonicalArchitectureDocument(value.certifiedTarget));
  assert.equal(result.plan.writes[0].bytes, result.plan.nextCurrentCanonBytes);
  assert.equal(result.plan.nextLifecycle.state, "promoted");
  assert.equal(result.plan.receipt.event, "PROMOTE");
  assert.equal(result.plan.preimages.length, 2);
  assert.equal(result.plan.writes[0].expectedDigest, sha256(result.plan.preimages[0].bytes));
  assert.notEqual(result.plan.writes[0].expectedDigest, value.current.revision.canonDigest);
});

test("advanced current Canon produces no write plan", () => {
  const value = input();
  const advanced = canon(true);
  const result = preflightPromotion({
    ...value,
    current: { revision: revision(advanced, "advanced-revision"), document: advanced },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "base-mismatch");
  assert.equal(result.plan, undefined);
});

test("stale certification, unsafe target, and unsupported schema fail closed", () => {
  const value = input();
  const stale = preflightPromotion({
    ...value,
    lifecycle: {
      ...value.lifecycle,
      certification: { ...value.lifecycle.certification!, changeDigest: "f".repeat(64) as Digest },
    },
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.failure.code, "stale-certification");

  const unsafeTarget = canon(true);
  const unsafe = preflightPromotion({
    ...value,
    certifiedTarget: { ...unsafeTarget, documentId: "different" as typeof unsafeTarget.documentId },
  });
  assert.equal(unsafe.ok, false);
  if (!unsafe.ok) assert.equal(unsafe.failure.code, "unsafe-target");

  const unsupported = preflightPromotion({
    ...value,
    change: {
      ...value.change,
      target: { ...value.change.target, canonVersion: 2 as never },
    },
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.failure.code, /unsupported-schema|invalid-input/u);
});

test("preflight does not invoke a writer or mutate supplied facts", () => {
  const value = input();
  const before = JSON.stringify(value);
  const result = preflightPromotion(value);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(value), before);
});

test("byte CAS uses the exact loaded bytes even when their Canon is semantically equivalent", () => {
  const value = input();
  const currentBytes = ` ${serializeCanonicalArchitectureDocument(value.current.document)}\n`;
  const result = preflightPromotion({ ...value, current: { ...value.current, bytes: currentBytes } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.writes[0].expectedDigest, sha256(currentBytes));
  assert.equal(result.plan.preimages[0].bytes, currentBytes);
});

test("certification-review cannot be planned without an authorized PROMOTE result", () => {
  const value = input({ promotionTransition: { state: "certification-review" } });
  const result = preflightPromotion(value);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "stale-certification");
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

test("promotion requires each independent certification digest binding", () => {
  const value = input();
  const fields = [
    "proposalDigest",
    "targetCanonDigest",
    "linkageDigest",
    "implementationSubjectDigest",
    "checkerDigest",
  ] as const;
  for (const field of fields) {
    const certification = { ...value.lifecycle.certification! } as Record<string, unknown>;
    certification[field] = "f".repeat(64);
    const result = preflightPromotion({
      ...value,
      lifecycle: { ...value.lifecycle, certification: certification as never },
    });
    assert.equal(result.ok, false, `expected ${field} mismatch to fail`);
    if (!result.ok) assert.equal(result.failure.code, "stale-certification");
  }
});
