import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKING_SET_CONFLICT_KINDS,
  authorizationEntries,
  conflictToWorkingSetEntry,
  createWorkingSetConflict,
  getWorkingSetConflictKind,
} from "./conflicts.js";

test("conflicts are machine-readable unresolved entries with deterministic bounded provenance", () => {
  const evidence = [
    { artifact: "provider", reference: "b" },
    { artifact: "canon", reference: "a" },
    { artifact: "provider", reference: "b" },
  ];
  const first = createWorkingSetConflict({ kind: "disagreement", locator: "subject:calls", evidence });
  const second = createWorkingSetConflict({
    kind: "disagreement",
    locator: "subject:calls",
    evidence: [...evidence].reverse(),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(WORKING_SET_CONFLICT_KINDS, [
    "ambiguity",
    "disagreement",
    "stale-evidence",
    "mapping-gap",
    "required-but-unauthorized",
    "insufficient-evidence",
  ]);
  assert.equal(getWorkingSetConflictKind(conflictToWorkingSetEntry(first)), "disagreement");
  assert.equal(first.target.kind, "unresolved");
  assert.equal(first.reason.id, "conflict:disagreement");
  assert.deepEqual(first.evidence, [
    { artifact: "canon", reference: "a" },
    { artifact: "provider", reference: "b" },
  ]);
});

test("authorization input remains comparison evidence and does not become a candidate target", () => {
  const entries = authorizationEntries({
    revision: "0123456789abcdef0123456789abcdef01234567",
    targets: [
      { kind: "file", locator: "src/z.ts" },
      { target: { kind: "file", locator: "src/a.ts" }, evidence: [{ artifact: "inari", reference: "a" }] },
    ],
  });

  assert.deepEqual(
    entries.map(({ target }) => target.locator),
    ["src/a.ts", "src/z.ts"],
  );
  assert.deepEqual(entries[0]?.evidence, [{ artifact: "inari", reference: "a" }]);
});
