import assert from "node:assert/strict";
import { test } from "node:test";
import { commandExample, commandHelpPointer, commandInvocation, getCommand } from "./command-contract.js";
import {
  MAX_SKILL_OUTPUT_BYTES,
  SKILL_SCENARIOS,
  findSkillScenario,
  projectSkillIndexToJson,
  projectSkillIndexToText,
  projectSkillScenarioToJson,
  projectSkillScenarioToText,
} from "./skill.js";

test("skill scenarios are deterministic and cover the initial intents", () => {
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

test("workflow command, examples, and help pointers derive from command IDs", () => {
  for (const scenario of SKILL_SCENARIOS) {
    assert.equal(scenario.canonicalEntrypoint, commandInvocation(scenario.canonicalCommandId));
    assert.equal(scenario.helpPointer, commandHelpPointer(scenario.canonicalCommandId));
    for (const step of scenario.workflow) {
      getCommand(step.commandId);
      assert.equal(step.command, commandInvocation(step.commandId));
      assert.equal(step.example, commandExample(step.commandId));
      assert.equal(step.helpPointer, commandHelpPointer(step.commandId));
    }
  }
});

test("text and JSON projections share scenario records and stay bounded", () => {
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
