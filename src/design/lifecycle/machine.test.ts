import assert from "node:assert/strict";
import test from "node:test";
import { createActor } from "xstate";

import type { CertificationEvidence, DesignReviewEvidence, ImplementationLink } from "../contracts.js";
import type { Digest } from "../digest.js";
import type { SemanticEntryKey } from "../entry-key.js";
import {
  createDesignChangeLifecycleMachine,
  type DesignChangeLifecycleEvent,
  type DesignChangeLifecycleFacts,
  type DesignChangeLifecycleInput,
} from "./machine.js";

const changeId = "change-203";
const changeDigest = "digest-203" as Digest;
const proposalRevision = "revision-203";
const implementation: ImplementationLink = {
  linkId: "implementation-link-203",
  changeId,
  changeDigest,
  implementation: {
    repositoryHost: "github.com",
    repositoryId: "1335559861",
    number: 203,
  },
  targetEntryKeys: ["element:orders" as SemanticEntryKey],
};

const approvedReview: DesignReviewEvidence = {
  reviewId: "review-203",
  changeId,
  proposalDigest: changeDigest,
  proposalRevision,
  decision: "approved",
  actor: "reviewer",
  reason: "approved",
  timestamp: "2026-09-21T00:00:00.000Z",
  evidence: [],
};

const certification: CertificationEvidence = {
  certificationId: "certification-203",
  changeId,
  changeDigest,
  implementationRevision: { repository: "yohn-jp/wabachi", revision: "revision-implementation-203" },
  result: "match",
  checks: [{ checkId: "check-203", result: "match" }],
  recordedAt: "2026-09-21T00:00:00.000Z",
};

const facts: DesignChangeLifecycleFacts = {
  changeId,
  changeDigest,
  proposalRevision,
  review: approvedReview,
  implementations: [implementation],
  certification,
};

function actorFor(input: DesignChangeLifecycleInput = facts) {
  const actor = createActor(createDesignChangeLifecycleMachine(input), { input });
  actor.start();
  return actor;
}

function send(actor: ReturnType<typeof actorFor>, event: DesignChangeLifecycleEvent) {
  actor.send(event);
  return actor.getSnapshot();
}

test("accepts the guarded draft-to-promoted lifecycle", () => {
  const actor = actorFor();

  assert.equal(actor.getSnapshot().value, "draft");
  assert.equal(send(actor, { type: "SUBMIT_FOR_DESIGN_REVIEW" }).value, "design-review");
  assert.equal(send(actor, { type: "DESIGN_REVIEW_APPROVED" }).value, "approved");
  assert.equal(send(actor, { type: "START_IMPLEMENTATION" }).value, "implementing");
  assert.equal(send(actor, { type: "SUBMIT_FOR_CERTIFICATION" }).value, "certification-review");
  assert.equal(send(actor, { type: "PROMOTE" }).value, "promoted");
  assert.equal(actor.getSnapshot().context.lastError, undefined);
  actor.stop();
});

test("rejects implementation, promotion, and post-promotion mutation before their gates", () => {
  const actor = actorFor({ ...facts, review: undefined, implementations: [], certification: undefined });

  let snapshot = send(actor, { type: "START_IMPLEMENTATION" });
  assert.equal(snapshot.value, "draft");
  assert.deepEqual(snapshot.context.lastError, {
    code: "illegal-transition",
    event: "START_IMPLEMENTATION",
  });

  assert.equal(send(actor, { type: "SUBMIT_FOR_DESIGN_REVIEW" }).value, "design-review");
  snapshot = send(actor, { type: "DESIGN_REVIEW_APPROVED" });
  assert.equal(snapshot.value, "design-review");
  assert.equal(snapshot.context.lastError?.event, "DESIGN_REVIEW_APPROVED");

  const approvedActor = actorFor({ ...facts, implementations: [] });
  send(approvedActor, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  send(approvedActor, { type: "DESIGN_REVIEW_APPROVED" });
  assert.equal(send(approvedActor, { type: "START_IMPLEMENTATION" }).value, "implementing");
  snapshot = send(approvedActor, { type: "SUBMIT_FOR_CERTIFICATION" });
  assert.equal(snapshot.value, "implementing");
  assert.equal(snapshot.context.lastError?.event, "SUBMIT_FOR_CERTIFICATION");
  approvedActor.stop();
  actor.stop();
});

test("returns design review rework to draft only for persisted rework decisions", () => {
  for (const decision of ["changes-requested", "rejected"] as const) {
    const review = { ...approvedReview, decision };
    const actor = actorFor({ ...facts, review });
    assert.equal(send(actor, { type: "SUBMIT_FOR_DESIGN_REVIEW" }).value, "design-review");
    assert.equal(send(actor, { type: "DESIGN_REVIEW_REWORK" }).value, "draft");
    actor.stop();
  }
});

test("returns certification rework to implementing and does not promote mismatch", () => {
  const unsuccessful: CertificationEvidence = { ...certification, result: "mismatch" };
  const actor = actorFor({ ...facts, certification: unsuccessful });

  send(actor, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  send(actor, { type: "DESIGN_REVIEW_APPROVED" });
  send(actor, { type: "START_IMPLEMENTATION" });
  assert.equal(send(actor, { type: "SUBMIT_FOR_CERTIFICATION" }).value, "certification-review");
  assert.equal(send(actor, { type: "PROMOTE" }).value, "certification-review");
  assert.equal(send(actor, { type: "CERTIFICATION_REWORK" }).value, "implementing");
  actor.stop();

  const promoted = actorFor();
  send(promoted, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  send(promoted, { type: "DESIGN_REVIEW_APPROVED" });
  send(promoted, { type: "START_IMPLEMENTATION" });
  send(promoted, { type: "SUBMIT_FOR_CERTIFICATION" });
  send(promoted, { type: "PROMOTE" });
  assert.equal(send(promoted, { type: "START_IMPLEMENTATION" }).value, "promoted");
  assert.equal(promoted.getSnapshot().context.lastError?.event, "START_IMPLEMENTATION");
  promoted.stop();
});

test("treats AMEND as a lifecycle event and invalidates current evidence", () => {
  const states = ["draft", "design-review", "approved", "implementing", "certification-review"] as const;

  for (const initialState of states) {
    const actor = actorFor({ ...facts, initialState });
    assert.equal(send(actor, { type: "AMEND" }).value, "draft");
    assert.equal(actor.getSnapshot().context.review, undefined);
    assert.deepEqual(actor.getSnapshot().context.implementations, []);
    assert.equal(actor.getSnapshot().context.certification, undefined);
    actor.stop();
  }

  const promoted = actorFor({ ...facts, initialState: "promoted" });
  assert.equal(send(promoted, { type: "AMEND" }).value, "promoted");
  assert.equal(promoted.getSnapshot().context.lastError?.event, "AMEND");
  promoted.stop();
});

test("fails closed when proposal revision is missing or does not match review evidence", () => {
  const missingRevision = actorFor({ ...facts, proposalRevision: undefined });
  send(missingRevision, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  assert.equal(send(missingRevision, { type: "DESIGN_REVIEW_APPROVED" }).value, "design-review");
  missingRevision.stop();

  const mismatchedRevision = actorFor({ ...facts, proposalRevision: "different-revision" });
  send(mismatchedRevision, { type: "SUBMIT_FOR_DESIGN_REVIEW" });
  assert.equal(send(mismatchedRevision, { type: "DESIGN_REVIEW_APPROVED" }).value, "design-review");
  mismatchedRevision.stop();
});
