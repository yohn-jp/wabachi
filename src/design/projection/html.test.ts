import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentationModel } from "../../architecture/documentation/model.js";
import { digestJson } from "../digest.js";
import { renderDesignIntentComparisonHtml, safeDesignIntentHref } from "./html.js";

function documentation(documentId: string): DocumentationModel {
  return {
    canonVersion: 1,
    documentId: documentId as DocumentationModel["documentId"],
    root: { canonId: "architecture" },
    navigation: [],
    sections: [],
  };
}

test("renders lifecycle, delta, and Code Intent navigation with escaped prose", () => {
  const changeDigest = digestJson({ changeId: "change-222" });
  const html = renderDesignIntentComparisonHtml({
    current: documentation("current"),
    proposed: documentation("proposed"),
    currentHref: "current/index.html",
    proposedHref: "proposed/index.html",
    reportHref: "report.json",
    codeIntent: [
      {
        id: "intent-222",
        ownerId: "architecture",
        responsibilityIds: [],
        decisionIds: [],
        invariants: [{ id: "invariant", text: "<script>alert(1)</script>" }],
        prohibitions: [],
        verificationObligations: [],
      },
    ],
    lifecycle: {
      changeId: "change-222",
      changeDigest,
      state: "design-review",
      implementations: [],
      review: {
        reviewId: "review-222",
        changeId: "change-222",
        proposalDigest: changeDigest,
        proposalRevision: "revision-222",
        decision: "approved",
        actor: "reviewer",
        reason: "<img src=x onerror=alert(1)>",
        timestamp: "2026-09-21T00:00:00Z",
        evidence: [
          { provider: "safe", reference: "https://example.test/review/222" },
          { provider: "unsafe", reference: "javascript:alert(1)" },
        ],
      },
    },
  });

  assert.match(html, /href="current\/index\.html"/u);
  assert.match(html, /href="proposed\/index\.html"/u);
  assert.match(html, /href="https:\/\/example\.test\/review\/222"/u);
  assert.doesNotMatch(html, /href="javascript:/iu);
  assert.doesNotMatch(html, /<script|<img /u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /id="review"/u);
  assert.match(html, /id="certification"/u);
  assert.match(html, /id="code-intent"/u);
});

test("only local and HTTP(S) references become links", () => {
  assert.equal(safeDesignIntentHref("current/index.html"), "current/index.html");
  assert.equal(safeDesignIntentHref("#review"), "#review");
  assert.equal(safeDesignIntentHref("https://example.test/evidence"), "https://example.test/evidence");
  assert.equal(safeDesignIntentHref("https://example.test/%2e%2e/evidence"), "https://example.test/%2e%2e/evidence");
  assert.equal(safeDesignIntentHref("javascript:alert(1)"), undefined);
  assert.equal(safeDesignIntentHref("data:text/html,unsafe"), undefined);
  assert.equal(safeDesignIntentHref("//evil.test/path"), undefined);
  assert.equal(safeDesignIntentHref("/outside/index.html"), undefined);
  assert.equal(safeDesignIntentHref("../outside/index.html"), undefined);
  assert.equal(safeDesignIntentHref("current/../outside/index.html"), undefined);
  assert.equal(safeDesignIntentHref("%2e%2e/outside/index.html"), undefined);
  assert.equal(safeDesignIntentHref("%252e%252e/outside/index.html"), undefined);
});
