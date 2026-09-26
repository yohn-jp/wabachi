import {
  compileProduct,
  jsonOutput,
  textOutput,
  type DomainErrorAdapter,
  type CliOutcome,
  type PresentationMode,
} from "@yohn-jp/cli-canon";
import { runNodeCli } from "@yohn-jp/cli-canon/node";
import type { NodeCliResultPresenter } from "@yohn-jp/cli-canon/node";
import wabachiPackage from "../package.json" with { type: "json" };
import { wabachiCommands, wabachiGroups } from "./cli/commands.js";
import { wabachiHandlers } from "./cli/handlers.js";
import { WabachiDomainError, type WabachiCommandResult } from "./cli/result.js";
import { MAX_SKILL_OUTPUT_BYTES } from "./skill.js";

export const wabachiProduct = compileProduct({
  name: "wabachi",
  description: "Repository analysis and Architecture Canon tooling for deterministic codebase understanding.",
  packageMetadata: wabachiPackage,
  commands: wabachiCommands,
  groups: wabachiGroups,
  handlers: wabachiHandlers,
  schemaProjectionCompleteness: "structural-only",
});

function projectProductResult(
  result: WabachiCommandResult,
  presentation: PresentationMode,
  maxOutputBytes?: number,
): CliOutcome {
  const selected = presentation === "machine" ? result.machine : { kind: "text" as const, value: result.text };
  const options = maxOutputBytes === undefined ? {} : { maxBytes: maxOutputBytes };
  return selected.kind === "json" ? jsonOutput(selected.value, options) : textOutput(selected.value, options);
}

const resultPresenter: NodeCliResultPresenter<typeof wabachiCommands> = {
  success: (execution) =>
    projectProductResult(
      execution.result,
      execution.presentation,
      execution.commandId === "skill.execute" ? MAX_SKILL_OUTPUT_BYTES : undefined,
    ),
};

const domainErrorAdapter: DomainErrorAdapter<WabachiDomainError> = {
  is: (error): error is WabachiDomainError => error instanceof WabachiDomainError,
  map: (error, presentation) => {
    const projected = projectProductResult(error.output, presentation);
    return {
      exitCode: 1,
      stream: presentation === "machine" ? error.streams.machine : error.streams.text,
      output: projected.output,
    };
  },
};

export function runWabachiCli(argv: readonly string[]) {
  return runNodeCli<typeof wabachiCommands, WabachiDomainError>(wabachiProduct, argv, {
    resultPresenter,
    domainErrorAdapter,
  });
}
