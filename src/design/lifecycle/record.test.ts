import assert from "node:assert/strict";
import test from "node:test";

import { digestJson, type Digest, type JsonValue } from "../digest.js";
import {
  appendLifecycleEvent,
  createDesignChangeEvent,
  replayLifecycle,
  type DesignChangeEvent,
  type LifecycleEvidenceSnapshot,
  type MachinePort,
  type MachineTransitionRequest,
} from "./record.js";

const proposalDigest = digestJson({ proposal: "v1" });
const amendedDigest = digestJson({ proposal: "v2" });
const proposalRevision = "a".repeat(40);
const amendedRevision = "b".repeat(40);

const review = {
  reviewId: "review-1",
  changeId: "change-1",
  proposalDigest,
  proposalRevision,
  decision: "approved" as const,
  actor: "architect",
  reason: "valid",
  timestamp: "2026-09-21T00:00:00.000Z",
  evidence: [],
};

const implementation = {
  linkId: "link-1",
  changeId: "change-1",
  changeDigest: proposalDigest,
  implementation: { repositoryHost: "github.com", repositoryId: "repo", number: 1 },
  targetEntryKeys: [],
};

const certification = {
  certificationId: "cert-1",
  changeId: "change-1",
  changeDigest: proposalDigest,
  implementationRevision: { repository: "repo", revision: "def456" },
  result: "match" as const,
  checks: [],
  recordedAt: "2026-09-21T00:00:00.000Z",
};

function machineForTests(): MachinePort {
  return {
    transition({ state, event, context }: MachineTransitionRequest) {
      const type = String((event.payload as { type?: unknown } | undefined)?.type ?? event.kind);
      switch (type) {
        case "REVIEW":
          if (state !== "draft") throw new Error("review requires draft");
          return "design-review";
        case "APPROVE":
          if (state !== "design-review" || context.review?.decision !== "approved") {
            throw new Error("approval requires current approved review");
          }
          return "approved";
        case "START":
          if (state !== "approved" || context.review?.proposalDigest !== context.proposalDigest) {
            throw new Error("start requires current approval");
          }
          return "implementing";
        case "CERTIFY":
          if (state !== "implementing" || context.certification?.result !== "match") {
            throw new Error("certification requires implementation");
          }
          return "certification-review";
        case "PROMOTE":
          if (state !== "certification-review" || context.certification?.result !== "match") {
            throw new Error("promotion requires certification");
          }
          return "promoted";
        case "AMEND":
          if (state === "promoted") throw new Error("promoted is terminal");
          return "draft";
        default:
          return state;
      }
    },
  };
}

function event(
  events: readonly DesignChangeEvent[],
  kind: string,
  payload: Record<string, JsonValue> = {},
  changeId = "change-1",
  initial = proposalDigest,
): readonly DesignChangeEvent[] {
  return appendLifecycleEvent(events, {
    changeId,
    kind,
    payload,
    recordedAt: "2026-09-21T00:00:00.000Z",
    initialProposalDigest: initial,
  });
}

test("replays a chained stream into authoritative lifecycle state", () => {
  let events: readonly DesignChangeEvent[] = [];
  events = event(events, "REVIEW", { type: "REVIEW", reviewId: "review-1" });
  events = event(events, "TRANSITION", { type: "APPROVE" });
  events = event(events, "IMPLEMENTATION", { type: "START", implementationId: "link-1" });
  events = event(events, "CERTIFICATION", { type: "CERTIFY", certificationId: "cert-1" });
  events = event(events, "TRANSITION", { type: "PROMOTE" });

  const evidence: LifecycleEvidenceSnapshot = {
    reviews: { "review-1": review },
    implementations: { "link-1": implementation },
    certifications: { "cert-1": certification },
  };
  const projection = replayLifecycle({
    changeId: "change-1",
    initialProposalDigest: proposalDigest,
    initialProposalRevision: proposalRevision,
    events,
    machine: machineForTests(),
    evidence,
  });

  assert.equal(projection.state, "promoted");
  assert.equal(projection.changeDigest, proposalDigest);
  assert.equal(projection.implementations[0]?.linkId, "link-1");
  assert.equal(projection.history.reviews.length, 1);
  assert.equal(projection.lastEventDigest, events.at(-1)?.eventDigest);
});

