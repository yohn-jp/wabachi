import assert from "node:assert/strict";
import test from "node:test";

import { renderDocumentationHtml } from "./html.js";
import type { DocumentationModel } from "./model.js";

function createModel(
  data: unknown = { id: "orders", kind: "service" },
  documentId = "architecture-document",
  rootCanonId = "architecture",
): DocumentationModel {
  return {
    canonVersion: 1,
    documentId,
    root: { canonId: rootCanonId },
    navigation: [{ section: "structure", groupKeys: ["elements"] }],
    sections: [
      {
        key: "structure",
        groups: [
          {
            key: "elements",
            entries: [
              {
                key: "orders",
                anchors: [{ canonId: "orders" }],
                data,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as DocumentationModel;
}

test("renders navigation, sections, groups, entries, and stable Canon anchors", () => {
  const html = renderDocumentationHtml(createModel());

  assert.match(html, /<nav aria-label="documentation">/);
  assert.match(html, /<main id="documentation">/);
  assert.match(html, /<section id="section-structure">/);
  assert.match(html, /<section id="group-structure-elements">/);
  assert.match(html, /<article>/);
  assert.match(html, /id="canon-architecture"/);
  assert.match(html, /id="canon-orders"/);
  assert.match(html, /href="#canon-orders">orders<\/a>/);
});

test("escapes projection text in HTML text and attributes", () => {
  const model = createModel(
    {
      id: '<script>alert("x")</script>',
      kind: "<img src=x onerror=alert(1)>",
      nested: ["&", '"', "'"],
    },
    "<document>&",
    'root"><script>alert(1)</script>',
  );

  const html = renderDocumentationHtml(model);

  assert.doesNotMatch(html, /<script|<img /);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;/);
  assert.match(html, /&#39;/);
});

test("renders equivalent projection values deterministically", () => {
  const first = renderDocumentationHtml(createModel({ id: "orders", kind: "service" }));
  const second = renderDocumentationHtml(createModel({ kind: "service", id: "orders" }));

  assert.equal(first, second);
});
