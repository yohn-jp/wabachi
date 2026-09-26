import assert from "node:assert/strict";
import { test } from "node:test";
import { wabachiCommands, wabachiGroups } from "./cli/commands.js";
import {
  MAX_SKILL_OUTPUT_BYTES,
  SKILL_SCENARIOS,
  findSkillScenario,
  projectSkillIndexToJson,
  projectSkillIndexToText,
  projectSkillScenarioToJson,
  projectSkillScenarioToText,
} from "./skill.js";

test("Wabachi playbooks preserve their content and use Canon command identities", () => {
  assert.deepEqual(
    SKILL_SCENARIOS.map((scenario) => scenario.id),
    [
      "analyze-repository",
      "provider-matrix",
      "validate-architecture-canon",
      "render-architecture-canon",
      "design-intent-lifecycle",
      "architecture-documentation",
    ],
  );
  assert.equal(findSkillScenario("missing"), undefined);
  assert.deepEqual(
    projectSkillIndexToJson().scenarios.map((scenario) => scenario.id),
    SKILL_SCENARIOS.map((scenario) => scenario.id),
  );
});

test("workflow routes, examples, and help pointers derive from Canon declarations", () => {
  const routeById = new Map<string, readonly string[]>([
    ...Object.entries(wabachiCommands).map(([id, command]) => [id, command.route] as const),
    ...Object.entries(wabachiGroups).map(([id, group]) => [id, group.route] as const),
  ]);
  const invocation = (id: string) => {
    const route = routeById.get(id);
    assert.ok(route, `Skill references declared Canon route ${id}`);
    return ["wabachi", ...route].join(" ");
  };

  for (const scenario of SKILL_SCENARIOS) {
    assert.equal(scenario.canonicalEntrypoint, invocation(scenario.canonicalCommandId));
    assert.equal(scenario.helpPointer, `${invocation(scenario.canonicalCommandId)} --help`);
    for (const step of scenario.workflow) {
      const route = invocation(step.commandId);
      const command = wabachiCommands[step.commandId as keyof typeof wabachiCommands];
      assert.equal(step.command, route);
      assert.equal(step.example, command?.examples?.[0] ?? route);
      assert.equal(step.helpPointer, `${route} --help`);
    }
  }
});

test("Skill text and machine projections stay within Canon's output budget", () => {
  const indexText = projectSkillIndexToText();
  const indexJson = JSON.stringify(projectSkillIndexToJson());
  assert.ok(Buffer.byteLength(indexText, "utf8") <= MAX_SKILL_OUTPUT_BYTES);
  assert.ok(Buffer.byteLength(indexJson, "utf8") <= MAX_SKILL_OUTPUT_BYTES);

  for (const scenario of SKILL_SCENARIOS) {
    const text = projectSkillScenarioToText(scenario);
    const json = projectSkillScenarioToJson(scenario);
    assert.ok(text.includes(scenario.title));
    assert.equal(json.id, scenario.id);
    assert.deepEqual(
      json.workflow.map((step) => step.commandId),
      scenario.workflow.map((step) => step.commandId),
    );
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_SKILL_OUTPUT_BYTES, scenario.id);
    assert.ok(Buffer.byteLength(JSON.stringify(json), "utf8") <= MAX_SKILL_OUTPUT_BYTES, scenario.id);
  }
});
