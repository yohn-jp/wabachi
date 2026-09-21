import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertNoPendingTransactions,
  commitTransaction,
  listPendingTransactions,
  PendingTransactionError,
  recoverTransaction,
  TransactionBusyError,
  TransactionConflictError,
} from "./transaction.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Design filesystem transactions", () => {
  it("recovers after every rename boundary", async () => {
    for (const boundaryToFail of ["before-rename:0", "after-rename:0", "before-rename:1", "after-rename:1"]) {
      const root = await makeRoot();
      const first = path.join(root, "changes", "first.json");
      const second = path.join(root, "changes", "second.json");
      await mkdir(path.dirname(first), { recursive: true });
      await writeFile(first, "before first\n");
      await writeFile(second, "before second\n");
      const transactionId = `boundary-${boundaryToFail.replace(":", "-")}`;

      await assert.rejects(
        commitTransaction({
          rootDir: root,
          transactionId,
          targets: [
            { path: first, content: "after first\n", expectedDigest: digest("before first\n") },
            { path: second, content: "after second\n", expectedDigest: digest("before second\n") },
          ],
          faultInjector: ({ phase, index }) => {
            if (`${phase}:${index}` === boundaryToFail) throw new Error("injected rename fault");
          },
        }),
        /injected rename fault/,
      );

      await assert.rejects(assertNoPendingTransactions(root), PendingTransactionError);
      const recovered = await recoverTransaction(root, { transactionId });
      assert.equal(recovered.state, "committed");
      assert.equal(await readFile(first, "utf8"), "after first\n");
      assert.equal(await readFile(second, "utf8"), "after second\n");
      assert.deepEqual(await listPendingTransactions(root), []);
    }
  });

  it("does not overwrite a third-party mutation during recovery", async () => {
    const root = await makeRoot();
    const first = path.join(root, "first.json");
    const second = path.join(root, "second.json");
    await writeFile(first, "before first\n");
    await writeFile(second, "before second\n");

    await assert.rejects(
      commitTransaction({
        rootDir: root,
        transactionId: "third-party",
        targets: [
          { path: first, content: "after first\n", expectedDigest: digest("before first\n") },
          { path: second, content: "after second\n", expectedDigest: digest("before second\n") },
        ],
        faultInjector: ({ phase, index }) => {
          if (phase === "after-rename" && index === 0) throw new Error("pause after first rename");
        },
      }),
      /pause after first rename/,
    );

    await writeFile(second, "third-party mutation\n");
    await assert.rejects(recoverTransaction(root, { transactionId: "third-party" }), TransactionConflictError);
    assert.equal(await readFile(second, "utf8"), "third-party mutation\n");
    await assert.rejects(assertNoPendingTransactions(root), PendingTransactionError);
  });

  it("serializes writers and requires explicit lock takeover", async () => {
    const root = await makeRoot();
    const target = path.join(root, "state.json");
    await writeFile(target, "before\n");
    let releaseFirstWriter!: () => void;
    const firstWriterHasLock = new Promise<void>((resolve) => {
      releaseFirstWriter = resolve;
    });
    let firstWriterEntered!: () => void;
    const firstWriterEnteredPromise = new Promise<void>((resolve) => {
      firstWriterEntered = resolve;
    });

    const firstWriter = commitTransaction({
      rootDir: root,
      transactionId: "first-writer",
      targets: [{ path: target, content: "first\n", expectedDigest: digest("before\n") }],
      faultInjector: async ({ phase }) => {
        if (phase === "before-rename") {
          firstWriterEntered();
          await firstWriterHasLock;
        }
      },
    });
    await firstWriterEnteredPromise;
    await assert.rejects(
      commitTransaction({
        rootDir: root,
        transactionId: "second-writer",
        targets: [{ path: target, content: "second\n", expectedDigest: digest("before\n") }],
      }),
      TransactionBusyError,
    );
    releaseFirstWriter();
    await firstWriter;

    await writeFile(path.join(root, "pending.json"), "before\n");
    await assert.rejects(
      commitTransaction({
        rootDir: root,
        transactionId: "old-lock",
        targets: [{ path: path.join(root, "pending.json"), content: "after\n", expectedDigest: digest("before\n") }],
        faultInjector: () => {
          throw new Error("leave pending");
        },
      }),
      /leave pending/,
    );
    await writeFile(
      path.join(root, ".transactions", "lock"),
      JSON.stringify({ pid: 2 ** 31 - 1, token: "stopped-writer" }) + "\n",
      { flag: "wx" },
    );
    await assert.rejects(recoverTransaction(root, { transactionId: "old-lock" }), TransactionBusyError);
    await recoverTransaction(root, { transactionId: "old-lock", force: true });
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wabachi-transaction-"));
  temporaryRoots.push(root);
  return root;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
