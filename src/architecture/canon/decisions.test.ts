import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDecisions } from "./decisions.js";

test("represents decisions with rationale, opaque targets, and references", () => {
  const canon = createArchitectureDecisions({
    decisions: [
      {
        id: "decision-new",
        title: "Use stable IDs",
        status: "accepted",
        type: "architecture",
        rationale: "Stable IDs keep documentation links durable.",
        targetIds: ["document-1", "object-service"],
        referenceIds: ["canon-spec"],
        supersedes: ["decision-old"],
      },
      {
        id: "decision-old",
        title: "Use display names",
        status: "superseded",
        type: "architecture",
        rationale: "This earlier choice is retained for historical context.",
      },
    ],
    references: [
      {
        id: "canon-spec",
        label: "Canon specification",
        uri: "https://example.test/canon",
      },
    ],
    referenceAttachments: [{ targetId: "object-service", referenceIds: ["canon-spec"] }],
  });

  assert.deepEqual(canon.decisions[0], {
    id: "decision-new",
    title: "Use stable IDs",
    status: "accepted",
    type: "architecture",
    rationale: "Stable IDs keep documentation links durable.",
    targetIds: ["document-1", "object-service"],
    referenceIds: ["canon-spec"],
    supersedes: ["decision-old"],
  });
  assert.deepEqual(canon.referenceAttachments, [{ targetId: "object-service", referenceIds: ["canon-spec"] }]);
});

test("equivalent declarations normalize independently of insertion order", () => {
  const first = createArchitectureDecisions({
    decisions: [
      {
        id: "decision-b",
        title: "B",
        status: "proposed",
        type: "policy",
        rationale: "B rationale",
        targetIds: ["target-b", "target-a"],
        referenceIds: ["ref-b", "ref-a"],
      },
      {
        id: "decision-a",
        title: "A",
        status: "proposed",
        type: "policy",
        rationale: "A rationale",
      },
    ],
    references: [
      { id: "ref-b", label: "B", uri: "https://example.test/b" },
      { id: "ref-a", label: "A", uri: "https://example.test/a" },
    ],
  });
  const second = createArchitectureDecisions({
    decisions: [
      {
        id: "decision-a",
        title: "A",
        status: "proposed",
        type: "policy",
        rationale: "A rationale",
      },
      {
        id: "decision-b",
        title: "B",
        status: "proposed",
        type: "policy",
        rationale: "B rationale",
        targetIds: ["target-a", "target-b"],
        referenceIds: ["ref-a", "ref-b"],
      },
    ],
    references: [
      { id: "ref-a", label: "A", uri: "https://example.test/a" },
      { id: "ref-b", label: "B", uri: "https://example.test/b" },
    ],
  });

  assert.deepEqual(first, second);
});

test("rejects unknown references, supersession cycles, and duplicate IDs", () => {
  assert.throws(
    () =>
      createArchitectureDecisions({
        decisions: [
          {
            id: "decision-a",
            title: "A",
            status: "accepted",
            type: "architecture",
            rationale: "A rationale",
            referenceIds: ["missing"],
          },
        ],
      }),
    /references unknown reference: missing/,
  );
  assert.throws(
    () =>
      createArchitectureDecisions({
        decisions: [
          {
            id: "decision-a",
            title: "A",
            status: "accepted",
            type: "architecture",
            rationale: "A rationale",
            supersedes: ["decision-b"],
          },
          {
            id: "decision-b",
            title: "B",
            status: "accepted",
            type: "architecture",
            rationale: "B rationale",
            supersedes: ["decision-a"],
          },
        ],
      }),
    /decision supersession cycle includes:/,
  );
  assert.throws(
    () =>
      createArchitectureDecisions({
        decisions: [
          {
            id: "decision-a",
            title: "A",
            status: "accepted",
            type: "architecture",
            rationale: "A rationale",
          },
          {
            id: "decision-a",
            title: "A again",
            status: "accepted",
            type: "architecture",
            rationale: "A rationale",
          },
        ],
      }),
    /duplicate decision id: decision-a/,
  );
});
