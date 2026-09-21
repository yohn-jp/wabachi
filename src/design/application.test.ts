import assert from "node:assert/strict";
import test from "node:test";
import { createActor } from "xstate";

import { createArchitectureDocument } from "../architecture/canon/document.js";
import { architectureCanonDigest, diffArchitectureDocuments } from "./change/diff.js";
import { digestJson } from "./digest.js";
import { createDesignReviewEvidence } from "./review/codec.js";
import { DesignReviewService } from "./review/service.js";
import type {
  DesignChangeSet,
  DesignIntentLifecycleRecord,
  DesignReviewEvidence,
  ImplementationLink,
  MachineTransitionContext,
  MachineTransitionEvent,
} from "./contracts.js";
import type { DesignIntentPorts } from "./ports.js";
import { DesignApplicationError, createDesignApplication } from "./application.js";
import { createDesignChangeLifecycleMachine } from "./lifecycle/machine.js";

const revision = "a".repeat(40);

function fixture() {
  const document = createArchitectureDocument({ documentId: "application-test", root: { id: "architecture" } });
  const target = createArchitectureDocument({
    documentId: "application-test",
    root: { id: "architecture" },
    elements: [{ id: "application", kind: "service" }],
  });
  const canonDigest = architectureCanonDigest(document);
  const payload = {
    contractVersion: 1 as const,
    changeId: "change-application-test",
    base: { repositoryRevision: revision, canonVersion: 1 as const, canonDigest },
    target: {
      canonVersion: 1 as const,
      operations: diffArchitectureDocuments(document, target),
      targetCanonDigest: architectureCanonDigest(target),
    },
  };
  let change: DesignChangeSet | undefined;
  let lifecycle: DesignIntentLifecycleRecord | undefined;
  const reviews: DesignReviewEvidence[] = [];
  const links: ImplementationLink[] = [];
  let commits = 0;
  let transactionCommits = 0;
  const machine = {
    initialState() {
      const actor = createActor(createDesignChangeLifecycleMachine(), { input: undefined });
      actor.start();
      const state = actor.getSnapshot().value;
      actor.stop();
      return state as DesignIntentLifecycleRecord["state"];
    },
    transition(
      state: DesignIntentLifecycleRecord["state"],
      event: MachineTransitionEvent,
      context: MachineTransitionContext,
    ) {
      const input = {
        changeId: context.changeId,
        changeDigest: context.proposalDigest,
        ...(context.proposalRevision === undefined ? {} : { proposalRevision: context.proposalRevision }),
        ...(context.review === undefined ? {} : { review: context.review }),
        implementations: context.implementations,
        ...(context.certification === undefined ? {} : { certification: context.certification }),
        initialState: state,
      };
      const actor = createActor(createDesignChangeLifecycleMachine(input as never), { input: input as never });
      actor.start();
      actor.send({ type: event.type as never });
      const snapshot = actor.getSnapshot();
      actor.stop();
      if (snapshot.context.lastError !== undefined) throw new Error("illegal lifecycle transition");
      return snapshot.value as DesignIntentLifecycleRecord["state"];
    },
  };
  const transaction = {
    async commit(input: {
      implementation?: ImplementationLink;
      certification?: DesignIntentLifecycleRecord["certification"];
      lifecycle?: DesignIntentLifecycleRecord;
    }) {
      if (input.implementation !== undefined) links.push(input.implementation);
      if (input.lifecycle !== undefined) lifecycle = input.lifecycle;
      if (input.certification !== undefined && lifecycle !== undefined) {
        lifecycle = { ...lifecycle, certification: input.certification };
      }
      transactionCommits += 1;
      commits += 1;
    },
  };
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
      async apply() {
        return target;
      },
    },
    changeStore: {
      async read() {
        return change;
      },
      async write(next) {
        change = next;
        commits += 1;
      },
    },
    reviews: {
      async list() {
        return reviews;
      },
      async record(evidence) {
        reviews.push(evidence);
        commits += 1;
      },
    },
    implementations: {
      async list() {
        return links;
      },
      async record(link) {
        links.push(link);
        commits += 1;
      },
    },
    certification: {
      async read() {
        return lifecycle?.certification;
      },
      async record(evidence) {
        lifecycle = lifecycle === undefined ? undefined : { ...lifecycle, certification: evidence };
        commits += 1;
      },
    },
    lifecycle: {
      async read() {
        return lifecycle;
      },
      async write(next) {
        lifecycle = next;
        commits += 1;
      },
    },
  };
  const reviewService = new DesignReviewService(ports, {
    proposalRevisions: {
      async read() {
        return change;
      },
    },
  });
  return {
    ports,
    payload,
    target,
    reviews,
    links,
    reviewService,
    machine,
    transaction,
    get change() {
      return change;
    },
    get lifecycle() {
      return lifecycle;
    },
    get commits() {
      return commits;
    },
    get transactionCommits() {
      return transactionCommits;
    },
  };
}

