import { DEFAULT_SKILL_OUTPUT_BUDGET_BYTES, type CommandId } from "@yohn-jp/cli-canon";
import { wabachiCommands, wabachiGroups } from "./cli/commands.js";

/** Deterministic intent-oriented playbooks for the supported Wabachi surface. */

export const SKILL_MODEL_VERSION = "1.0.0" as const;
export const MAX_SKILL_OUTPUT_BYTES = DEFAULT_SKILL_OUTPUT_BUDGET_BYTES;

type SkillCommandId = CommandId<typeof wabachiCommands> | keyof typeof wabachiGroups;

export interface SkillWorkflowStep {
  readonly summary: string;
  /** Stable reference into the Canon-owned Wabachi command model. */
  readonly commandId: SkillCommandId;
  /** Bare executable command derived from its Canon-owned route. */
  readonly command: string;
  /** Practical example derived from the Canon command declaration. */
  readonly example: string;
  /** Progressive-help pointer derived from the Canon-owned route. */
  readonly helpPointer: string;
}

export interface SkillScenario {
  readonly id: string;
  readonly title: string;
  readonly whenToUse: string;
  readonly workflow: readonly SkillWorkflowStep[];
  readonly invariants: readonly string[];
  readonly canonicalCommandId: SkillCommandId;
  readonly canonicalEntrypoint: string;
  readonly helpPointer: string;
}

function commandRoute(commandId: SkillCommandId): readonly string[] {
  if (commandId in wabachiCommands) {
    return wabachiCommands[commandId as keyof typeof wabachiCommands].route;
  }
  return wabachiGroups[commandId as keyof typeof wabachiGroups].route;
}

function commandInvocation(commandId: SkillCommandId): string {
  return ["wabachi", ...commandRoute(commandId)].join(" ");
}

function workflowStep(summary: string, commandId: SkillCommandId): SkillWorkflowStep {
  const command = commandId in wabachiCommands ? wabachiCommands[commandId as keyof typeof wabachiCommands] : undefined;
  const invocation = commandInvocation(commandId);
  return {
    summary,
    commandId,
    command: invocation,
    example: command?.examples?.[0] ?? invocation,
    helpPointer: `${invocation} --help`,
  };
}

function skillScenario(input: {
  readonly id: string;
  readonly title: string;
  readonly whenToUse: string;
  readonly workflow: readonly (readonly [summary: string, commandId: SkillCommandId])[];
  readonly invariants: readonly string[];
  readonly canonicalCommandId: SkillCommandId;
}): SkillScenario {
  return {
    id: input.id,
    title: input.title,
    whenToUse: input.whenToUse,
    workflow: input.workflow.map(([summary, commandId]) => workflowStep(summary, commandId)),
    invariants: input.invariants,
    canonicalCommandId: input.canonicalCommandId,
    canonicalEntrypoint: commandInvocation(input.canonicalCommandId),
    helpPointer: `${commandInvocation(input.canonicalCommandId)} --help`,
  };
}

