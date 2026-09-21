import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createActor } from "xstate";
import { tsImport } from "tsx/esm/api";

const importTypeScript = (specifier) =>
  tsImport(new URL(specifier, import.meta.url).href, { parentURL: import.meta.url });

const [
  { createArchitectureDocument },
  { architectureCanonDigest, createDesignChangeSet, diffArchitectureDocuments },
  { applyDesignChange },
  { canonicalizeJson },
  { createDesignChangeLifecycleMachine },
  { appendLifecycleEvent, replayLifecycle },
  { createDesignReviewEvidence },
  { createDesignApplication },
  { DesignReviewService },
  { DesignPromotionService },
  { serializeCanonicalArchitectureDocument },
] = await Promise.all([
  importTypeScript("../src/architecture/canon/document.ts"),
  importTypeScript("../src/design/change/diff.ts"),
  importTypeScript("../src/design/change/apply.ts"),
  importTypeScript("../src/design/digest.ts"),
  importTypeScript("../src/design/lifecycle/machine.ts"),
  importTypeScript("../src/design/lifecycle/record.ts"),
  importTypeScript("../src/design/review/codec.ts"),
  importTypeScript("../src/design/application.ts"),
  importTypeScript("../src/design/review/service.ts"),
  importTypeScript("../src/design/promotion/service.ts"),
  importTypeScript("../src/architecture/canon/codec.ts"),
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
  const amendedTarget = createArchitectureDocument({
    documentId: "wave-1a-composition",
    root: { id: "architecture" },
    elements: [
      { id: "orders", kind: "service" },
      { id: "payments", kind: "service" },
    ],
  });
  return { base, target, amendedTarget };
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

function bytesOf(value) {
  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function artifact(value, bytes) {
  return {
    value,
    bytes,
    byteDigest: createHash("sha256").update(bytesOf(bytes)).digest("hex"),
  };
}

function lifecycleMachine() {
  return {
    initialState() {
      const actor = createActor(createDesignChangeLifecycleMachine(), { input: undefined });
      actor.start();
      const state = actor.getSnapshot().value;
      actor.stop();
      return state;
    },
    transition(request) {
      const { state, event, context } = request;
      const input = {
        changeId: context.changeId,
        changeDigest: context.proposalDigest,
        ...(context.proposalRevision === undefined ? {} : { proposalRevision: context.proposalRevision }),
        ...(context.review === undefined ? {} : { review: context.review }),
        implementations: context.implementations,
        ...(context.certification === undefined ? {} : { certification: context.certification }),
        initialState: state,
      };
      const actor = createActor(createDesignChangeLifecycleMachine(input), { input });
      actor.start();
      const eventType = event.type ?? (event.kind === "REVIEW" ? "SUBMIT_FOR_DESIGN_REVIEW" : event.kind);
      actor.send({ type: eventType });
      const snapshot = actor.getSnapshot();
      actor.stop();
      if (snapshot.context.lastError !== undefined) throw new Error(`XState rejected ${event.type}`);
      return snapshot.value;
    },
  };
}

test("Wave 1A production composition connects diff/apply, lifecycle replay/amend, certification, and promotion", async () => {
  const { base, target, amendedTarget } = documents();
  const initialChange = changeFor(base, target);
  const currentRevision = {
    repositoryRevision: "a".repeat(40),
    canonVersion: 1,
    canonDigest: architectureCanonDigest(base),
  };

  let change;
  let lifecycle;
  let current = base;
  let currentBytes = serializeCanonicalArchitectureDocument(base);
  let receipt;
  const reviews = [];
  const links = [];
  const lifecycleEvents = [];
  const machine = lifecycleMachine();

  const ports = {
    canon: {
      async readCurrent() {
        return { revision: { ...currentRevision, canonDigest: architectureCanonDigest(current) }, document: current };
      },
      async readAt() {
        return base;
      },
    },
    changes: {
      async apply(payload, document) {
        return applyDesignChange(payload, document);
      },
    },
    changeStore: {
      async read() {
        return change;
      },
      async write(next) {
        change = next;
      },
    },
    reviews: {
      async list() {
        return reviews;
      },
      async record(value) {
        reviews.push(value);
      },
    },
    implementations: {
      async list() {
        return links;
      },
      async record(value) {
        links.push(value);
      },
    },
    certification: {
      async read() {
        return lifecycle?.certification;
      },
      async record(value) {
        lifecycle = lifecycle === undefined ? lifecycle : { ...lifecycle, certification: value };
      },
    },
    lifecycle: {
      async read() {
        return lifecycle;
      },
      async write(value) {
        lifecycle = value;
      },
    },
  };

  const reviewService = new DesignReviewService(ports, {
    proposalRevisions: {
      async read() {
        return change;
      },
    },
    amendmentTransaction: {
      async commit(next, nextLifecycle, event) {
        change = next;
        lifecycle = nextLifecycle;
        lifecycleEvents.push(event);
      },
    },
    reviewTransaction: {
      async commit(evidence, nextLifecycle) {
        reviews.push(evidence);
        lifecycle = nextLifecycle;
      },
    },
  });

  const transaction = {
    async commit(input) {
      if (input.implementation !== undefined) links.push(input.implementation);
      if (input.lifecycle !== undefined) lifecycle = input.lifecycle;
      if (input.certification !== undefined) lifecycle = { ...lifecycle, certification: input.certification };
    },
  };

  const promotionStore = {
    async readCurrent() {
      return {
        revision: { ...currentRevision, canonDigest: architectureCanonDigest(current) },
        document: current,
        bytes: currentBytes,
      };
    },
    async readChangeArtifact() {
      if (change === undefined) return undefined;
      const bytes = canonicalizeJson(change);
      return artifact(change, bytes);
    },
    async readLifecycleArtifact() {
      if (lifecycle === undefined) return undefined;
      const bytes = canonicalizeJson(lifecycle);
      return artifact(lifecycle, bytes);
    },
    async readReceiptArtifact() {
      if (receipt === undefined) return undefined;
      const bytes = canonicalizeJson(receipt);
      return artifact(receipt, bytes);
    },
    async commit(plans) {
      const [canonPlan, lifecyclePlan, receiptPlan] = plans;
      current = amendedTarget;
      currentBytes = canonPlan.nextBytes;
      lifecycle = JSON.parse(bytesOf(lifecyclePlan.nextBytes));
      receipt = JSON.parse(bytesOf(receiptPlan.nextBytes));
      return { transactionId: "wave-1a-promotion", state: "committed" };
    },
  };

  const app = createDesignApplication(ports, {
    review: reviewService,
    transaction,
    machine,
    promotion: new DesignPromotionService(promotionStore),
  });

  const operations = diffArchitectureDocuments(base, target);
  assert.ok(operations.length > 0);
  assert.deepEqual(applyDesignChange(initialChange, base), target);

  change = await app.create({
    changeId: initialChange.changeId,
    base: currentRevision,
    baseCanon: base,
    targetCanon: target,
  });

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
  const reviewed = appendLifecycleEvent([], {
    changeId: change.changeId,
    kind: "REVIEW",
    payload: { review },
    recordedAt: timestamp,
    initialProposalDigest: change.digest,
  });

  await app.submit(change.changeId);
  await app.review(review);
  await app.start(change.changeId);
  const amendedInput = {
    changeId: change.changeId,
    base: currentRevision,
    baseCanon: base,
    targetCanon: amendedTarget,
    proposalRevision: "c".repeat(40),
  };
  change = await app.amend(change.changeId, amendedInput);
  assert.equal(lifecycleEvents.length, 1);
  assert.equal(lifecycleEvents[0].kind, "AMEND");
  const amended = appendLifecycleEvent(reviewed, {
    changeId: change.changeId,
    kind: "AMEND",
    payload: { proposalDigest: change.digest, proposalRevision: "c".repeat(40) },
    recordedAt: timestamp,
    initialProposalDigest: initialChange.digest,
  });
  const projection = replayLifecycle({
    changeId: initialChange.changeId,
    initialProposalDigest: initialChange.digest,
    initialProposalRevision: "a".repeat(40),
    events: amended,
    machine: { transition: machine.transition },
  });
  assert.equal(projection.state, "draft");
  assert.equal(projection.changeDigest, change.digest);
  assert.equal(projection.review, undefined);

  const amendedReview = createDesignReviewEvidence({
    reviewId: "wave-1a-amended-review",
    changeId: change.changeId,
    proposalDigest: change.digest,
    proposalRevision: "c".repeat(40),
    decision: "approved",
    actor: "wave-1a-test-reviewer",
    reason: "amended composition proof",
    timestamp,
    evidence: [],
  });
  await app.submit(change.changeId);
  await app.review(amendedReview);
  await app.start(change.changeId);

  const targetEntryKeys = change.target.operations.map((operation) => operation.entryKey);
  const implementationLink = {
    linkId: "wave-1a-link",
    changeId: change.changeId,
    changeDigest: change.digest,
    implementation: { repositoryHost: "github.com", repositoryId: "1335559861", number: 258 },
    targetEntryKeys,
  };
  await app.link(implementationLink);
  const certified = await app.certify({
    changeId: change.changeId,
    implementationRevision,
    repositoryEvidence: {
      repository: implementationRevision,
      tree: { paths: [], complete: true },
      factsComplete: true,
    },
    completionEvidence: [
      {
        evidenceId: "wave-1a-completion",
        changeId: change.changeId,
        changeDigest: change.digest,
        implementation: implementationLink.implementation,
        implementationRevision,
        result: "match",
      },
    ],
    implementationSubject: [{ path: "src/design", mode: "100644", objectId: "d".repeat(40) }],
    humanReviews: [
      {
        reviewId: "wave-1a-certification-review",
        changeId: change.changeId,
        changeDigest: change.digest,
        implementationRevision,
        checks: targetEntryKeys.map((targetEntryKey) => ({
          checkId: `design:${targetEntryKey}`,
          targetEntryKey,
          result: "match",
        })),
      },
    ],
    recordedAt: timestamp,
  });
  assert.equal(certified.state, "certification-review");
  assert.equal(certified.certification?.result, "match");

  const promotion = await app.promote(change.changeId);
  assert.equal(promotion.ok, true);
  assert.equal(promotion.idempotent, false);
  assert.equal(lifecycle.state, "promoted");
  assert.deepEqual(current, amendedTarget);
});
