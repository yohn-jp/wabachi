import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { architectureCanonDigest, createDesignChangeSet } from "../change/diff.js";
import { DesignStore } from "./store.js";

const REVISION = "0123456789012345678901234567890123456789";

async function root(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wabachi-design-store-"));
}

function makeChange() {
  const canon = createArchitectureDocument({ documentId: "document", root: { id: "architecture" } });
  return createDesignChangeSet({
    changeId: "change-206",
    base: { repositoryRevision: REVISION, canonVersion: 1, canonDigest: architectureCanonDigest(canon) },
    baseCanon: canon,
    targetCanon: canon,
  });
}

test("read of a legacy current-only repository has no filesystem side effects", async () => {
  const repositoryRoot = await root();
  try {
    const store = new DesignStore({ repositoryRoot });
    assert.equal(await store.changeStore.read("change-206"), undefined);
    await assert.rejects(access(path.join(repositoryRoot, ".wabachi")), { code: "ENOENT" });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("read retains exact stored bytes and plans CAS against their byte digest", async () => {
  const repositoryRoot = await root();
  try {
    const change = makeChange();
    const store = new DesignStore({ repositoryRoot });
    const plan = await store.changeStore.planChangeWrite(change);
    await store.changeStore.commit([plan]);

    const storedPath = path.join(repositoryRoot, ".wabachi", "changes", "change-206", "change.json");
    const original = await readFile(storedPath);
    const spaced = Buffer.from(` ${original.toString("utf8")}\n`, "utf8");
    await writeFile(storedPath, spaced);
    const artifact = await store.changeStore.readChangeArtifact("change-206");
    assert.ok(artifact);
    assert.deepEqual(Buffer.from(artifact.bytes), spaced);
    assert.equal(artifact.byteDigest, digest(spaced));

    const next = await store.changeStore.planChangeWrite(change);
    assert.equal(next.expectedDigest, artifact.byteDigest);
    assert.deepEqual(Buffer.from(next.nextBytes), original);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("missing required lifecycle fields fail closed", async () => {
  const repositoryRoot = await root();
  try {
    const lifecyclePath = path.join(repositoryRoot, ".wabachi", "changes", "change-206", "lifecycle.json");
    await mkdir(path.dirname(lifecyclePath), { recursive: true });
    await writeFile(lifecyclePath, JSON.stringify({ changeId: "change-206", state: "draft" }));
    const store = new DesignStore({ repositoryRoot });
    await assert.rejects(store.lifecycle.read("change-206"), /missing required field/u);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("mixed-generation change and lifecycle records fail closed", async () => {
  const repositoryRoot = await root();
  try {
    const change = makeChange();
    const store = new DesignStore({ repositoryRoot });
    await store.changeStore.commit([await store.changeStore.planChangeWrite(change)]);
    const lifecyclePath = path.join(repositoryRoot, ".wabachi", "changes", "change-206", "lifecycle.json");
    await mkdir(path.dirname(lifecyclePath), { recursive: true });
    await writeFile(
      lifecyclePath,
      JSON.stringify({
        changeId: change.changeId,
        changeDigest: "b".repeat(64),
        state: "draft",
        implementations: [],
      }),
    );
    await assert.rejects(store.lifecycle.read("change-206"), /different Design Change generation/u);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("a malformed stored artifact is rejected without creating transaction state", async () => {
  const repositoryRoot = await root();
  try {
    const change = makeChange();
    const storedPath = path.join(repositoryRoot, ".wabachi", "changes", "change-206", "change.json");
    await mkdir(path.dirname(storedPath), { recursive: true });
    await writeFile(storedPath, JSON.stringify(change));
    await writeFile(storedPath, "{}");
    const store = new DesignStore({ repositoryRoot });
    await assert.rejects(store.changeStore.readChangeArtifact("change-206"), /missing required|invalid/u);
    await assert.rejects(readdir(path.join(repositoryRoot, ".transactions")), { code: "ENOENT" });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
