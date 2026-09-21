import type { CodeIntent } from "../../architecture/canon/code-intent-contract.js";
import type { DocumentationModel } from "../../architecture/documentation/model.js";
import type { DesignIntentGraphDelta, GraphDeltaState } from "./graph-delta.js";
import type { DesignIntentLifecycleRecord, EvidenceReference } from "../contracts.js";

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Only local site paths and explicit HTTP(S) references may become links.
 * Everything else remains escaped text in the report.
 */
export function safeDesignIntentHref(value: string): string | undefined {
  if (value.length === 0 || /[\u0000-\u001f\u007f\\]/u.test(value) || value.startsWith("//")) return undefined;

  const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme !== "http" && scheme !== "https") return undefined;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    } catch {
      return undefined;
    }
    return value;
  }

  if (value.startsWith("/")) return undefined;
  let decoded = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (
    decoded.startsWith("/") ||
    /[\u0000-\u001f\u007f\\]/u.test(decoded) ||
    decoded
      .split(/[?#]/u, 1)[0]
      ?.split("/")
      .some((segment) => segment === "..") === true
  ) {
    return undefined;
  }

  return value;
}

function renderLinkOrText(value: string): string {
  const escaped = escapeHtml(value);
  const href = safeDesignIntentHref(value);
  return href === undefined ? escaped : `<a href="${escapeHtml(href)}">${escaped}</a>`;
}

function renderNavigationLink(href: string, label: string): string {
  const safeHref = safeDesignIntentHref(href);
  return safeHref === undefined ? escapeHtml(label) : `<a href="${escapeHtml(safeHref)}">${escapeHtml(label)}</a>`;
}

function renderPrimitive(value: unknown): string {
  if (typeof value === "string") return `<span>${escapeHtml(value)}</span>`;
  if (value === null) return "<span>null</span>";
  return `<span>${escapeHtml(String(value))}</span>`;
}

function renderValue(value: unknown, linkStrings = false): string {
  if (value === null || typeof value !== "object") {
    if (linkStrings && typeof value === "string") return renderLinkOrText(value);
    return renderPrimitive(value);
  }
  if (Array.isArray(value)) {
    return `<ol>${value.map((item) => `<li>${renderValue(item, linkStrings)}</li>`).join("")}</ol>`;
  }

  const fields = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (fields.length === 0) return "<span>{}</span>";
  return `<dl>${fields
    .map(([key, item]) => `<div><dt>${escapeHtml(key)}</dt><dd>${renderValue(item, linkStrings)}</dd></div>`)
    .join("")}</dl>`;
}

function renderEvidenceReferences(references: readonly EvidenceReference[] | undefined): string {
  if (references === undefined || references.length === 0) return "<p>none</p>";
  return `<ul>${references
    .map(
      ({ provider, reference }) => `<li><strong>${escapeHtml(provider)}</strong>: ${renderLinkOrText(reference)}</li>`,
    )
    .join("")}</ul>`;
}

function renderLifecycle(lifecycle: DesignIntentLifecycleRecord | undefined): string {
  if (lifecycle === undefined) {
    return `<section id="lifecycle"><h2>Lifecycle</h2><p>missing</p></section>`;
  }

  const review = lifecycle.review;
  const certification = lifecycle.certification;
  return `<section id="lifecycle">
<h2>Lifecycle</h2>
<dl>
<div><dt>changeId</dt><dd>${renderPrimitive(lifecycle.changeId)}</dd></div>
<div><dt>changeDigest</dt><dd>${renderPrimitive(lifecycle.changeDigest)}</dd></div>
<div><dt>state</dt><dd>${renderPrimitive(lifecycle.state)}</dd></div>
</dl>
<section id="review"><h3>Review</h3>${
    review === undefined
      ? "<p>missing</p>"
      : `${renderValue({ ...review, evidence: undefined })}<h4>Evidence</h4>${renderEvidenceReferences(review.evidence)}`
  }</section>
<section id="implementations"><h3>Implementation linkage</h3>${renderValue(lifecycle.implementations)}</section>
<section id="certification"><h3>Certification</h3>${
    certification === undefined
      ? "<p>missing</p>"
      : `${renderValue({ ...certification, references: undefined })}<h4>References</h4>${renderEvidenceReferences(certification.references)}`
  }</section>
</section>`;
}

function countDelta(states: readonly (GraphDeltaState | undefined)[]): string {
  const counts: Record<GraphDeltaState, number> = { unchanged: 0, added: 0, removed: 0, modified: 0 };
  for (const state of states) if (state !== undefined) counts[state] += 1;
  return `<dl>${Object.entries(counts)
    .map(([state, count]) => `<div><dt>${escapeHtml(state)}</dt><dd>${String(count)}</dd></div>`)
    .join("")}</dl>`;
}

function renderDelta(delta: DesignIntentGraphDelta | undefined): string {
  if (delta === undefined) return `<section id="delta"><h2>Delta</h2><p>missing</p></section>`;
  const currentStates = [
    ...delta.current.nodes.map(({ data }) => data.deltaState),
    ...delta.current.edges.map(({ data }) => data.deltaState),
  ];
  const proposedStates =
    delta.proposed === undefined
      ? []
      : [
          ...delta.proposed.nodes.map(({ data }) => data.deltaState),
          ...delta.proposed.edges.map(({ data }) => data.deltaState),
        ];
  return `<section id="delta"><h2>Delta</h2>
<h3>Current</h3>${countDelta(currentStates)}
${delta.proposed === undefined ? "" : `<h3>Proposed</h3>${countDelta(proposedStates)}`}
</section>`;
}

function renderCodeIntent(codeIntent: readonly CodeIntent[] | undefined): string {
  if (codeIntent === undefined || codeIntent.length === 0) {
    return `<section id="code-intent"><h2>Code Intent</h2><p>missing</p></section>`;
  }
  return `<section id="code-intent"><h2>Code Intent</h2>${renderValue(codeIntent)}</section>`;
}

export interface DesignIntentComparisonHtmlInput {
  readonly current: DocumentationModel;
  readonly proposed?: DocumentationModel;
  readonly delta?: DesignIntentGraphDelta;
  readonly lifecycle?: DesignIntentLifecycleRecord;
  readonly codeIntent?: readonly CodeIntent[];
  readonly currentHref: string;
  readonly proposedHref?: string;
  readonly reportHref: string;
}

/** Render the read-only offline comparison landing page. */
export function renderDesignIntentComparisonHtml(input: DesignIntentComparisonHtmlInput): string {
  const proposedNavigation =
    input.proposed === undefined || input.proposedHref === undefined
      ? ""
      : `<li>${renderNavigationLink(input.proposedHref, "Proposed Canon")}</li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design Intent comparison</title>
<style>
:root { font-family: system-ui, sans-serif; color: #202124; background: #fff; }
body { max-width: 72rem; margin: 0 auto; padding: 2rem; line-height: 1.5; }
nav, section { margin-block: 2rem; }
nav ul { display: flex; flex-wrap: wrap; gap: 1rem 2rem; padding-inline-start: 1.5rem; }
dl { display: grid; gap: .5rem; }
dl > div { display: grid; grid-template-columns: minmax(10rem, max-content) 1fr; gap: 1rem; }
dt { font-weight: 600; }
dd { margin: 0; overflow-wrap: anywhere; }
pre, code { overflow-wrap: anywhere; }
</style>
</head>
<body>
<header><h1>Design Intent comparison</h1><p>Read-only offline projection of the Architecture Canon and lifecycle evidence.</p></header>
<nav aria-label="design-intent"><ul>
<li>${renderNavigationLink(input.currentHref, "Current Canon")}</li>
${proposedNavigation}
<li>${renderNavigationLink(input.reportHref, "JSON report")}</li>
</ul></nav>
${renderDelta(input.delta)}
${renderLifecycle(input.lifecycle)}
${renderCodeIntent(input.codeIntent)}
</body>
</html>`;
}

/** Stable JSON projection retained beside the human-readable landing page. */
export function designIntentReport(input: {
  readonly current: DocumentationModel;
  readonly proposed?: DocumentationModel;
  readonly delta?: DesignIntentGraphDelta;
  readonly lifecycle?: DesignIntentLifecycleRecord;
  readonly codeIntent?: readonly CodeIntent[];
}): string {
  return `${JSON.stringify(
    {
      current: input.current,
      ...(input.proposed === undefined ? {} : { proposed: input.proposed }),
      ...(input.delta === undefined ? {} : { delta: input.delta }),
      ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
      ...(input.codeIntent === undefined ? {} : { codeIntent: input.codeIntent }),
    },
    null,
    2,
  )}\n`;
}
