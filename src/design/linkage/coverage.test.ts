import assert from "node:assert/strict";
import test from "node:test";

import type {
  DesignChangeSet,
  ExternalIssueReference,
  ImplementationLink,
  RepositoryRevisionReference,
} from "../contracts.js";
import type { Digest } from "../digest.js";
import { createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";
import { evaluateCoverage, evaluateTargetCoverage, type ImplementationCompletionEvidence } from "./coverage.js";

const digest = "a".repeat(64) as Digest;
const otherDigest = "b".repeat(64) as Digest;
const keyA = createSemanticEntryKey({ collection: "element", identity: ["a"] });
const keyB = createSemanticEntryKey({ collection: "element", identity: ["b"] });
const keyC = createSemanticEntryKey({ collection: "element", identity: ["c"] });

function change(keys: readonly SemanticEntryKey[] = [keyA, keyB]): DesignChangeSet {
  return {
    contractVersion: 1,
    changeId: "change-1",
    base: { repositoryRevision: "base", canonVersion: 1, canonDigest: digest },
    target: {
      canonVersion: 1,
      operations: keys.map((entryKey) => ({ kind: "added" as const, entryKey, value: { id: entryKey } })),
      targetCanonDigest: digest,
    },
    digest,
  };
}

function implementation(number: number, repository?: string): ExternalIssueReference {
  return { repositoryHost: "github.com", repositoryId: "repo-1", repository, number };
}

function link(
  current: DesignChangeSet,
  linkId: string,
  external: ExternalIssueReference,
  targetEntryKeys: readonly SemanticEntryKey[],
  changeDigest = current.digest,
): ImplementationLink {
  return {
    linkId,
    changeId: current.changeId,
    changeDigest,
    implementation: external,
    targetEntryKeys,
  };
}

function completion(
  current: DesignChangeSet,
  evidenceId: string,
  external: ExternalIssueReference,
  revision: RepositoryRevisionReference,
  result: "match" | "mismatch" | "unresolved" = "match",
): ImplementationCompletionEvidence {
  return {
    evidenceId,
    changeId: current.changeId,
    changeDigest: current.digest,
    implementation: external,
    implementationRevision: revision,
    result,
  };
}

test("reports a missing proposed target as incomplete", () => {
  const current = change();
  const result = evaluateTargetCoverage(current, [link(current, "link-a", implementation(1), [keyA])]);

  assert.deepEqual(result.coveredEntryKeys, [keyA]);
  assert.deepEqual(result.missingEntryKeys, [keyB]);
  assert.equal(
    result.findings.some((finding) => finding.kind === "missing-target" && finding.targetEntryKey === keyB),
    true,
  );
});

test("supports one implementation covering many targets and many implementations sharing one target", async () => {
  const current = change([keyA, keyB, keyC]);
  const first = implementation(1, "owner/locator-one");
  const second = implementation(2, "owner/locator-two");
  const revision = { repository: "repo", revision: "leaf" };
  const result = await evaluateCoverage({
    change: current,
    links: [link(current, "link-a", first, [keyA, keyB]), link(current, "link-b", second, [keyB, keyC])],
    completionEvidence: [
      completion(current, "evidence-a", first, revision),
      completion(current, "evidence-b", second, revision),
    ],
  });

  assert.equal(result.complete, true);
  assert.equal(result.result, "match");
  assert.deepEqual(result.coveredEntryKeys, [keyA, keyB, keyC]);
});

test("does not treat an Issue reference without completion evidence as success", async () => {
  const current = change([keyA]);
  const result = await evaluateCoverage({
    change: current,
    links: [link(current, "link-a", implementation(1), [keyA])],
  });

  assert.equal(result.complete, false);
  assert.equal(result.coveredEntryKeys.length, 0);
  assert.equal(
    result.findings.some((finding) => finding.kind === "missing-completion-evidence"),
    true,
  );
});

test("stale links and unknown targets never contribute to coverage", async () => {
  const current = change([keyA]);
  const stale = link(current, "stale", implementation(1), [keyA], otherDigest);
  const unknown = link(current, "unknown", implementation(2), [keyC]);
  const result = await evaluateCoverage({
    change: current,
    links: [stale, unknown],
    completionEvidence: [
      completion(current, "evidence-a", stale.implementation, { repository: "repo", revision: "leaf" }),
    ],
  });

  assert.equal(result.complete, false);
  assert.deepEqual(result.staleLinkIds, ["stale"]);
  assert.deepEqual(result.unknownEntryKeys, [keyC]);
  assert.deepEqual(result.coveredEntryKeys, []);
});

test("requires GitPort ancestry when completed leaves differ", async () => {
  const current = change([keyA, keyB]);
  const first = implementation(1);
  const second = implementation(2);
  const firstRevision = { repository: "repo", revision: "leaf-a" };
  const secondRevision = { repository: "repo", revision: "leaf-b" };
  const integrationRevision = { repository: "repo", revision: "integration" };
  let ancestryChecks = 0;
  const git = {
    isAncestor(ancestor: RepositoryRevisionReference, descendant: RepositoryRevisionReference): Promise<boolean> {
      ancestryChecks += 1;
      return Promise.resolve(descendant.revision === "integration" && ancestor.repository === descendant.repository);
    },
  };

  const withoutIntegration = await evaluateCoverage({
    change: current,
    links: [link(current, "link-a", first, [keyA]), link(current, "link-b", second, [keyB])],
    completionEvidence: [
      completion(current, "evidence-a", first, firstRevision),
      completion(current, "evidence-b", second, secondRevision),
    ],
  });
  assert.equal(withoutIntegration.complete, false);
  assert.equal(
    withoutIntegration.findings.some((finding) => finding.kind === "non-integrated-revision"),
    true,
  );

  const integrated = await evaluateCoverage({
    change: current,
    links: [link(current, "link-a", first, [keyA]), link(current, "link-b", second, [keyB])],
    completionEvidence: [
      completion(current, "evidence-a", first, firstRevision),
      completion(current, "evidence-b", second, secondRevision),
    ],
    integrationRevision,
    git,
  });
  assert.equal(integrated.complete, true);
  assert.equal(ancestryChecks, 2);
});

test("a failed completion proof remains unresolved even when target links are complete", async () => {
  const current = change([keyA]);
  const external = implementation(1);
  const result = await evaluateCoverage({
    change: current,
    links: [link(current, "link-a", external, [keyA])],
    completionEvidence: [
      completion(current, "evidence-a", external, { repository: "repo", revision: "leaf" }, "unresolved"),
    ],
  });

  assert.equal(result.complete, false);
  assert.equal(result.result, "unresolved");
  assert.deepEqual(result.missingEntryKeys, [keyA]);
});
