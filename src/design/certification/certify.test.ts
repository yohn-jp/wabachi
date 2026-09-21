import assert from "node:assert/strict";
import test from "node:test";

import { digestJson, type Digest } from "../digest.js";
import type { CertificationCheck, ImplementationLink } from "../contracts.js";
import type { SemanticEntryKey } from "../entry-key.js";
import {
  aggregateCertification,
  checkCertificationFreshness,
  type CertificationAggregationInput,
  type CertificationProofPlanLike,
  type GitImplementationSubject,
} from "./certify.js";

const digest = "a".repeat(64) as Digest;
const target = '["element","target"]' as SemanticEntryKey;
const implementation = { repositoryHost: "github.com", repositoryId: "repo-1", number: 17 } as const;
const revision = { repository: "github.com/acme/project", revision: "commit-1" } as const;
const subject: GitImplementationSubject = { path: "src/feature.ts", mode: "100644", objectId: "object-1" };

function plan(
  obligations = [
    { id: "canon", mode: "machine" as const },
    { id: "intent", mode: "review" as const, targetEntryKey: target },
  ],
): CertificationProofPlanLike {
  return {
    planVersion: 1,
    changeId: "change-1",
    changeDigest: digest,
    targetCanonDigest: digest,
    implementationRevision: revision,
    obligations,
  };
}

function link(): ImplementationLink {
  return {
    linkId: "link-1",
    changeId: "change-1",
    changeDigest: digest,
    implementation,
    targetEntryKeys: [target],
  };
}

function input(overrides: Partial<CertificationAggregationInput> = {}): CertificationAggregationInput {
  return {
    plan: plan(),
    implementationLinks: [link()],
    implementationSubject: [subject],
    machineChecks: [{ checkId: "canon", result: "match" }],
    humanReviews: [
      {
        reviewId: "review-1",
        changeId: "change-1",
        changeDigest: digest,
        implementationRevision: revision,
        checks: [{ checkId: "intent", targetEntryKey: target, result: "match" }],
      },
    ],
    ...overrides,
  };
}

test("aggregates complete machine and bound human proof and persists freshness digests", () => {
  const result = aggregateCertification(input({ recordedAt: "2026-09-21T00:00:00.000Z" }));

  assert.equal(result.result, "match");
  assert.equal(result.evidence.changeDigest, digest);
  assert.equal(result.evidence.implementationRevision.revision, "commit-1");
  assert.equal(result.evidence.targetCanonDigest, digest);
  assert.equal(result.evidence.linkageDigest, digestJson([link()]));
  assert.equal(result.evidence.implementationSubject.length, 1);
  assert.equal(result.evidence.checkerDigest, digestJson(result.checks));
});

test("a human review cannot override a machine mismatch", () => {
  const result = aggregateCertification(
    input({ machineChecks: [{ checkId: "canon", result: "mismatch", detail: "invalid" }] }),
  );
  assert.equal(result.result, "mismatch");
});

test("missing, duplicate, and unexpected proof results remain unresolved", () => {
  const missing = aggregateCertification(input({ machineChecks: [] }));
  assert.equal(missing.result, "unresolved");

  const duplicate = aggregateCertification(
    input({
      machineChecks: [
        { checkId: "canon", result: "match" },
        { checkId: "canon", result: "match" },
      ],
    }),
  );
  assert.equal(duplicate.result, "unresolved");

  const unexpected = aggregateCertification(
    input({
      machineChecks: [
        { checkId: "canon", result: "match" },
        { checkId: "other", result: "match" },
      ],
    }),
  );
  assert.equal(unexpected.result, "unresolved");
});

test("human evidence must bind the same proposal and implementation revision", () => {
  const result = aggregateCertification(
    input({
      humanReviews: [
        {
          reviewId: "review-stale",
          changeId: "change-1",
          changeDigest: "b".repeat(64) as Digest,
          implementationRevision: revision,
          checks: [{ checkId: "intent", targetEntryKey: target, result: "match" }],
        },
      ],
    }),
  );
  assert.equal(result.result, "unresolved");
});

test("source, mode, and lockfile changes stale certification while record-only changes are explainable", () => {
  const evidence = aggregateCertification(input()).evidence;
  assert.equal(checkCertificationFreshness({ certification: evidence, changedPaths: ["src/feature.ts"] }).stale, true);
  assert.equal(checkCertificationFreshness({ certification: evidence, changedPaths: ["package.json"] }).stale, true);
  assert.equal(checkCertificationFreshness({ certification: evidence, changedPaths: ["pnpm-lock.yaml"] }).stale, true);
  const recordOnly = checkCertificationFreshness({
    certification: evidence,
    changedPaths: ["records/review.json"],
  });
  assert.equal(recordOnly.stale, false);
  assert.equal(recordOnly.explainable, true);
});

test("freshness never replaces the originally tested implementation revision", () => {
  const evidence = aggregateCertification(input()).evidence;
  assert.equal(evidence.implementationRevision.revision, "commit-1");
  const freshness = checkCertificationFreshness({
    certification: evidence,
    currentImplementationRevision: { ...revision, revision: "later-head" },
  });
  assert.equal(freshness.stale, true);
  assert.equal(evidence.implementationRevision.revision, "commit-1");
});

test("implementation subject digest is the Git tree subject, never the Issue linkage", () => {
  const baseline = aggregateCertification(input()).evidence;
  const changedIssue = aggregateCertification(
    input({
      implementationLinks: [
        {
          ...link(),
          implementation: { ...implementation, number: 99 },
        },
      ],
      implementationSubject: [subject],
    }),
  ).evidence;
  assert.equal(changedIssue.implementationSubjectDigest, baseline.implementationSubjectDigest);
  assert.notEqual(changedIssue.linkageDigest, baseline.linkageDigest);
});

test("missing Git implementation subject cannot produce a successful certification", () => {
  const result = aggregateCertification(input({ implementationSubject: undefined }));
  assert.equal(result.result, "unresolved");
  assert.ok(result.checks.some((entry) => entry.checkId === "implementation-subject-binding"));
});

test("malformed Git implementation subject fails closed", () => {
  const result = aggregateCertification(input({ implementationSubject: [null as never] }));
  assert.equal(result.result, "unresolved");
  assert.ok(result.checks.some((entry) => entry.checkId === "implementation-subject-binding"));
});
