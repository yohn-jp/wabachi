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
      "architecture.example",
      "architecture.validate",
      "architecture.render",
      "design.help",
      "design.create",
      "design.show",
      "design.diff",
      "design.status",
      "design.validate",
      "design.amend",
      "design.submit",
      "design.review",
      "design.start",
      "design.link",
      "design.certify",
      "design.rework",
      "design.promote",
      "design.recover",
      "design.render",
      "skill.index",
      "skill.scenario",
    ],
  );
  assert.deepEqual(Object.keys(COMMAND_OPTIONS).sort(), [
    "changeId",
    "config",
    "force",
    "help",
    "input",
    "json",
    "out",
    "revision",
    "section",
    "version",
  ]);
  assert.equal(
    commandUsage("architecture.validate"),
    "usage: wabachi architecture validate [file] [--help[=full|json]] [--json]",
  );
  assert.equal(
    commandUsage("architecture.render"),
    "usage: wabachi architecture render [file] [--help[=full|json]] [--out <dir>] [--json]",
  );
  assert.equal(
    commandUsage("matrix.execute"),
    "usage: wabachi matrix <repository> [--help[=full|json]] --revision <ref> --out <dir> [--config <path>]",
  );
  assert.equal(
    commandUsage("run.execute"),
    "usage: wabachi run <repository> [--help[=full|json]] [--revision <ref>] [--out <dir>]",
  );
  assert.doesNotMatch(commandUsage("architecture.render"), /structurizr/u);
  assert.match(projectCommandHelp(["architecture", "render", "canon.json"])?.summary ?? "", /React Flow \+ ELK/u);
  assert.equal(commandExample("matrix.execute"), "wabachi matrix <repository> --revision <sha> --out <dir>");
  assert.doesNotMatch(commandUsage("root.help"), /--version/u);
  assert.equal(commandUsage("root.version"), "usage: wabachi --version");
});

test("progressive help resolves root, domain, and leaf projections", () => {
  assert.equal(getCommandForPositionals([])?.id, "root.help");
  assert.equal(getCommandForPositionals(["architecture"])?.id, "architecture.help");
  assert.equal(getCommandForPositionals(["architecture", "validate"])?.id, "architecture.validate");
  assert.equal(getCommandForPositionals(["architecture", "validate", "canon.json"])?.id, "architecture.validate");

  const root = projectCommandHelp([]);
  assert.equal(root?.kind, "root");
  assert.deepEqual(
    root?.commands.map((entry) => entry.id),
    ["root.version", "run.execute", "matrix.execute", "architecture.help", "design.help", "skill.index"],
  );

  const domain = projectCommandHelp(["architecture"]);
  assert.equal(domain?.kind, "domain");
  assert.deepEqual(
    domain?.commands.map((entry) => entry.id),
    ["architecture.example", "architecture.validate", "architecture.render"],
  );

  const leaf = projectCommandHelp(["architecture", "render", "canon.json"]);
  assert.equal(leaf?.kind, "leaf");
  assert.deepEqual(
    leaf?.options.map((option) => option.id),
    ["help", "out", "json"],
  );

  const matrix = projectCommandHelp(["matrix"]);
  assert.equal(matrix?.usage, commandUsage("matrix.execute"));
  assert.equal(matrix?.options.find((option) => option.id === "revision")?.syntax, "--revision <ref>");
  assert.equal(matrix?.options.find((option) => option.id === "out")?.syntax, "--out <dir>");

  const run = projectCommandHelp(["run"]);
  assert.equal(run?.usage, commandUsage("run.execute"));
  assert.equal(run?.usage.includes("[--revision <ref>]"), true);
});

test("help parsing ignores option values and derives the command path", () => {
  assert.deepEqual(parseHelpRequest(["architecture", "render", "canon.json", "--out", "site", "--help=json"]), {
    positionals: ["architecture", "render", "canon.json"],
    mode: "json",
  });
  assert.equal(commandHelpPointer(getCommand("run.execute").id), "wabachi run --help");
});
