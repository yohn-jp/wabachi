import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { buildDesignIntentSite } from "./site.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function document(documentId: string, displayName = "Orders"): ReturnType<typeof createArchitectureDocument> {
  return createArchitectureDocument({
    documentId,
    root: { id: "architecture" },
    elements: [{ id: "orders", kind: "service", displayName }],
  });
}

test.after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("builds independent current/proposed trees, report, and offline navigation", async () => {
  const parent = await temporaryDirectory("wabachi-design-site-");
  const outputRoot = path.join(parent, "comparison");
  const result = await buildDesignIntentSite({
    outputRoot,
    view: { current: document("commerce", "Orders"), proposed: document("commerce", "Orders API") },
  });

  assert.equal(result.complete, true);
  assert.equal((await lstat(path.join(outputRoot, "current"))).isDirectory(), true);
  assert.equal((await lstat(path.join(outputRoot, "proposed"))).isDirectory(), true);
  assert.match(await readFile(path.join(outputRoot, "index.html"), "utf8"), /proposed\/index\.html/u);
  const report = JSON.parse(await readFile(path.join(outputRoot, "report.json"), "utf8")) as {
    current: { documentId: string };
    proposed?: { documentId: string };
  };
  assert.equal(report.current.documentId, "commerce");
  assert.equal(report.proposed?.documentId, "commerce");
  assert.match(await readFile(path.join(outputRoot, "current/index.html"), "utf8"), /Orders/u);
  assert.match(await readFile(path.join(outputRoot, "proposed/index.html"), "utf8"), /Orders API/u);
});

test("rejects existing output and symlinked ancestors without writing", async () => {
  const parent = await temporaryDirectory("wabachi-design-site-safety-");
  const existing = path.join(parent, "existing");
  await mkdir(existing);
  await assert.rejects(
    () => buildDesignIntentSite({ outputRoot: existing, view: { current: document("commerce") } }),
    /output parent does not exist|refusing to overwrite/u,
  );

  const realParent = path.join(parent, "real-parent");
  await mkdir(realParent);
  const linkedParent = path.join(parent, "linked-parent");
  await symlink(realParent, linkedParent);
  const linkedOutput = path.join(linkedParent, "comparison");
  await assert.rejects(
    () => buildDesignIntentSite({ outputRoot: linkedOutput, view: { current: document("commerce") } }),
    /symbolic link/u,
  );
  await assert.rejects(() => access(linkedOutput), /ENOENT/u);
});

test("removes the staging tree when a later renderer fails", async () => {
  const parent = await temporaryDirectory("wabachi-design-site-partial-");
  const outputRoot = path.join(parent, "comparison");
  const invalid = document("commerce");
  const invalidViews = [
    {
      key: "duplicate",
      kind: "structural" as const,
      scope: { include: [] },
      presentation: { direction: "lr" as const },
    },
    {
      key: "duplicate",
      kind: "structural" as const,
      scope: { include: [] },
      presentation: { direction: "lr" as const },
    },
  ];
  const malformed = { ...invalid, views: invalidViews } as unknown as typeof invalid;

  await assert.rejects(() => buildDesignIntentSite({ outputRoot, view: { current: invalid, proposed: malformed } }));
  await assert.rejects(() => access(outputRoot), /ENOENT/u);
});
