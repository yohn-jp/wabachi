import assert from "node:assert/strict";
import test from "node:test";
import { createActor } from "xstate";
import { tsImport } from "tsx/esm/api";

const importTypeScript = (specifier) =>
  tsImport(new URL(specifier, import.meta.url).href, { parentURL: import.meta.url });

const [
  { createArchitectureDocument },
  { architectureCanonDigest, createDesignChangeSet, diffArchitectureDocuments },
  { applyDesignChange },
  { digestJson },
  { createDesignChangeLifecycleMachine },
  { appendLifecycleEvent, replayLifecycle },
  { createDesignReviewEvidence },
  { deriveCertificationProofPlan, resolveCertificationProof },
  { runMachineChecks },
  { aggregateCertification },
  { preflightPromotion },
] = await Promise.all([
  importTypeScript("../src/architecture/canon/document.ts"),
  importTypeScript("../src/design/change/diff.ts"),
  importTypeScript("../src/design/change/apply.ts"),
  importTypeScript("../src/design/digest.ts"),
  importTypeScript("../src/design/lifecycle/machine.ts"),
  importTypeScript("../src/design/lifecycle/record.ts"),
  importTypeScript("../src/design/review/codec.ts"),
  importTypeScript("../src/design/certification/plan.ts"),
  importTypeScript("../src/design/certification/machine-checks.ts"),
  importTypeScript("../src/design/certification/certify.ts"),
  importTypeScript("../src/design/promotion/plan.ts"),
]);

const timestamp = "2026-09-21T00:00:00.000Z";
const implementationRevision = {
  repository: "github.com/yohn-jp/wabachi",
  revision: "b".repeat(40),
};

function documents() {
  const base = createArchitectureDocument({
    documentId: "wave-1a-composition",
    root: { id: "architecture" },
  });
  const target = createArchitectureDocument({
    documentId: "wave-1a-composition",
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service" }],
  });
  return { base, target };
}

function changeFor(base, target) {
  return createDesignChangeSet({
    changeId: "wave-1a-composition",
    base: {
      repositoryRevision: "a".repeat(40),
      canonVersion: 1,
      canonDigest: architectureCanonDigest(base),
    },
    baseCanon: base,
    targetCanon: target,
  });
}

test("Wave 1A production composition connects diff/apply, lifecycle replay/amend, certification, and promotion", () => {
  const { base, target } = documents();
  const change = changeFor(base, target);

  const operations = diffArchitectureDocuments(base, target);
  assert.ok(operations.length > 0);
  assert.deepEqual(applyDesignChange(change, base), target);

  const review = createDesignReviewEvidence({
    reviewId: "wave-1a-review",
    changeId: change.changeId,
    proposalDigest: change.digest,
    proposalRevision: "a".repeat(40),
    decision: "approved",
    actor: "wave-1a-test-reviewer",
    reason: "composition proof",
    timestamp,
    evidence: [],
  });
  const amendedDigest = digestJson({ changeId: change.changeId, amendment: 1 });
  const machine = ({ state, event, context }) => {
    const input = {
      changeId: context.changeId,
      changeDigest: context.proposalDigest,
      proposalRevision: context.proposalRevision,
      review: context.review,
      implementations: context.implementations,
      certification: context.certification,
      initialState: state,
    };
    const actor = createActor(createDesignChangeLifecycleMachine(input), { input });
    actor.start();
    actor.send({ type: event.kind === "REVIEW" ? "SUBMIT_FOR_DESIGN_REVIEW" : "AMEND" });
    const nextState = actor.getSnapshot().value;
    actor.stop();
    return nextState;
  };
  const reviewed = appendLifecycleEvent([], {
    changeId: change.changeId,
    kind: "REVIEW",
    payload: { review },
    recordedAt: timestamp,
    initialProposalDigest: change.digest,
  });
  const amended = appendLifecycleEvent(reviewed, {
    changeId: change.changeId,
    kind: "AMEND",
    payload: { proposalDigest: amendedDigest, proposalRevision: "c".repeat(40) },
    recordedAt: timestamp,
    initialProposalDigest: change.digest,
  });
  const projection = replayLifecycle({
    changeId: change.changeId,
    initialProposalDigest: change.digest,
    initialProposalRevision: "a".repeat(40),
    events: amended,
    machine: { transition: machine },
  });
  assert.equal(projection.state, "draft");
  assert.equal(projection.changeDigest, amendedDigest);
  assert.equal(projection.review, undefined);

  const plan = deriveCertificationProofPlan({
    change,
    canon: target,
    implementationRevision,
  });
  const machineResult = runMachineChecks({
    document: target,
    evidence: {
      repository: implementationRevision,
      tree: { paths: [], complete: true },
      factsComplete: true,
    },
  });
  assert.equal(machineResult.result, "match");
  const proofResolution = resolveCertificationProof(plan, machineResult.checks);
  assert.equal(proofResolution.result, "unresolved");

  const targetEntryKey = change.target.operations[0].entryKey;
  const implementationLink = {
    linkId: "wave-1a-link",
    changeId: change.changeId,
    changeDigest: change.digest,
    implementation: { repositoryHost: "github.com", repositoryId: "1335559861", number: 258 },
    targetEntryKeys: [targetEntryKey],
  };
  const certification = aggregateCertification({
    plan,
    change,
    targetCanon: target,
    implementationLinks: [implementationLink],
    implementationSubject: [{ path: "src/design", mode: "100644", objectId: "d".repeat(40) }],
    machineChecks: plan.obligations
      .filter((obligation) => obligation.mode === "machine")
      .map((obligation) => ({ checkId: obligation.id, result: "match" })),
    humanReviews: [
      {
        reviewId: review.reviewId,
        changeId: change.changeId,
        changeDigest: change.digest,
        implementationRevision,
        checks: [{ checkId: `design:${targetEntryKey}`, targetEntryKey, result: "match" }],
      },
    ],
    recordedAt: timestamp,
  });
  assert.equal(certification.result, "match");

  const promotion = preflightPromotion({
    current: {
      revision: {
        repositoryRevision: "a".repeat(40),
        canonVersion: 1,
        canonDigest: architectureCanonDigest(base),
      },
      document: base,
    },
    change,
    lifecycle: {
      changeId: change.changeId,
      changeDigest: change.digest,
      state: "certification-review",
      review,
      implementations: [implementationLink],
      certification: certification.evidence,
    },
    certifiedTarget: target,
    promotionTransition: { state: "promoted" },
    implementationRevision,
  });
  assert.equal(promotion.ok, true);
  if (promotion.ok) assert.equal(promotion.plan.nextLifecycle.state, "promoted");
});
