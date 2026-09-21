import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { architectureCanonDigest, createDesignChangeSet } from "../change/diff.js";
import { digestJson } from "../digest.js";
import {
  decodeDesignIntentLifecycleRecord,
  parseDesignIntentLifecycleRecord,
  parseStoredDesignChange,
  serializeDesignIntentLifecycleRecord,
} from "./record-codec.js";

const REVISION = "0123456789012345678901234567890123456789";
const CHANGE_DIGEST = "a".repeat(64);

function change() {
  const canon = createArchitectureDocument({ documentId: "document", root: { id: "architecture" } });
  return createDesignChangeSet({
    changeId: "change-206",
    base: { repositoryRevision: REVISION, canonVersion: 1, canonDigest: architectureCanonDigest(canon) },
    baseCanon: canon,
    targetCanon: canon,
  });
}

function lifecycle() {
  return {
    changeId: "change-206",
    changeDigest: CHANGE_DIGEST as never,
    state: "draft" as const,
    implementations: [],
  };
}

test("lifecycle records serialize deterministically and reject unknown fields", () => {
  const record = lifecycle();
  const encoded = serializeDesignIntentLifecycleRecord(record);
  assert.deepEqual(parseDesignIntentLifecycleRecord(encoded), record);
  assert.throws(() => decodeDesignIntentLifecycleRecord({ ...record, unexpected: true }), /unknown field/u);
  assert.throws(
    () =>
      parseDesignIntentLifecycleRecord(
        `{"changeId":"change-206","changeId":"change-206","changeDigest":"${CHANGE_DIGEST}","state":"draft","implementations":[]}`,
      ),
    /duplicate JSON object field/u,
  );
});

test("stored changes reject duplicate JSON fields before decoding", () => {
  const encoded = JSON.stringify(change());
  assert.deepEqual(parseStoredDesignChange(encoded), change());
  assert.throws(
    () => parseStoredDesignChange(encoded.replace('"digest":"', '"changeId":"duplicate","digest":"')),
    /duplicate JSON object field/u,
  );
});

test("record decoder keeps semantic and revision digests structurally distinct", () => {
  const value = {
    ...lifecycle(),
    changeDigest: digestJson({ proposal: true }),
  };
  const decoded = decodeDesignIntentLifecycleRecord(value);
  assert.equal(decoded.changeDigest, digestJson({ proposal: true }));
  assert.equal("byteDigest" in decoded, false);
});
