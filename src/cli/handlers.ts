import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bindHandlers } from "@yohn-jp/cli-canon";
import {
  executeArchitectureExample,
  executeArchitectureRender,
  executeArchitectureValidate,
} from "../architecture/cli.js";
import { executeDesignCommand } from "../design/cli.js";
import { createFixtureProvider } from "../runtime/fixtureProvider.js";
import { createGraftProvider } from "../runtime/graftProvider.js";
import { run } from "../runtime/run.js";
import { createScipTypescriptProvider } from "../runtime/scipProvider.js";
import { createTypeScriptProvider } from "../runtime/typescriptProvider.js";
import { runProviderMatrix } from "../runtime/workflow.js";
import {
  findSkillScenario,
  projectSkillIndexToJson,
  projectSkillIndexToText,
  projectSkillScenarioToJson,
  projectSkillScenarioToText,
} from "../skill.js";
import { commandOutput, jsonMachine, wabachiDomainError } from "./result.js";
import { wabachiCommands } from "./commands.js";

async function executeRun(input: { readonly source: string; readonly revision?: string; readonly output?: string }) {
  try {
    const runRoot = input.output ?? (await mkdtemp(path.join(os.tmpdir(), "wabachi-run-")));
    const { manifestPath } = await run({
      source: input.source,
      revision: input.revision,
      runRoot,
      providers: [
        createFixtureProvider(),
        createTypeScriptProvider(),
        createGraftProvider(),
        createScipTypescriptProvider(),
      ],
    });
    return commandOutput(`${manifestPath}\n`, jsonMachine({ manifestPath }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw wabachiDomainError(`${message}\n`, jsonMachine({ ok: false, command: "run", diagnostics: [{ message }] }));
  }
}

async function executeMatrix(input: {
  readonly source?: string;
  readonly revision?: string;
  readonly output: string;
  readonly config?: string;
}) {
  let source = input.source;
  let revision = input.revision;
  let configuredProviderIds: string[] | undefined;
  let configuredAdditionOrder: string[] | undefined;

  try {
    if (input.config !== undefined) {
      const config = JSON.parse(await readFile(input.config, "utf8")) as {
        source?: unknown;
        revision?: unknown;
        providers?: unknown;
        additionOrder?: unknown;
      };
      if (typeof config.source !== "string" || typeof config.revision !== "string") {
        throw new Error("workflow config must contain string source and revision");
      }
      if (!isStringArray(config.providers) || !isStringArray(config.additionOrder)) {
        throw new Error("workflow config must contain provider and additionOrder string arrays");
      }
      source = config.source;
      revision = config.revision;
      configuredProviderIds = config.providers;
      configuredAdditionOrder = config.additionOrder;
    }
    if (source === undefined) throw new Error("matrix requires a repository or --config <path>");
    if (revision === undefined) throw new Error("matrix requires --revision <40-character commit SHA>");

    const providers = [createTypeScriptProvider(), createGraftProvider(), createScipTypescriptProvider()];
    const providerIds = providers.map((provider) => provider.identity.id);
    if (configuredProviderIds !== undefined && !sameStrings(configuredProviderIds, providerIds)) {
      throw new Error(`workflow config provider set does not match registered providers: ${providerIds.join(", ")}`);
    }
    const configuredOrder =
      configuredAdditionOrder === undefined
        ? undefined
        : configuredAdditionOrder.map((id) => {
            const provider = providers.find((candidate) => candidate.identity.id === id);
            if (provider === undefined) throw new Error(`workflow config names an unknown provider: ${id}`);
            return provider.identity;
          });
    const result = await runProviderMatrix({
      source,
      revision,
      runRoot: input.output,
      providers,
      additionOrder: configuredOrder,
    });
    return commandOutput(
      `${result.matrixPaths.reportPath}\n`,
      jsonMachine({ reportPath: result.matrixPaths.reportPath }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw wabachiDomainError(`${message}\n`, jsonMachine({ ok: false, command: "matrix", diagnostics: [{ message }] }));
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function executeSkill(scenarioId?: string) {
  if (scenarioId === undefined) {
    return commandOutput(`${projectSkillIndexToText()}\n`, jsonMachine(projectSkillIndexToJson()));
  }

  const scenario = findSkillScenario(scenarioId);
  if (scenario === undefined) {
    const message = `unknown skill scenario: ${scenarioId}`;
    throw wabachiDomainError(
      `${message}\n`,
      jsonMachine({ ok: false, command: "skill", diagnostics: [{ code: "unknown-scenario", message }] }),
    );
  }

  return commandOutput(`${projectSkillScenarioToText(scenario)}\n`, jsonMachine(projectSkillScenarioToJson(scenario)));
}

export const wabachiHandlers = bindHandlers(wabachiCommands)({
  "architecture.example": () => executeArchitectureExample(),
  "architecture.validate": ({ file }) => executeArchitectureValidate(file),
  "architecture.render": ({ file, output }) => executeArchitectureRender(file, output),
  "run.execute": (input) => executeRun(input),
  "matrix.execute": (input) => executeMatrix(input),
  "design.create": (input) => executeDesignCommand("create", input),
  "design.show": (input) => executeDesignCommand("show", input),
  "design.diff": (input) => executeDesignCommand("diff", input),
  "design.status": (input) => executeDesignCommand("status", input),
  "design.validate": (input) => executeDesignCommand("validate", input),
  "design.amend": (input) => executeDesignCommand("amend", input),
  "design.submit": (input) => executeDesignCommand("submit", input),
  "design.review": (input) => executeDesignCommand("review", input),
  "design.start": (input) => executeDesignCommand("start", input),
  "design.link": (input) => executeDesignCommand("link", input),
  "design.certify": (input) => executeDesignCommand("certify", input),
  "design.rework": (input) => executeDesignCommand("rework", input),
  "design.promote": (input) => executeDesignCommand("promote", input),
  "design.recover": (input) => executeDesignCommand("recover", input),
  "design.render": (input) => executeDesignCommand("render", input),
  "skill.execute": ({ scenario }) => executeSkill(scenario),
});
