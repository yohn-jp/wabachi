import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { digestJson } from "../digest.js";
import { createSemanticEntryKey } from "../entry-key.js";
import {
  CERTIFICATION_BASELINE_OBLIGATION_IDS,
  deriveCertificationProofPlan,
  resolveCertificationProof,
} from "./plan.js";

const canon = createArchitectureDocument({ documentId: "architecture", root: { id: "architecture" } });
const change = {
  contractVersion: 1 as const,
  changeId: "change-1",
  base: { repositoryRevision: "base", canonVersion: 1 as const, canonDigest: digestJson(canon) },
  target: {
    canonVersion: 1 as const,
    operations: [],
    targetCanonDigest: digestJson(canon),
  },
  digest: digestJson({ changeId: "change-1" }),
};

test("always derives baseline obligations, including for an empty semantic delta", () => {
  const plan = deriveCertificationProofPlan({
    change,
    canon,
    implementationRevision: { repository: "repo", revision: "commit" },
  });

  assert.deepEqual(
    plan.obligations.map(({ id }) => id),
    [
      CERTIFICATION_BASELINE_OBLIGATION_IDS.canonValidity,
      CERTIFICATION_BASELINE_OBLIGATION_IDS.linkedTargetCoverage,
      CERTIFICATION_BASELINE_OBLIGATION_IDS.sourceRevisionBinding,
    ],
  );
});

test("changed duplicate obligation mode or predicate fails closed", () => {
  const baseline = deriveCertificationProofPlan({
    change,
    canon,
    implementationRevision: { repository: "repo", revision: "commit" },
  });
  assert.throws(
    () =>
      deriveCertificationProofPlan({
        change,
        canon,
        implementationRevision: { repository: "repo", revision: "commit" },
        approvedObligations: baseline.obligations.map((obligation) =>
          obligation.id === CERTIFICATION_BASELINE_OBLIGATION_IDS.canonValidity
            ? { ...obligation, mode: "review" as const }
            : obligation,
        ),
      }),
    /changed/,
  );
});

test("unsupported machine predicates stay unresolved", () => {
  const plan = deriveCertificationProofPlan({
    change,
    canon,
    implementationRevision: { repository: "repo", revision: "commit" },
    codeIntent: [
      {
        id: "intent",
        ownerId: "architecture",
        responsibilityIds: [],
        decisionIds: [],
        invariants: [],
        prohibitions: [],
        verificationObligations: [
          { id: "obligation", statementId: "statement", mode: "machine", predicate: "future-check" },
        ],
      },
    ],
  });
  const obligation = plan.obligations.find((entry) => entry.id === "obligation");
  assert.ok(obligation);
  const result = resolveCertificationProof(plan, [
    ...plan.obligations.map((entry) => ({
      checkId: entry.id,
      targetEntryKey: entry.targetEntryKey,
      result: "match" as const,
    })),
  ]);
  assert.equal(result.result, "unresolved");
  assert.equal(result.checks.find((entry) => entry.checkId === obligation.id)?.result, "unresolved");
});

test("empty check sets cannot certify success", () => {
  const plan = deriveCertificationProofPlan({
    change,
    canon,
    implementationRevision: { repository: "repo", revision: "commit" },
  });
  assert.equal(resolveCertificationProof(plan, []).result, "unresolved");
  assert.equal(createSemanticEntryKey({ collection: "element", identity: ["x"] }), '["element","x"]');
});
