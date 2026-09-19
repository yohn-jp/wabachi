import type {
  DocumentationAnchor,
  DocumentationEntry,
  DocumentationGroup,
  DocumentationModel,
  DocumentationSection,
  DocumentationNavigationItem,
} from "./model.js";

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const STYLE = `<style>
:root { font-family: system-ui, sans-serif; color: #202124; background: #fff; }
body { max-width: 72rem; margin: 0 auto; padding: 2rem; line-height: 1.5; }
nav, main { margin-block: 2rem; }
nav ul, nav ol { padding-inline-start: 1.5rem; }
section { margin-block: 2rem; }
article { border: 1px solid #d8dbe0; padding: 1rem; margin-block: 1rem; }
dl { display: grid; gap: 0.5rem; }
dl > div { display: grid; grid-template-columns: minmax(8rem, max-content) 1fr; gap: 1rem; }
dt { font-weight: 600; }
dd { margin: 0; overflow-wrap: anywhere; }
.documentation-value, .documentation-array, .documentation-object { overflow-wrap: anywhere; }
.documentation-anchors { display: flex; flex-wrap: wrap; gap: 0.75rem; }
</style>`;

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}

function encodeIdPart(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    return Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("-");
  }
}

function htmlId(prefix: string, ...parts: readonly string[]): string {
  return [prefix, ...parts.map(encodeIdPart)].join("-");
}

function canonAnchorId(canonId: string): string {
  return htmlId("canon", canonId);
}

function sectionId(section: string): string {
  return htmlId("section", section);
}

function groupId(section: string, group: string): string {
  return htmlId("group", section, group);
}

function renderPrimitive(value: string | number | boolean | bigint | null | undefined): string {
  return `<span class="documentation-value">${escapeHtml(String(value))}</span>`;
}

function renderValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return renderPrimitive(value as string | number | boolean | bigint | null | undefined);
  }

  if (Array.isArray(value)) {
    return `<ol class="documentation-array">${value.map((item) => `<li>${renderValue(item)}</li>`).join("")}</ol>`;
  }

  const fields = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });

  if (fields.length === 0) return `<span class="documentation-object">{}</span>`;

  return `<dl class="documentation-object">${fields
    .map(([key, fieldValue]) => `<div><dt>${escapeHtml(key)}</dt><dd>${renderValue(fieldValue)}</dd></div>`)
    .join("")}</dl>`;
}

function renderNavigationItem(item: DocumentationNavigationItem): string {
  const groups = item.groupKeys
    .map((group) => `<li><a href="#${escapeHtml(groupId(item.section, group))}">${escapeHtml(group)}</a></li>`)
    .join("");

  return `<li><a href="#${escapeHtml(sectionId(item.section))}">${escapeHtml(item.section)}</a><ul>${groups}</ul></li>`;
}

function renderNavigation(navigation: readonly DocumentationNavigationItem[]): string {
  return `<nav aria-label="documentation"><ol>${navigation.map(renderNavigationItem).join("")}</ol></nav>`;
}

function renderCanonReference(anchor: DocumentationAnchor): string {
  const id = canonAnchorId(anchor.canonId);
  return `<a href="#${escapeHtml(id)}">${escapeHtml(anchor.canonId)}</a>`;
}

function renderEntryAnchors(anchors: readonly DocumentationAnchor[], anchoredCanonIds: Set<string>): string {
  return anchors
    .map((anchor) => {
      const id = canonAnchorId(anchor.canonId);
      const marker = anchoredCanonIds.has(anchor.canonId)
        ? ""
        : `<span id="${escapeHtml(id)}" aria-hidden="true"></span>`;
      anchoredCanonIds.add(anchor.canonId);
      return `${marker}${renderCanonReference(anchor)}`;
    })
    .join(" ");
}

function renderEntry(entry: DocumentationEntry, anchoredCanonIds: Set<string>): string {
  const anchors = renderEntryAnchors(entry.anchors, anchoredCanonIds);

  return `<article>
<h4>${escapeHtml(entry.key)}</h4>
<p class="documentation-anchors">${anchors}</p>
<div class="documentation-data">${renderValue(entry.data)}</div>
</article>`;
}

function renderGroup(section: DocumentationSection, group: DocumentationGroup, anchoredCanonIds: Set<string>): string {
  return `<section id="${escapeHtml(groupId(section.key, group.key))}">
<h3>${escapeHtml(group.key)}</h3>
<ol>${group.entries.map((entry) => renderEntry(entry, anchoredCanonIds)).join("")}</ol>
</section>`;
}

function renderSection(section: DocumentationSection, anchoredCanonIds: Set<string>): string {
  return `<section id="${escapeHtml(sectionId(section.key))}">
<h2>${escapeHtml(section.key)}</h2>
${section.groups.map((group) => renderGroup(section, group, anchoredCanonIds)).join("\n")}
</section>`;
}

/** Render the documentation projection as deterministic, safe static HTML. */
export function renderDocumentationHtml(model: DocumentationModel): string {
  const rootId = canonAnchorId(model.root.canonId);
  const anchoredCanonIds = new Set<string>([model.root.canonId]);
  const metadata = `<dl>
<div><dt>canonVersion</dt><dd>${renderPrimitive(model.canonVersion)}</dd></div>
<div><dt>documentId</dt><dd>${renderPrimitive(model.documentId)}</dd></div>
<div><dt>root</dt><dd>${renderCanonReference(model.root)}</dd></div>
</dl>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.documentId)}</title>
${STYLE}
</head>
<body>
<header id="${escapeHtml(rootId)}">
<h1>${escapeHtml(model.documentId)}</h1>
${metadata}
</header>
${renderNavigation(model.navigation)}
<main id="documentation">
${model.sections.map((section) => renderSection(section, anchoredCanonIds)).join("\n")}
</main>
</body>
</html>`;
}
