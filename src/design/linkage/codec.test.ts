import assert from "node:assert/strict";
import test from "node:test";

import type { Digest } from "../digest.js";
import { createSemanticEntryKey } from "../entry-key.js";
import {
  decodeExternalIssueReference,
  decodeImplementationLink,
  parseImplementationLink,
  sameExternalIssueIdentity,
  serializeImplementationLink,
} from "./codec.js";

const changeDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as Digest;
const deletedTarget = createSemanticEntryKey({ collection: "element", identity: ["removed-service"] });
const liveTarget = createSemanticEntryKey({ collection: "decision", identity: ["decision-1"] });

const proposal = { changeId: "change-1", digest: changeDigest } as const;

const link = {
  linkId: "link-1",
  changeId: proposal.changeId,
  changeDigest: proposal.digest,
  implementation: {
    repositoryHost: "github.com",
    repositoryId: "1335559861",
    repository: "yohn-jp/wabachi",
    number: 210,
  },
  targetEntryKeys: [liveTarget, deletedTarget],
  evidence: [{ provider: "issue", reference: "#210" }],
} as const;

test("repository locator changes do not change external issue identity", () => {
  const first = decodeExternalIssueReference(link.implementation);
  const renamed = decodeExternalIssueReference({ ...link.implementation, repository: "yohn-jp/renamed" });

  assert.equal(sameExternalIssueIdentity(first, renamed), true);
  assert.notEqual(JSON.stringify(first), JSON.stringify(renamed));
});

test("rejects invalid issue identity and imported authorization fields", () => {
  assert.throws(() => decodeExternalIssueReference({ ...link.implementation, number: 0 }), /positive safe integer/);
  assert.throws(() => decodeExternalIssueReference({ ...link.implementation, repositoryId: "" }), /malformed/);
  assert.throws(
    () => decodeExternalIssueReference({ ...link.implementation, repositoryId: "123456789012345678901" }),
    /malformed/,
  );
  assert.throws(
    () => decodeExternalIssueReference({ ...link.implementation, repositoryHost: "github.com/path" }),
    /malformed/,
  );
  assert.throws(
    () => decodeExternalIssueReference({ ...link.implementation, repositoryHost: "github.com host" }),
    /malformed/,
  );
  assert.throws(
    () => decodeExternalIssueReference({ ...link.implementation, repositoryId: 1335559861 }),
    /must be a string/,
  );
  assert.throws(() => decodeExternalIssueReference({ ...link.implementation, token: "secret" }), /unknown field/);
  assert.throws(() => decodeExternalIssueReference({ ...link.implementation, read: ["src"] }), /unknown field/);
  assert.throws(() => decodeExternalIssueReference({ ...link.implementation, write: ["src"] }), /unknown field/);
});

test("canonicalizes GitHub host and repository locator without changing identity", () => {
  const reference = decodeExternalIssueReference({
    ...link.implementation,
    repositoryHost: "GITHUB.COM",
    repository: "Yohn-JP/Wabachi",
  });
  assert.deepEqual(reference, {
    repositoryHost: "github.com",
    repositoryId: "1335559861",
    repository: "yohn-jp/wabachi",
    number: 210,
  });
  assert.deepEqual(decodeExternalIssueReference({ ...reference, repositoryHost: "ghe.example.com" }), {
    ...reference,
    repositoryHost: "ghe.example.com",
  });
});

test("retains deleted proposal targets as canonical base EntryRefs", () => {
  const decoded = decodeImplementationLink(link, proposal);
  assert.deepEqual(decoded.targetEntryKeys, [liveTarget, deletedTarget]);
});

test("rejects linkage for another proposal revision", () => {
  assert.throws(
    () =>
      decodeImplementationLink(
        { ...link, changeDigest: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" },
        proposal,
      ),
    /expected proposal revision/,
  );
  assert.throws(
    () => decodeImplementationLink({ ...link, changeId: "change-2" }, proposal),
    /expected proposal revision/,
  );
});

test("serializes target and evidence collections canonically", () => {
  const serialized = serializeImplementationLink(
    {
      ...link,
      targetEntryKeys: [liveTarget, deletedTarget],
      evidence: [{ provider: "issue", reference: "#210" }],
    },
    proposal,
  );
  assert.match(
    serialized,
    /"targetEntryKeys":\["\[\\"decision\\",\\"decision-1\\"\]","\[\\"element\\",\\"removed-service\\"\]"\]/,
  );
  assert.deepEqual(parseImplementationLink(serialized, proposal), decodeImplementationLink(link, proposal));
});
