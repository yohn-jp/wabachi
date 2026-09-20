import assert from "node:assert/strict";
import test from "node:test";
import { parseCandidateWorkingSet, serializeCandidateWorkingSet } from "./codec.js";

const revision = "0123456789abcdef0123456789abcdef01234567";

const base = {
  workingSetId: "ws-137",
  repository: {
    repositoryHost: "github.com",
    repositoryId: "1335559861",
    repository: "yohn-jp/wabachi",
  },
  revision,
  entries: [
    {
      state: "supporting" as const,
      target: { kind: "file" as const, locator: "src/supporting.ts" },
      reason: { id: "supporting-reason", summary: "useful context" },
      evidence: [
        { artifact: "canon", reference: "element:2" },
        { artifact: "provider-evidence", reference: "record:3" },
      ],
    },
    {
      state: "required" as const,
      target: { kind: "file" as const, locator: "src/required.ts" },
      reason: { id: "required-reason", summary: "needed context" },
      evidence: [{ artifact: "provider-evidence", reference: "record:1" }],
    },
  ],
};

test("canonical serialization is independent of entry and evidence input order", () => {
  const first = serializeCandidateWorkingSet(base);
  const second = serializeCandidateWorkingSet({
    ...base,
    entries: [...base.entries].reverse(),
  });

  assert.equal(first, second);
  assert.deepEqual(parseCandidateWorkingSet(first), parseCandidateWorkingSet(second));
  assert.match(first, /"schemaVersion":1/);
  assert.doesNotMatch(first, /providerNative|payload|authorization/);
});

test("parser rejects unknown versions and non-object JSON", () => {
  const serialized = serializeCandidateWorkingSet(base);
  const unknownVersion = serialized.replace('"schemaVersion":1', '"schemaVersion":2');

  assert.throws(() => parseCandidateWorkingSet(unknownVersion), /schema version is unsupported/);
  assert.throws(() => parseCandidateWorkingSet("[]"), /must be an object/);
  assert.throws(() => parseCandidateWorkingSet("not-json"), /serialization is malformed/);
});
