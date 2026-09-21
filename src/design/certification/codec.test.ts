import assert from "node:assert/strict";
import test from "node:test";

import { decodeCertificationInput, parseCertificationInput } from "./codec.js";

const validInput = {
  changeId: "change-1",
  changeDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  implementationRevision: { repository: "repo", revision: "commit" },
  references: [
    { provider: "review", reference: "b" },
    { provider: "review", reference: "a" },
  ],
};

test("decodes only bound external evidence and canonicalizes reference order", () => {
  const input = decodeCertificationInput(validInput);
  assert.deepEqual(input.references, [
    { provider: "review", reference: "a" },
    { provider: "review", reference: "b" },
  ]);
  assert.equal(Object.hasOwn(input, "result"), false);
});

test("does not allow external input to assert a successful certification", () => {
  assert.throws(() => decodeCertificationInput({ ...validInput, result: "match" }), /unknown field/);
  assert.throws(() => decodeCertificationInput({ ...validInput, checks: [] }), /unknown field/);
});

test("rejects malformed bindings and duplicate references", () => {
  assert.throws(() => decodeCertificationInput({ ...validInput, changeDigest: "match" }), /SHA-256/);
  assert.throws(
    () =>
      decodeCertificationInput({
        ...validInput,
        references: [
          { provider: "p", reference: "r" },
          { provider: "p", reference: "r" },
        ],
      }),
    /duplicate/,
  );
  assert.deepEqual(parseCertificationInput(JSON.stringify(validInput)), decodeCertificationInput(validInput));
});