export const SKILL_SCENARIOS: readonly SkillScenario[] = [
  skillScenario({
    id: "analyze-repository",
    title: "Analyze a repository",
    whenToUse: "Use when you need deterministic provider output for a repository at a selected revision.",
    workflow: [["Resolve the repository and execute the registered analysis providers.", "run.execute"]],
    invariants: [
      "Choose an explicit revision when reproducibility matters; the default resolution remains supported.",
      "Retain the output directory when another workflow or reviewer needs the manifest and provider artifacts.",
      "The provider set and analysis execution semantics are owned by the runtime, not this playbook.",
    ],
    canonicalCommandId: "run.execute",
  }),
  skillScenario({
    id: "provider-matrix",
    title: "Build a provider matrix",
    whenToUse: "Use when you need auditable facts, correlations, matrix output, and a report for one revision.",
    workflow: [["Run the provider matrix and retain its generated artifacts.", "matrix.execute"]],
    invariants: [
      "Use a 40-character commit SHA when matrix evidence must be tied to an immutable revision.",
      "Provide an output directory so the report and its supporting artifacts remain inspectable.",
      "Provider registration and matrix execution order remain runtime authority.",
    ],
    canonicalCommandId: "matrix.execute",
  }),
  skillScenario({
    id: "validate-architecture-canon",
    title: "Validate an Architecture Canon",
    whenToUse: "Use before rendering an explicit Architecture Canon document or handing it to another workflow.",
    workflow: [["Validate the explicit Canon file and inspect any bounded diagnostics.", "architecture.validate"]],
    invariants: [
      "The Canon file is explicit input; this workflow does not create or mutate one.",
      "Validation must succeed before rendering or publishing derived documentation.",
      "Machine-readable diagnostics are available through the command's JSON projection.",
    ],
    canonicalCommandId: "architecture.validate",
  }),
  skillScenario({
    id: "render-architecture-canon",
    title: "Render Architecture Canon documentation",
    whenToUse: "Use when a valid Architecture Canon should become a retained static documentation site.",
    workflow: [["Render the explicit Canon file into a retained output directory.", "architecture.render"]],
    invariants: [
      "Validate the same Canon file first when its validity has not already been established.",
      "The Structurizr CLI is required for static export; use the command's executable override only when needed.",
      "Rendering is a projection and does not add an Architecture Canon authoring command.",
    ],
    canonicalCommandId: "architecture.render",
  }),
  skillScenario({
    id: "design-intent-lifecycle",
    title: "Run a Design Intent lifecycle",
    whenToUse:
      "Use for the production Design Change authoring, review, linkage, certification, and promotion workflow.",
    workflow: [
      ["Author and inspect a Design Change from the current Canon.", "design.create"],
      ["Submit and record immutable design review evidence.", "design.review"],
      ["Start implementation and record governed linkage.", "design.link"],
      ["Derive certification from repository evidence and promote the result.", "design.certify"],
      ["Render the current and proposed Canons for inspection.", "design.render"],
    ],
    invariants: [
      "The Architecture Canon remains the semantic authority.",
      "Lifecycle transitions are decided by the XState machine and stale or pending storage fails closed.",
      "Certification results are produced by the production evidence pipeline, never supplied as final success.",
    ],
    canonicalCommandId: "design.create",
  }),
  skillScenario({
    id: "architecture-documentation",
    title: "Follow the Architecture Documentation workflow",
    whenToUse:
      "Use for the normal manual-authoring, validation, and rendering path for Architecture Canon documentation.",
    workflow: [
      [
        "Author or revise the explicit Canon document using repository documentation guidance; no init command is implied.",
        "architecture",
      ],
      ["Validate the authored Canon before producing derived documentation.", "architecture.validate"],
      ["Render the validated Canon into a retained static site.", "architecture.render"],
    ],
    invariants: [
      "Authoring remains a deliberate file-editing step; Wabachi does not invent an init or edit command.",
      "Validation and rendering operate on an explicit Canon file and preserve existing execution semantics.",
      "Keep the generated site and source Canon together when the result is intended for review or publication.",
    ],
    canonicalCommandId: "architecture",
  }),
];

export interface SkillIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly whenToUse: string;
}

export interface SkillIndexProjection {
  readonly version: typeof SKILL_MODEL_VERSION;
  readonly scenarios: readonly SkillIndexEntry[];
}

export interface SkillScenarioProjection extends SkillScenario {
  readonly version: typeof SKILL_MODEL_VERSION;
}

export function findSkillScenario(id: string): SkillScenario | undefined {
  return SKILL_SCENARIOS.find((scenario) => scenario.id === id);
}

export function projectSkillIndexToJson(): SkillIndexProjection {
  return {
    version: SKILL_MODEL_VERSION,
    scenarios: SKILL_SCENARIOS.map(({ id, title, whenToUse }) => ({ id, title, whenToUse })),
  };
}

export function projectSkillIndexToText(): string {
  const lines = [`Wabachi skill scenarios (v${SKILL_MODEL_VERSION}):`, ""];
  for (const scenario of SKILL_SCENARIOS) {
    lines.push(`  ${scenario.id} - ${scenario.title}`);
    lines.push(`    ${scenario.whenToUse}`);
  }
  lines.push("", "Run `wabachi skill <scenario>` for one bounded playbook.");
  return lines.join("\n");
}

export function projectSkillScenarioToJson(scenario: SkillScenario): SkillScenarioProjection {
  return {
    version: SKILL_MODEL_VERSION,
    ...scenario,
    workflow: scenario.workflow.map((step) => workflowStep(step.summary, step.commandId)),
  };
}

export function projectSkillScenarioToText(scenario: SkillScenario): string {
  const projected = projectSkillScenarioToJson(scenario);
  const lines = [`${projected.title} (${projected.id})`, "", `When to use: ${projected.whenToUse}`, "", "Workflow:"];
  projected.workflow.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.summary}`);
    lines.push(`     Command: ${step.command}`);
    lines.push(`     Example: ${step.example}`);
    lines.push(`     Help: ${step.helpPointer}`);
  });
  lines.push("", "Invariants:");
  for (const invariant of projected.invariants) lines.push(`  - ${invariant}`);
  lines.push("", `Canonical entrypoint: ${projected.canonicalEntrypoint}`, `Exact syntax: ${projected.helpPointer}`);
  return lines.join("\n");
}