function reviewFor(change: DesignChangeSet): DesignReviewEvidence {
  return createDesignReviewEvidence({
    reviewId: "review-application-test",
    changeId: change.changeId,
    proposalDigest: change.digest,
    proposalRevision: revision,
    decision: "approved",
    actor: "architect",
    reason: "approved",
    timestamp: "2026-09-21T00:00:00.000Z",
    evidence: [],
  });
}

test("certification rejects caller-created final evidence before any store write", async () => {
  const state = fixture();
  const app = createDesignApplication(state.ports, { review: state.reviewService, machine: state.machine });
  const change = await app.create(state.payload);
  await app.submit(change.changeId);
  await app.review(reviewFor(change));
  await app.start(change.changeId);
  const before = state.commits;
  await assert.rejects(
    app.certify({
      changeId: change.changeId,
      implementationRevision: { repository: "repo", revision },
      result: "match",
      checks: [{ checkId: "fake", result: "match" }],
    } as never),
    (error: unknown) => error instanceof DesignApplicationError && error.code === "invalid-evidence",
  );
  assert.equal(state.commits, before);
});

test("production certification chain derives a result and records it atomically after lifecycle guards", async () => {
  const state = fixture();
  const app = createDesignApplication(state.ports, {
    review: state.reviewService,
    machine: state.machine,
    transaction: state.transaction,
  });
  const change = await app.create(state.payload);
  await app.submit(change.changeId);
  await app.review(reviewFor(change));
  await app.start(change.changeId);
  const targetEntryKey = change.target.operations[0].entryKey;
  const implementation = { repositoryHost: "github.com", repositoryId: "1335559861", number: 224 };
  const beforeLinkTransactions = state.transactionCommits;
  await app.link({
    linkId: "link-application-test",
    changeId: change.changeId,
    changeDigest: change.digest,
    implementation,
    targetEntryKeys: [targetEntryKey],
  });
  assert.equal(state.transactionCommits, beforeLinkTransactions + 1);
  const beforeCertificationTransactions = state.transactionCommits;
  const certified = await app.certify({
    changeId: change.changeId,
    implementationRevision: { repository: "repo", revision },
    repositoryEvidence: {
      repository: { repository: "repo", revision },
      tree: { paths: [], complete: true },
      factsComplete: true,
    },
    completionEvidence: [
      {
        evidenceId: "completion",
        changeId: change.changeId,
        changeDigest: change.digest,
        implementation,
        implementationRevision: { repository: "repo", revision },
        result: "match",
      },
    ],
    implementationSubject: [{ path: "src/design/application.ts", mode: "100644", objectId: "b".repeat(40) }],
    humanReviews: [
      {
        reviewId: "cert-review",
        changeId: change.changeId,
        changeDigest: change.digest,
        implementationRevision: { repository: "repo", revision },
        checks: [{ checkId: `design:${targetEntryKey}`, targetEntryKey, result: "match" }],
      },
    ],
    recordedAt: "2026-09-21T00:00:00.000Z",
  });
  assert.equal(state.transactionCommits, beforeCertificationTransactions + 1);
  assert.equal(certified.state, "certification-review");
  assert.equal(certified.certification?.result, "match", JSON.stringify(certified.certification?.checks));
});

test("promotion delegates to the production promotion service without local lifecycle writes", async () => {
  const state = fixture();
  const calls: unknown[] = [];
  const app = createDesignApplication(state.ports, {
    machine: state.machine,
    promotion: {
      async promote(input) {
        calls.push(input);
        return { ok: true, idempotent: false, receipt: {} } as never;
      },
    },
  });
  const change = await app.create(state.payload);
  const before = state.commits;
  await assert.rejects(app.promote(change.changeId));
  assert.equal(calls.length, 0);
  assert.equal(state.commits, before);
});

test("stale lifecycle reads fail closed without retrying the write", async () => {
  const state = fixture();
  const app = createDesignApplication(state.ports, { machine: state.machine });
  const change = await app.create(state.payload);
  state.ports.lifecycle.read = async () => ({
    changeId: change.changeId,
    changeDigest: digestJson({ stale: true }),
    state: "draft",
    implementations: [],
  });
  const before = state.commits;
  await assert.rejects(
    app.submit(change.changeId),
    (error: unknown) => error instanceof DesignApplicationError && error.code === "stale-lifecycle",
  );
  assert.equal(state.commits, before);
});
