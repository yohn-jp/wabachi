import assert from "node:assert/strict";
import { test } from "node:test";
import { runWabachiCli } from "../cli.js";

test("Design read commands execute through Canon bindings and preserve domain failures", async () => {
  const result = await runWabachiCli(["design", "status", "change-225"]);
  assert.equal(result.failureKind, "domain");
  assert.equal(result.exitCode, 1);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Architecture Canon not found|git repository root resolution failed|Design Change not found/u,
  );

  const optionId = await runWabachiCli(["design", "status", "--change-id", "change-225"]);
  assert.equal(optionId.failureKind, "domain");
  assert.equal(optionId.exitCode, 1);
});

test("Design route and option errors are classified by CLI Canon", async () => {
  const unknown = await runWabachiCli(["design", "inspect", "change-225"]);
  assert.equal(unknown.failureKind, "usage");
  assert.equal(unknown.exitCode, 2);

  const unsupportedOption = await runWabachiCli(["design", "status", "change-225", "--section", "decisions"]);
  assert.equal(unsupportedOption.failureKind, "usage");
  assert.equal(unsupportedOption.exitCode, 2);
});
