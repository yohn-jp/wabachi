import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDIDATE_WORKING_SET_SCHEMA_VERSION,
  createCandidateWorkingSet,
  validateCandidateWorkingSet,
} from "./model.js";

const revision = "0123456789abcdef0123456789abcdef01234567";

function entry(
  state: "required" | "supporting" | "verification" | "unresolved",
  kind: "file" | "symbol" | "test" | "unresolved",
  locator: string,
) {
  return {
    state,
    target: { kind, locator },
    reason: { id: `${state}-reason`, summary: `${state} context` },
    evidence: [{ artifact: "provider-evidence", reference: `${state}:1` }],
  } as const;
}

test("creates a versioned, repository-bound model with semantic states intact", () => {
  const workingSet = createCandidateWorkingSet({
    workingSetId: "ws-137",
    repository: {
      repositoryHost: "github.com",
      repositoryId: "1335559861",
      repository: "yohn-jp/wabachi",
    },
    revision,
    entries: [
      entry("unresolved", "unresolved", "missing mapping"),
      entry("supporting", "file", "src/supporting.ts"),
      entry("verification", "test", "src/working-set/codec.test.ts"),
      entry("required", "file", "src/required.ts"),
    ],
  });

  assert.equal(workingSet.schemaVersion, CANDIDATE_WORKING_SET_SCHEMA_VERSION);
  assert.equal(workingSet.kind, "candidate-working-set");
  assert.equal(workingSet.repository.repository, "yohn-jp/wabachi");
  assert.deepEqual(
    workingSet.entries.map(({ state }) => state),
    ["required", "supporting", "verification", "unresolved"],
  );
  assert.equal(workingSet.entries[3].target.kind, "unresolved");
  assert.notEqual(workingSet.entries[3].target.kind, "file");
  assert.equal(Object.isFrozen(workingSet), true);
  assert.equal(Object.isFrozen(workingSet.entries), true);
});

test("does not accept a mutable ref or a state/target mismatch", () => {
  assert.throws(
    () =>
      createCandidateWorkingSet({
        workingSetId: "ws-137",
        repository: { repositoryHost: "github.com", repositoryId: "1", repository: "owner/repo" },
        revision: "main",
        entries: [],
      }),
    /immutable hexadecimal revision/,
  );

  assert.throws(
    () =>
      createCandidateWorkingSet({
        workingSetId: "ws-137",
        repository: { repositoryHost: "github.com", repositoryId: "1", repository: "owner/repo" },
        revision,
        entries: [entry("unresolved", "file", "src/guessed.ts")],
      }),
    /unresolved target/,
  );
});

test("unknown versions and malformed serialized shapes fail closed", () => {
  assert.throws(
    () =>
      validateCandidateWorkingSet({
        kind: "candidate-working-set",
        schemaVersion: 2,
        workingSetId: "ws-137",
        repository: { repositoryHost: "github.com", repositoryId: "1", repository: "owner/repo" },
        revision,
        entries: [],
      }),
    /schema version is unsupported/,
  );

  assert.throws(
    () =>
      validateCandidateWorkingSet({
        kind: "candidate-working-set",
        schemaVersion: 1,
        workingSetId: "ws-137",
        repository: { repositoryHost: "github.com", repositoryId: "1", repository: "owner/repo" },
        revision,
        entries: [{ state: "required" }],
      }),
    /working-set entry must be an object|entry target must be an object/,
  );
});
