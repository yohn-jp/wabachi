import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesignArguments } from "./cli/arguments.js";
import { runDesignCli } from "./cli.js";

test("production Design CLI keeps read leaves bounded and rejects unknown workflow leaves", () => {
  const parsed = parseDesignArguments(["design", "show", "change-225", "--json"]);
  assert.equal(parsed.ok, true);
  assert.equal(parseDesignArguments(["design", "unknown", "change-225"]).ok, false);
});

test("Design CLI reports a missing repository Canon as a non-zero result", async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const errors: string[] = [];
  const logs: string[] = [];
  console.error = (line: string) => errors.push(line);
  console.log = (line: string) => logs.push(line);
  try {
    const code = await runDesignCli(["status", "change-225"]);
    assert.equal(code, 1);
    assert.match(
      [...errors, ...logs].at(-1) ?? "",
      /Architecture Canon not found|git repository root resolution failed|Design Change not found/u,
    );
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});
