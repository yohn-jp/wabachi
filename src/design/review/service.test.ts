import assert from "node:assert/strict";
import { test } from "node:test";
import type { Digest } from "../digest.js";
import type { SemanticEntryKey } from "../entry-key.js";
import type {
  CanonRevisionReference,
  DesignChangeSet,
  DesignChangeSetPayload,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
} from "../contracts.js";
import type { DesignIntentPorts } from "../ports.js";
import {
  createDesignChangeSet,
  DesignReviewError,
  DesignReviewService,
  type ProposalRevisionReader,
} from "./service.js";

const digest = "0".repeat(64) as Digest;

function payload(changeId = "change-1", value = "one"): DesignChangeSetPayload {
  const base: CanonRevisionReference = { repositoryRevision: "base-1", canonVersion: 1, canonDigest: digest };
  return {
    contractVersion: 1,
    changeId,
    base,
    target: {
      canonVersion: 1,
      operations: [{ kind: "added", entryKey: '["element","one"]' as SemanticEntryKey, value }],
      targetCanonDigest: digest,
    },
  } as DesignChangeSetPayload;
}

function review(
  change: DesignChangeSet,
  decision: DesignReviewEvidence["decision"] = "approved",
  revision: string = change.digest,
): DesignReviewEvidence {
  return {
    reviewId: `review-${revision}`,
    changeId: change.changeId,
    proposalDigest: change.digest,
    proposalRevision: revision,
    decision,
    actor: "architect",
    reason: decision === "approved" ? "accepted" : "needs revision",
    timestamp: "2026-09-21T00:00:00.000Z",
    evidence: [{ provider: "local", reference: "review" }],
  };
}

function ports(
  current: DesignChangeSet,
  reviews: DesignReviewEvidence[] = [],
  lifecycle?: DesignIntentLifecycleRecord,
) {
  let stored = current;
  let record = lifecycle;
  return {
    value: {
      canon: {} as DesignIntentPorts["canon"],
      changes: {} as DesignIntentPorts["changes"],
      changeStore: {
        async read() {
          return stored;
        },
        async write(change: DesignChangeSet) {
          stored = change;
        },
      },
      reviews: {
        async list(_changeId: string) {
          return reviews;
        },
        async record(evidence: DesignReviewEvidence) {
          reviews.push(evidence);
        },
      },
      implementations: {} as DesignIntentPorts["implementations"],
      certification: {} as DesignIntentPorts["certification"],
      lifecycle: {
        async read() {
          return record;
        },
        async write(next: DesignIntentLifecycleRecord) {
          record = next;
        },
      },
    } satisfies DesignIntentPorts,
    get change() {
      return stored;
    },
    get lifecycle() {
      return record;
    },
  };
}

test("selects approval only when digest and reviewed revision reproduce current bytes", async () => {
  const change = createDesignChangeSet(payload());
  const commit = "proposal-commit";
  const revisions = new Map([[commit, change]]);
  const reader: ProposalRevisionReader = {
    async read(_changeId, revision) {
      return revisions.get(revision);
    },
  };
  const state = ports(change, [review(change, "approved", commit)]);
  const service = new DesignReviewService(state.value, { proposalRevisions: reader });

  const selected = await service.selectApproval(change.changeId);
  assert.equal(selected.evidence.proposalRevision, commit);

  revisions.delete(commit);
  await assert.rejects(service.selectApproval(change.changeId), (error: unknown) => {
    return error instanceof DesignReviewError && error.code === "approval-not-current";
  });
});

test("a semantic amendment invalidates approval and returns certification review to draft", async () => {
  const current = createDesignChangeSet(payload());
  const state = ports(current, [review(current)], {
    changeId: current.changeId,
    changeDigest: current.digest,
    state: "certification-review",
    implementations: [],
    review: review(current),
  });
  const service = new DesignReviewService(state.value);

  const amended = await service.amend(current.changeId, payload(current.changeId, "two"));
  assert.equal(amended.changed, true);
  assert.equal(amended.lifecycle?.state, "draft");
  await assert.rejects(service.selectApproval(current.changeId));
  assert.equal(state.change.digest, amended.change.digest);
});

test("normalization-only amendment is a no-op and preserves approval", async () => {
  const first = payload();
  const current = createDesignChangeSet(first);
  const state = ports(current, [review(current)]);
  const service = new DesignReviewService(state.value);
  const reordered = { ...first, base: { ...first.base }, target: { ...first.target } };

  const result = await service.amend(current.changeId, reordered);
  assert.equal(result.changed, false);
  assert.equal(result.change.digest, current.digest);
  assert.equal((await service.selectApproval(current.changeId)).evidence.reviewId, review(current).reviewId);
});

test("changes-requested records history and returns the lifecycle to draft", async () => {
  const current = createDesignChangeSet(payload());
  const state = ports(current, [review(current)]);
  const service = new DesignReviewService(state.value);

  const lifecycle = await service.recordReview(review(current, "changes-requested"));
  assert.equal(lifecycle.state, "draft");
  assert.equal((await state.value.reviews.list(current.changeId)).length, 2);
  await assert.rejects(service.assertImplementationAuthorized(current.changeId));
});
