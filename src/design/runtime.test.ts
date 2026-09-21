import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { createArchitectureDocument } from "../architecture/canon/document.js";
import { serializeCanonicalArchitectureDocument } from "../architecture/canon/codec.js";
import { executeDesignRead } from "./cli/read.js";
import { createDesignRuntime } from "./runtime.js";

const execFileAsync = promisify(execFile);

test("production Design runtime composes the Canon, store, machine, and application ports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wabachi-design-runtime-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Wabachi Test"], { cwd: root });
    const canon = createArchitectureDocument({ documentId: "runtime", root: { id: "architecture" } });
    await mkdir(path.join(root, ".wabachi"), { recursive: true });
    await writeFile(path.join(root, ".wabachi", "architecture.json"), serializeCanonicalArchitectureDocument(canon));
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "canon"], { cwd: root });

    const runtime = await createDesignRuntime({ repositoryRoot: root });
    const current = await runtime.ports.canon.readCurrent();
    const change = await runtime.application.create({
      changeId: "runtime-change",
      base: current.revision,
      baseCanon: current.document,
      targetCanon: canon,
    });
    assert.equal(change.target.operations.length, 0);

    const result = await executeDesignRead({ command: "status", changeId: change.changeId }, runtime.ports);
    assert.equal(result.ok, true);
    if (result.ok && "state" in result.data) assert.equal(result.data.state, "draft");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