test("rejects deletion, reordering, broken digests, and stale cached state", () => {
  let events: readonly DesignChangeEvent[] = [];
  events = event(events, "REVIEW", { type: "REVIEW", reviewId: "review-1" });
  events = event(events, "TRANSITION", { type: "APPROVE" });
  const evidence: LifecycleEvidenceSnapshot = { reviews: { "review-1": review } };
  const options = {
    changeId: "change-1",
    initialProposalDigest: proposalDigest,
    initialProposalRevision: proposalRevision,
    machine: machineForTests(),
    evidence,
  };

  assert.throws(() => replayLifecycle({ ...options, events: events.slice(1) }), /sequence/);
  assert.throws(() => replayLifecycle({ ...options, events: [...events].reverse() }), /sequence|previous digest/);
  const handEdited = { ...events[0], eventDigest: digestJson({ edited: true }) };
  assert.throws(() => replayLifecycle({ ...options, events: [handEdited, events[1]] }), /digest/);
  assert.throws(
    () =>
      replayLifecycle({
        ...options,
        events,
        cached: {
          changeId: "change-1",
          changeDigest: proposalDigest,
          state: "approved",
          implementations: [],
        },
      }),
    /cached lifecycle state/,
  );
});

test("AMEND retains historical evidence but invalidates current guards", () => {
  let events: readonly DesignChangeEvent[] = [];
  events = event(events, "REVIEW", { type: "REVIEW", reviewId: "review-1" });
  events = event(events, "TRANSITION", { type: "APPROVE" });
  events = event(events, "AMEND", {
    type: "AMEND",
    proposalDigest: amendedDigest,
    proposalRevision: amendedRevision,
  });
  const evidence: LifecycleEvidenceSnapshot = { reviews: { "review-1": review } };

  const projection = replayLifecycle({
    changeId: "change-1",
    initialProposalDigest: proposalDigest,
    initialProposalRevision: proposalRevision,
    events,
    machine: machineForTests(),
    evidence,
  });
  assert.equal(projection.state, "draft");
  assert.equal(projection.changeDigest, amendedDigest);
  assert.equal(projection.review, undefined);
  assert.equal(projection.history.reviews.length, 1);

  let staleEvents = events;
  staleEvents = event(staleEvents, "TRANSITION", { type: "START" });
  assert.throws(
    () =>
      replayLifecycle({
        changeId: "change-1",
        initialProposalDigest: proposalDigest,
        initialProposalRevision: proposalRevision,
        events: staleEvents,
        machine: machineForTests(),
        evidence,
      }),
    /current approval|start requires|approved|transition/,
  );
});

test("event creation refuses a hand-edited digest", () => {
  assert.throws(
    () =>
      createDesignChangeEvent({
        changeId: "change-1",
        sequence: 0,
        previousEventDigest: proposalDigest,
        recordedAt: "2026-09-21T00:00:00.000Z",
        kind: "TRANSITION",
        payload: { type: "APPROVE" },
        eventDigest: "0".repeat(64) as Digest,
      }),
    /digest/,
  );
});

test("does not admit review evidence without an independently resolved proposal revision", () => {
  const events = event([], "REVIEW", { type: "REVIEW", reviewId: "review-1" });
  assert.throws(
    () =>
      replayLifecycle({
        changeId: "change-1",
        initialProposalDigest: proposalDigest,
        events,
        machine: machineForTests(),
        evidence: { reviews: { "review-1": review } },
      }),
    /stale or belongs to another Change Set/,
  );
});
