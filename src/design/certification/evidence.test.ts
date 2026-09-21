import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFacts, type FactEnvelope } from "../../runtime/facts.js";
import type { FactObservation } from "../../runtime/facts.js";
import type { ProviderIdentity } from "../../runtime/provider.js";
import { admitRepositoryEvidence } from "./evidence.js";

const repository = { source: "https://example.test/wabachi.git", commitSha: "a".repeat(40) };
const revision = { repository: repository.source, revision: repository.commitSha };
const provider: ProviderIdentity = { id: "typescript", version: "6.0.3", determinism: "deterministic" };

function fact(predicate: FactObservation["predicate"], object: FactObservation["object"]): FactEnvelope {
  const result = normalizeFacts([
    {
      schemaVersion: 1,
      subject: { id: "source", kind: "function" },
      predicate,
      object,
      provider,
      repository,
      source: { path: "src/source.ts", span: "L1" },
      determinism: provider.determinism,
      providerNative: { predicate },
    },
  ]);
  const value = result.facts[0];
  assert.ok(value);
  return value;
}

test("admits only fact evidence bound to the requested revision and provider", () => {
  const accepted = admitRepositoryEvidence({
    repository: revision,
    provider,
    facts: [fact("references", { value: "src/target.ts" })],
    factsComplete: true,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.facts.length, 1);

  const stale = admitRepositoryEvidence({
    repository: { ...revision, revision: "b".repeat(40) },
    provider,
    facts: [fact("references", { value: "src/target.ts" })],
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.facts.length, 0);
  assert.equal(stale.rejectedFacts[0]?.reason, "repository-mismatch");

  const otherProvider = admitRepositoryEvidence({
    repository: revision,
    provider: { ...provider, id: "scip" },
    facts: [fact("references", { value: "src/target.ts" })],
  });
  assert.equal(otherProvider.accepted, false);
  assert.equal(otherProvider.rejectedFacts[0]?.reason, "provider-mismatch");
});

test("keeps missing tree paths unresolved when the tree is partial", () => {
  const evidence = admitRepositoryEvidence({
    repository: revision,
    tree: { paths: ["src/other.ts"], complete: false },
  });
  assert.equal(evidence.treeCompleteness, "partial");
  assert.deepEqual(evidence.treePaths, ["src/other.ts"]);
});

test("does not infer complete coverage from bare tree observations", () => {
  const tree = admitRepositoryEvidence({
    repository: revision,
    tree: ["src/other.ts"],
  });
  const treePaths = admitRepositoryEvidence({
    repository: revision,
    treePaths: ["src/other.ts"],
  });
  assert.equal(tree.treeCompleteness, "partial");
  assert.equal(treePaths.treeCompleteness, "partial");
});

test("does not admit a result-shaped record without repository evidence", () => {
  const forged = admitRepositoryEvidence({
    accepted: true,
    repository: revision,
    providers: [provider],
    facts: [],
    rejectedFacts: [],
    factsCompleteness: "complete",
    reasons: [],
  });
  assert.equal(forged.accepted, false);
  assert.match(forged.reasons.join("; "), /repository evidence is required/);
});
