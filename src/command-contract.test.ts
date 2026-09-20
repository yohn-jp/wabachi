import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMANDS,
  COMMAND_OPTIONS,
  commandExample,
  commandHelpPointer,
  commandUsage,
  getCommand,
  getCommandForPositionals,
  parseHelpRequest,
  projectCommandHelp,
} from "./command-contract.js";

test("the command contract covers the supported Wabachi surface", () => {
  assert.deepEqual(
    COMMANDS.map((command) => command.id),
    [
      "root.help",
      "root.version",
      "run.execute",
      "matrix.execute",
      "architecture.help",
      "architecture.validate",
      "architecture.render",
      "skill.index",
      "skill.scenario",
    ],
  );
  assert.deepEqual(Object.keys(COMMAND_OPTIONS).sort(), [
    "config",
    "help",
    "json",
    "out",
    "revision",
    "structurizrCommand",
    "version",
  ]);
  assert.match(commandUsage("architecture.render"), /^usage: wabachi architecture render <file>/u);
  assert.match(commandUsage("architecture.render"), /--structurizr-command <executable-path>/u);
  assert.equal(commandExample("matrix.execute"), "wabachi matrix <repository> --revision <sha> --out <dir>");
  assert.doesNotMatch(commandUsage("root.help"), /--version/u);
  assert.equal(commandUsage("root.version"), "usage: wabachi --version");
});

test("progressive help resolves root, domain, and leaf projections", () => {
  assert.equal(getCommandForPositionals([])?.id, "root.help");
  assert.equal(getCommandForPositionals(["architecture"])?.id, "architecture.help");
  assert.equal(getCommandForPositionals(["architecture", "validate", "canon.json"])?.id, "architecture.validate");

  const root = projectCommandHelp([]);
  assert.equal(root?.kind, "root");
  assert.deepEqual(
    root?.commands.map((entry) => entry.id),
    ["root.version", "run.execute", "matrix.execute", "architecture.help", "skill.index"],
  );

  const domain = projectCommandHelp(["architecture"]);
  assert.equal(domain?.kind, "domain");
  assert.deepEqual(
    domain?.commands.map((entry) => entry.id),
    ["architecture.validate", "architecture.render"],
  );

  const leaf = projectCommandHelp(["architecture", "render", "canon.json"]);
  assert.equal(leaf?.kind, "leaf");
  assert.deepEqual(
    leaf?.options.map((option) => option.id),
    ["help", "out", "structurizrCommand", "json"],
  );
});

test("help parsing ignores option values and derives the command path", () => {
  assert.deepEqual(parseHelpRequest(["architecture", "render", "canon.json", "--out", "site", "--help=json"]), {
    positionals: ["architecture", "render", "canon.json"],
    mode: "json",
  });
  assert.equal(commandHelpPointer(getCommand("run.execute").id), "wabachi run --help");
});
