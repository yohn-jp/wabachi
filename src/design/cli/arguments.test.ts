import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesignArguments } from "./arguments.js";

test("parses read leaves from a complete design argv and preserves output options", () => {
  const parsed = parseDesignArguments(["design", "show", "change-1", "--section", "decisions", "--json"]);
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      domain: "design",
      command: "show",
      changeId: "change-1",
      section: "decisions",
      json: true,
    },
  });
});

test("accepts router input after design and supports an option change id", () => {
  assert.deepEqual(parseDesignArguments(["status", "--change-id", "change-2"]), {
    ok: true,
    value: { domain: "design", command: "status", changeId: "change-2", json: false },
  });
});

test("rejects unknown leaves instead of falling through to another command", () => {
  const parsed = parseDesignArguments(["design", "inspect", "change-1"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.message, /unknown Design leaf/u);
});

test("rejects unknown and duplicate options and missing required values", () => {
  const unknown = parseDesignArguments(["show", "change-1", "--no-network"]);
  assert.equal(unknown.ok, false);
  const duplicate = parseDesignArguments(["show", "change-1", "--json", "--json"]);
  assert.equal(duplicate.ok, false);
  const missing = parseDesignArguments(["validate"]);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.message, /change-id is required/u);
  const mixed = parseDesignArguments(["show", "change-1", "--change-id", "change-2"]);
  assert.equal(mixed.ok, false);
});

test("rejects read-only options on leaves that do not define them", () => {
  const parsed = parseDesignArguments(["status", "change-1", "--section", "decisions"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.message, /does not accept --section/u);
});
