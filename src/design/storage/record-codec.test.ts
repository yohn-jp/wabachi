import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { architectureCanonDigest, createDesignChangeSet } from "../change/diff.js";
import {
  checkerResultDigest,
  implementationLinkageDigest,
  implementationSubjectDigest,
} from "../certification/certify.js";
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

test("CertificationRecord freshness bindings round-trip without losing authority", () => {
  const checks = [{ checkId: "machine", result: "match" as const }];
  const implementationSubject = [{ path: "src/design/application.ts", mode: "100644", objectId: "b".repeat(40) }];
  const certification = {
    certificationId: "certification:change-206:revision",
    changeId: "change-206",
    changeDigest: CHANGE_DIGEST as never,
    implementationRevision: { repository: "github.com/yohn-jp/wabachi", revision: REVISION },
    result: "match" as const,
    checks,
    recordedAt: "2026-09-21T00:00:00.000Z",
    proposalDigest: CHANGE_DIGEST,
    targetCanonDigest: "b".repeat(64),
    linkageDigest: implementationLinkageDigest([]),
    implementationSubjectDigest: implementationSubjectDigest(implementationSubject),
    checkerDigest: checkerResultDigest(checks),
    implementationSubject,
  };
  const value = { ...lifecycle(), state: "certification-review" as const, certification };
  const encoded = serializeDesignIntentLifecycleRecord(value);
  const decoded = parseDesignIntentLifecycleRecord(encoded);
  assert.deepEqual(decoded.certification, certification);
  assert.equal((decoded.certification as typeof certification).proposalDigest, CHANGE_DIGEST);
  assert.deepEqual((decoded.certification as typeof certification).implementationSubject, implementationSubject);
});

test("CertificationRecord binding fields are atomic and strictly validated", () => {
  const checks = [{ checkId: "machine", result: "match" as const }];
  const subject = { path: "src/design/application.ts", mode: "100644", objectId: "b".repeat(40) };
  const certification = {
    certificationId: "certification:change-206:revision",
    changeId: "change-206",
    changeDigest: CHANGE_DIGEST as never,
    implementationRevision: { repository: "github.com/yohn-jp/wabachi", revision: REVISION },
    result: "match" as const,
    checks,
    recordedAt: "2026-09-21T00:00:00.000Z",
    proposalDigest: CHANGE_DIGEST,
    targetCanonDigest: "b".repeat(64),
    linkageDigest: implementationLinkageDigest([]),
    implementationSubjectDigest: implementationSubjectDigest([subject]),
    checkerDigest: checkerResultDigest(checks),
    implementationSubject: [subject],
  };
  const value = { ...lifecycle(), state: "certification-review" as const, certification };
  assert.throws(
    () =>
      decodeDesignIntentLifecycleRecord({ ...value, certification: { ...certification, checkerDigest: undefined } }),
    /missing required field: checkerDigest/u,
  );
  assert.throws(
    () => decodeDesignIntentLifecycleRecord({ ...value, certification: { ...certification, proposalDigest: "bad" } }),
    /SHA-256 hexadecimal digest/u,
  );
  assert.throws(
    () =>
      decodeDesignIntentLifecycleRecord({
        ...value,
        certification: { ...certification, implementationSubject: [{ ...subject, extra: true }] },
      }),
    /unknown field: extra/u,
  );
  assert.throws(
    () =>
      decodeDesignIntentLifecycleRecord({
        ...value,
        certification: { ...certification, checkerDigest: "c".repeat(64) },
      }),
    /checkerDigest does not match checks/u,
  );
});
