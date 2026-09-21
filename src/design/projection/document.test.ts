import assert from "node:assert/strict";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { renderDocumentationHtml } from "../../architecture/documentation/html.js";
import { digestJson } from "../digest.js";
import { projectDesignIntentDocumentation } from "./document.js";

function document(id: string) {
  return createArchitectureDocument({
    documentId: id,
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service" }],
    repositoryMappings: [
      { canonId: "orders", paths: ["src/orders.ts"] },
      { canonId: "orders-intent", paths: ["src/orders.ts"] },
    ],
    codeIntents: {
      schemaVersion: 1,
      entries: [
        {
          id: "orders-intent",
          ownerId: "orders",
          invariants: [{ id: "orders-invariant", text: "Orders remain authoritative." }],
          verificationObligations: [
            { id: "orders-check", statementId: "orders-invariant", mode: "machine", predicate: "owns(orders)" },
          ],
        },
      ],
    },
  });
}

test("projects current/proposed Canon and lifecycle evidence into one read model", () => {
  const changeDigest = digestJson({ changeId: "change-220" });
  const lifecycle = {
    changeId: "change-220",
    changeDigest,
    state: "certification-review" as const,
    review: {
      reviewId: "review-220",
      changeId: "change-220",
      proposalDigest: changeDigest,
      proposalRevision: "revision-220",
      decision: "approved" as const,
      actor: "reviewer",
      reason: "approved",
      timestamp: "2026-09-21T00:00:00Z",
      evidence: [{ provider: "inari", reference: "review/220" }],
    },
    implementations: [
      {
        linkId: "link-220",
        changeId: "change-220",
        changeDigest,
        implementation: { repositoryHost: "github.com", repositoryId: "repo", number: 220 },
        targetEntryKeys: [],
      },
    ],
    certification: {
      certificationId: "certification-220",
      changeId: "change-220",
      changeDigest,
      implementationRevision: { repository: "repo", revision: "revision-220" },
      result: "match" as const,
      checks: [],
      recordedAt: "2026-09-21T00:00:00Z",
    },
  };

  const model = projectDesignIntentDocumentation(
    { current: document("current"), proposed: document("proposed") },
    lifecycle,
  );

  assert.equal(model.documentId, "current");
  assert.equal(model.designIntent?.proposed?.documentId, "proposed");
  assert.equal(model.designIntent?.lifecycle, lifecycle);
  assert.equal(model.designIntent?.proposed?.designIntent, undefined);
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.designIntent), true);
  assert.equal(Object.isFrozen(model.designIntent?.proposed), true);
});

test("keeps missing lifecycle evidence visible in static HTML", () => {
  const changeDigest = digestJson({ changeId: "change-220" });
  const model = projectDesignIntentDocumentation(
    { current: document("current") },
    {
      changeId: "change-220",
      changeDigest,
      state: "design-review",
      implementations: [],
    },
  );

  const html = renderDocumentationHtml(model);
  assert.match(html, /change-220/);
  assert.match(html, /state/);
  assert.match(html, /review<\/strong>: missing/);
  assert.match(html, /certification<\/strong>: missing/);
});
