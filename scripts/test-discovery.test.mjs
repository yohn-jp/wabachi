import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the repository test command recursively includes nested Design tests", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const testCommand = packageJson.scripts?.test;
  assert.equal(typeof testCommand, "string");
  assert.match(
    testCommand,
    /node --test --import tsx ['"]?src\/\*\*\/\*\.test\.ts['"]? ['"]?scripts\/\*\*\/\*\.test\.mjs['"]?/u,
  );

  const nestedTests = readdirSync(path.join(repositoryRoot, "src", "design"), { recursive: true }).filter(
    (entry) => typeof entry === "string" && entry.endsWith(".test.ts"),
  );
  assert.ok(nestedTests.length > 0, "src/design must contain discoverable tests");
  assert.ok(
    nestedTests.some((entry) => entry.includes(`${path.sep}change${path.sep}`) || entry.startsWith("change/")),
    "the discovery proof must include a deeply nested Design test",
  );

  const packageSuite = readFileSync(path.join(repositoryRoot, "scripts", "run-package-suite.mjs"), "utf8");
  assert.match(packageSuite, /validateNestedDesignTestDiscovery/u);
});
