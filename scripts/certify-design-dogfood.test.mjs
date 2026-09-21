import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDogfoodResult } from "./certify-design-dogfood.mjs";

const CHANGE_ID = "wabachi-code-intent-bootstrap";
const CHANGES_ROOT = new URL(`../.wabachi/changes/${CHANGE_ID}/`, import.meta.url);

function validResult(overrides = {}) {
  return {
    changeId: CHANGE_ID,
    bootstrapRevision: "0".repeat(40),
    proposalRevision: "1".repeat(40),
    implementationRevision: "2".repeat(40),
    promotedRevision: "3".repeat(40),
    certificationResult: "match",
    promotionOk: true,
    lifecycleState: "promoted",
    rendered: "ok",
    renderedFiles: ["index.html", "report.json"],
    ...overrides,
  };
}

test("validateDogfoodResult accepts a complete, promoted production result", () => {
  assert.equal(validateDogfoodResult(validResult()), undefined);
});

test("validateDogfoodResult fails closed on every load-bearing field", () => {
  assert.match(validateDogfoodResult(validResult({ changeId: "other" })), /changeId/u);
  assert.match(validateDogfoodResult(validResult({ proposalRevision: "not-a-sha" })), /proposalRevision/u);
  assert.match(validateDogfoodResult(validResult({ certificationResult: "mismatch" })), /certificationResult/u);
  assert.match(validateDogfoodResult(validResult({ promotionOk: false })), /promotionOk/u);
  assert.match(validateDogfoodResult(validResult({ lifecycleState: "certification-review" })), /lifecycleState/u);
  assert.match(validateDogfoodResult(validResult({ rendered: "incomplete" })), /rendered/u);
  assert.match(validateDogfoodResult(validResult({ renderedFiles: ["report.json"] })), /renderedFiles/u);
  assert.match(validateDogfoodResult(null), /object/u);
});

test("checked-in .wabachi/changes bootstrap artifacts are a promoted, self-consistent record", async () => {
  const change = JSON.parse(await readFile(new URL("change.json", CHANGES_ROOT), "utf8"));
  const record = JSON.parse(await readFile(new URL("record.json", CHANGES_ROOT), "utf8"));

  assert.equal(change.changeId, CHANGE_ID);
  assert.equal(record.changeId, CHANGE_ID);
  assert.equal(record.changeDigest, change.digest);
  assert.equal(record.state, "promoted");
  assert.equal(record.certification?.result, "match");
  assert.ok(record.implementations.length > 0, "bootstrap record must retain its implementation linkage");
});

test("checked-in .wabachi/architecture.json carries the promoted Code Intent invariant", async () => {
  const canon = JSON.parse(await readFile(new URL("../.wabachi/architecture.json", import.meta.url), "utf8"));
  const intent = canon.codeIntents?.entries?.find((entry) => entry.id === "create-architecture-document-intent");
  assert.equal(
    intent?.invariants?.[0]?.text,
    "createArchitectureDocument preserves declared Canon sections, identity ownership, and source intent",
  );
});
