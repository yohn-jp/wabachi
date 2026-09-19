import assert from "node:assert/strict";
import test from "node:test";

import {
  CANON_VERSION,
  createArchitectureCanonEnvelope,
  createObjectIdentity,
  normalizeIdentityId,
} from "./identity.js";

test("creates an explicit, versioned canon envelope", () => {
  const envelope = createArchitectureCanonEnvelope({
    documentId: "document-1",
    root: { id: "platform", displayName: "Platform" },
    objects: [{ id: "zeta" }, { id: "alpha" }],
  });

  assert.equal(envelope.canonVersion, CANON_VERSION);
  assert.equal(envelope.documentId, "document-1");
  assert.deepEqual(envelope.root, { kind: "architecture", id: "platform" });
  assert.deepEqual(envelope.objects, [
    { kind: "object", id: "alpha" },
    { kind: "object", id: "zeta" },
  ]);
});

test("normalizes equivalent identity input deterministically", () => {
  assert.equal(normalizeIdentityId("cafe\u0301"), "café");

  const first = createArchitectureCanonEnvelope({
    documentId: "doc",
    root: { id: "root" },
    objects: [{ id: "beta" }, { id: "alpha" }],
  });
  const second = createArchitectureCanonEnvelope({
    documentId: "doc",
    root: { id: "root" },
    objects: [{ id: "alpha" }, { id: "beta" }],
  });

  assert.deepEqual(first, second);
});

test("display-name changes do not change object identity", () => {
  const first = createObjectIdentity({ id: "service-a", displayName: "Orders" });
  const second = createObjectIdentity({
    id: "service-a",
    displayName: "Order Processing",
  });

  assert.deepEqual(first, second);
});

test("rejects malformed and duplicate identities", () => {
  assert.throws(() => createObjectIdentity({ id: " service-a" }), /identity id is malformed/);
  assert.throws(() => createObjectIdentity({ id: "service\u0000a" }), /identity id is malformed/);
  assert.throws(
    () =>
      createArchitectureCanonEnvelope({
        documentId: "doc",
        root: { id: "root" },
        objects: [{ id: "service-a" }, { id: " service-a" }],
      }),
    /identity id is malformed/,
  );
  assert.throws(
    () =>
      createArchitectureCanonEnvelope({
        documentId: "doc",
        root: { id: "root" },
        objects: [{ id: "service-a" }, { id: "service-a" }],
      }),
    /duplicate object id: service-a/,
  );
});
