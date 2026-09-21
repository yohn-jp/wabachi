import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesignReviewHistory,
  parseDesignReviewEvidence,
  recordDesignReviewEvidence,
  serializeDesignReviewEvidence,
  serializeDesignReviewHistory,
  validateDesignReviewEvidence,
} from "./codec.js";

const digest = "a".repeat(64);
const revision = "0123456789abcdef0123456789abcdef01234567";

const review = {
  reviewId: "review-208",
  changeId: "change-208",
  proposalDigest: digest,
  proposalRevision: revision,
  decision: "approved" as const,
  actor: "local-reviewer",
  reason: "The proposal is bounded and satisfies the Canon obligations.",
  timestamp: "2026-09-21T00:00:00+09:00",
  evidence: [{ provider: "local", reference: "reviews/208.md" }],
};

test("round-trips a local review without requiring a GitHub URL", () => {
  const serialized = serializeDesignReviewEvidence(review);
  const parsed = parseDesignReviewEvidence(serialized);

  assert.equal(parsed.proposalDigest, digest);
  assert.equal(parsed.proposalRevision, revision);
  assert.equal(parsed.timestamp, "2026-09-20T15:00:00.000Z");
  assert.deepEqual(parsed.evidence, [{ provider: "local", reference: "reviews/208.md" }]);
});

test("canonicalizes evidence ordering and rejects missing or malformed bindings", () => {
  const reordered = serializeDesignReviewEvidence({
    ...review,
    evidence: [
      { provider: "z-provider", reference: "record:2" },
      { provider: "a-provider", reference: "record:1" },
    ],
  });
  const sorted = serializeDesignReviewEvidence({
    ...review,
    evidence: [
      { provider: "a-provider", reference: "record:1" },
      { provider: "z-provider", reference: "record:2" },
    ],
  });
  assert.equal(reordered, sorted);

  assert.throws(() => validateDesignReviewEvidence({ ...review, proposalRevision: "" }), /proposal revision/u);
  assert.throws(() => validateDesignReviewEvidence({ ...review, proposalDigest: "not-a-digest" }), /proposal digest/u);
  assert.throws(() => validateDesignReviewEvidence({ ...review, decision: "pending" }), /decision is unsupported/u);
  assert.throws(() => validateDesignReviewEvidence({ ...review, reason: "   " }), /reason must not be empty/u);
  assert.throws(() => validateDesignReviewEvidence({ ...review, timestamp: "2026-02-30T00:00:00Z" }), /timestamp/u);
});

test("machine outcomes are not part of review evidence", () => {
  assert.throws(
    () => validateDesignReviewEvidence({ ...review, outcome: "certified" }),
    /contains unknown field: outcome/u,
  );
});

test("history is immutable, unique by review ID, and detects byte conflicts", () => {
  const history = createDesignReviewHistory([review]);
  const same = recordDesignReviewEvidence(history, { ...review, timestamp: "2026-09-20T15:00:00.000Z" });
  assert.equal(same.reviews.length, 1);
  assert.notEqual(same, history);

  assert.throws(
    () => recordDesignReviewEvidence(history, { ...review, reason: "A different decision basis." }),
    /conflict for review ID: review-208/u,
  );

  const serialized = serializeDesignReviewHistory(same);
  assert.deepEqual(JSON.parse(serialized).reviews, [
    {
      reviewId: "review-208",
      changeId: "change-208",
      proposalDigest: digest,
      proposalRevision: revision,
      decision: "approved",
      actor: "local-reviewer",
      reason: "The proposal is bounded and satisfies the Canon obligations.",
      timestamp: "2026-09-20T15:00:00.000Z",
      evidence: [{ provider: "local", reference: "reviews/208.md" }],
    },
  ]);
});
