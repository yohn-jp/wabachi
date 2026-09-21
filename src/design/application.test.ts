import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../architecture/canon/document.js";
import { architectureCanonDigest } from "./change/diff.js";
import { digestJson, type Digest } from "./digest.js";
import type { SemanticEntryKey } from "./entry-key.js";
import type {
  CertificationEvidence,
  DesignChangeSet,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
} from "./contracts.js";
import type { DesignIntentPorts } from "./ports.js";
import { DesignApplicationError, createDesignApplication } from "./application.js";

const revision = "a".repeat(40);

function fixture() {
  const document = createArchitectureDocument({ documentId: "application-test", root: { id: "architecture" } });
  const canonDigest = architectureCanonDigest(document);
  const payload = {
    contractVersion: 1 as const,
    changeId: "change-application-test",
    base: { repositoryRevision: revision, canonVersion: 1 as const, canonDigest },
    target: { canonVersion: 1 as const, operations: [], targetCanonDigest: canonDigest },
  };

  let change: DesignChangeSet | undefined;
  let lifecycle: DesignIntentLifecycleRecord | undefined;
  const reviews: DesignReviewEvidence[] = [];
  const links: ImplementationLink[] = [];
  let certification: CertificationEvidence | undefined;
  const commits = { change: 0, lifecycle: 0, review: 0, link: 0, certification: 0 };

  const ports: DesignIntentPorts = {
    canon: {
      async readCurrent() {
        return { revision: { repositoryRevision: revision, canonVersion: 1, canonDigest }, document };
      },
      async readAt() {
        return document;
      },
    },
    changes: {
      async apply(_candidate, base) {
        return base;
      },
    },
    changeStore: {
      async read() {
        return change;
      },
      async write(next) {
        commits.change += 1;
        change = next;
      },
    },
    reviews: {
      async list() {
        return reviews;
      },
      async record(evidence) {
        commits.review += 1;
        reviews.push(evidence);
      },
    },
    implementations: {
      async list() {
        return links;
      },
      async record(link) {
        commits.link += 1;
        links.push(link);
      },
    },
    certification: {
      async read() {
        return certification;
      },
      async record(evidence) {
        commits.certification += 1;
        certification = evidence;
      },
    },
    lifecycle: {
      async read() {
        return lifecycle;
      },
      async write(next) {
        commits.lifecycle += 1;
        lifecycle = next;
      },
    },
  };

  return {
    ports,
    payload,
    commits,
    get change() {
      return change;
    },
    get lifecycle() {
      return lifecycle;
    },
  };
}

function reviewFor(change: DesignChangeSet, decision: DesignReviewEvidence["decision"] = "approved") {
  return {
    reviewId: `review-${decision}`,
    changeId: change.changeId,
    proposalDigest: change.digest,
    proposalRevision: "review-revision",
    decision,
    actor: "architect",
    reason: decision === "approved" ? "approved" : "needs changes",
    timestamp: "2026-09-21T00:00:00.000Z",
    evidence: [],
  } satisfies DesignReviewEvidence;
}

async function promotedApplication() {
  const state = fixture();
  const app = createDesignApplication(state.ports);
  const change = await app.create(state.payload);
  await app.submit(change.changeId);
  await app.review(reviewFor(change));
  await app.start(change.changeId);
  await app.link({
    linkId: "link-application-test",
    changeId: change.changeId,
    changeDigest: change.digest,
    implementation: { repositoryHost: "github.com", repositoryId: "1335559861", number: 224 },
    targetEntryKeys: ['["element","application"]' as SemanticEntryKey],
  });
  await app.certify({
    certificationId: "certification-application-test",
    changeId: change.changeId,
    changeDigest: change.digest,
    implementationRevision: { repository: "repo", revision },
    result: "match",
    checks: [{ checkId: "check-application-test", result: "match" }],
    recordedAt: "2026-09-21T00:00:00.000Z",
  });
  return { state, app, change };
}

test("composes the guarded draft-to-promoted lifecycle through ports", async () => {
  const { state, app, change } = await promotedApplication();
  assert.equal(state.lifecycle?.state, "certification-review");
  const promoted = await app.promote(change.changeId);
  assert.equal(promoted.state, "promoted");
  assert.equal(state.commits.change, 1);
  assert.equal(state.commits.lifecycle, 7);
});

test("rejects malformed proposals before any store commit", async () => {
  const state = fixture();
  const app = createDesignApplication(state.ports);
  const malformed = {
    ...state.payload,
    target: { ...state.payload.target, targetCanonDigest: "not-a-digest" },
  };

  await assert.rejects(app.create(malformed), (error: unknown) => {
    return error instanceof Error && /digest|invalid/i.test(error.message);
  });
  assert.deepEqual(state.commits, { change: 0, lifecycle: 0, review: 0, link: 0, certification: 0 });
});

test("does not retry a stale lifecycle read", async () => {
  const state = fixture();
  const app = createDesignApplication(state.ports);
  const change = await app.create(state.payload);
  state.ports.lifecycle.read = async () => ({
    changeId: change.changeId,
    changeDigest: "f".repeat(64) as Digest,
    state: "draft",
    implementations: [],
  });

  await assert.rejects(app.submit(change.changeId), (error: unknown) => {
    return error instanceof DesignApplicationError && error.code === "stale-lifecycle";
  });
  assert.equal(state.commits.lifecycle, 1);
});

test("rework preserves evidence history while resetting the current guard state", async () => {
  const state = fixture();
  const app = createDesignApplication(state.ports);
  const change = await app.create(state.payload);
  await app.submit(change.changeId);
  await app.review(reviewFor(change, "changes-requested"));
  assert.equal((await app.recover(change.changeId)).state, "draft");
  assert.equal(state.commits.review, 1);
  assert.equal(digestJson(change).length, 64);
});
