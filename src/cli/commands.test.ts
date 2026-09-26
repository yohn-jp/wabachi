import assert from "node:assert/strict";
import { test } from "node:test";
import { wabachiProduct } from "../cli.js";

test("one CLI Canon product owns every supported Wabachi command route", () => {
  const commands = wabachiProduct.commands;
  const ids = commands.map((command) => command.id);
  assert.deepEqual(
    [...ids].sort(),
    [
      "architecture.example",
      "architecture.validate",
      "architecture.render",
      "run.execute",
      "matrix.execute",
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
      "skill.execute",
    ].sort(),
  );

  const routeKeys = commands.map(({ route }) => route.join(" "));
  assert.equal(new Set(routeKeys).size, routeKeys.length);
  assert.deepEqual(
    commands.filter(({ route }) => route[0] === "architecture").map(({ route }) => route.join(" ")),
    ["architecture example", "architecture render", "architecture validate"],
  );
  assert.equal(commands.filter(({ route }) => route[0] === "design").length, 15);
});
