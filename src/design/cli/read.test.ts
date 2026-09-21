import assert from "node:assert/strict";
import { test } from "node:test";
import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { digestJson, type Digest } from "../digest.js";
import type { DesignChangeSet, DesignIntentLifecycleRecord } from "../contracts.js";
import { createSemanticEntryKey } from "../entry-key.js";
import type { DesignReadPorts } from "./read.js";
import { DesignReadService, executeDesignRead, renderDesignReadResult, serializeDesignReadResult } from "./read.js";

const document = createArchitectureDocument({ documentId: "architecture-document", root: { id: "architecture" } });
const revision = {
  repositoryRevision: "a".repeat(40),
  canonVersion: document.canonVersion,
  canonDigest: digestJson(document),
};

const operations = [
  {
    kind: "added" as const,
    entryKey: createSemanticEntryKey({ collection: "decision", identity: ["decision-1"] }),
    value: { id: "decision-1" },
  },
];

const payload = {
  contractVersion: 1 as const,
  changeId: "change-1",
  base: revision,
  target: {
    canonVersion: document.canonVersion,
    operations,
    targetCanonDigest: digestJson(document),
  },
};
const change: DesignChangeSet = { ...payload, digest: digestJson(payload) };

function ports(lifecycle: DesignIntentLifecycleRecord | undefined = undefined): DesignReadPorts {
  return {
    canon: {
      async readCurrent() {
        return { revision, document };
      },
      async readAt(reference) {
        assert.deepEqual(reference, revision);
        return document;
      },
    },
    changes: {
      async apply(input, base) {
        assert.equal(input.changeId, change.changeId);
        assert.equal(base, document);
        return document;
      },
    },
    changeStore: {
      async read(changeId) {
        return changeId === change.changeId ? change : undefined;
      },
      async write() {
        throw new Error("read adapter attempted to write a change");
      },
    },
    lifecycle: {
      async read(changeId) {
        return changeId === change.changeId ? lifecycle : undefined;
      },
      async write() {
        throw new Error("read adapter attempted to write lifecycle state");
      },
    },
  };
}

test("show and diff read through ports without persistence writes", async () => {
  const service = new DesignReadService(
    ports({
      changeId: change.changeId,
      changeDigest: change.digest,
      state: "approved",
      implementations: [],
    }),
  );
  const shown = await service.execute({ command: "show", changeId: change.changeId });
  assert.equal(shown.ok, true);
  if (shown.ok) {
    assert.equal(shown.command, "show");
    assert.equal("view" in shown.data, true);
    if ("view" in shown.data) {
      assert.equal(shown.data.view.proposed, document);
      assert.equal(shown.data.lifecycle?.state, "approved");
    }
  }

  const diffed = await executeDesignRead({ command: "diff", changeId: change.changeId, section: "decisions" }, ports());
  assert.equal(diffed.ok, true);
  if (diffed.ok && "operations" in diffed.data) assert.equal(diffed.data.operations.length, 1);
});

test("status projects lifecycle state and reports an uninitialized record", async () => {
  const result = await executeDesignRead({ command: "status", changeId: change.changeId }, ports());
  assert.equal(result.ok, true);
  if (result.ok && "state" in result.data) {
    assert.equal(result.data.state, "uninitialized");
    assert.deepEqual(result.data.implementations, []);
  }
});

test("validate emits the same result semantics for JSON and text", async () => {
  const result = await executeDesignRead({ command: "validate", changeId: change.changeId }, ports());
  assert.equal(result.ok, true);
  const json = JSON.parse(serializeDesignReadResult(result));
  assert.equal(json.ok, true);
  assert.equal(json.data.valid, true);
  assert.match(renderDesignReadResult(result), /valid: true/u);
});

test("stale lifecycle bindings fail closed and missing changes have a non-zero result", async () => {
  const stale = await executeDesignRead(
    { command: "status", changeId: change.changeId },
    ports({
      changeId: change.changeId,
      changeDigest: "f".repeat(64) as Digest,
      state: "approved",
      implementations: [],
    }),
  );
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.diagnostics[0]?.code, "stale-lifecycle");

  const missing = await executeDesignRead({ command: "show", changeId: "missing" }, ports());
  assert.equal(missing.ok, false);
  assert.equal(missing.exitCode, 1);
});
