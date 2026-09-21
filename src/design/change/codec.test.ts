import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { architectureCanonDigest, createDesignChangeSet } from "./diff.js";
import { decodeDesignChangeSet, parseDesignChangeSet, serializeDesignChangeSet } from "./codec.js";

const REVISION = "0123456789012345678901234567890123456789";

function fixture() {
  const base = createArchitectureDocument({ documentId: "document", root: { id: "architecture" } });
  const target = createArchitectureDocument({
    documentId: "document",
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service" }],
  });
  return createDesignChangeSet({
    changeId: "change-1",
    base: { repositoryRevision: REVISION, canonVersion: 1, canonDigest: architectureCanonDigest(base) },
    baseCanon: base,
    targetCanon: target,
  });
}

test("serialize-parse-serialize is byte stable", () => {
  const encoded = serializeDesignChangeSet(fixture());
  assert.equal(serializeDesignChangeSet(parseDesignChangeSet(encoded)), encoded);
});

test("rejects unknown fields, duplicate semantic operations, and invalid Git identities", () => {
  const value = JSON.parse(serializeDesignChangeSet(fixture())) as Record<string, unknown>;
  assert.throws(() => decodeDesignChangeSet({ ...value, extra: true }), /unknown field/);

  const target = value.target as Record<string, unknown>;
  const operations = target.operations as unknown[];
  target.operations = [...operations, operations[0]];
  const duplicate = { ...value, digest: "0".repeat(64) };
  assert.throws(() => decodeDesignChangeSet(duplicate), /duplicate|digest/);

  const invalidBase = JSON.parse(serializeDesignChangeSet(fixture())) as Record<string, unknown>;
  (invalidBase.base as Record<string, unknown>).repositoryRevision = "not-a-git-object";
  assert.throws(() => decodeDesignChangeSet(invalidBase), /repositoryRevision/);
});
