import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalArchitectureDocument } from "./canon/codec.js";
import { projectArchitectureDocument } from "./documentation/project.js";
import { ArchitectureSiteError, buildArchitectureSite } from "./documentation/site.js";
import { projectArchitectureDocumentToReactFlow } from "./projection/react-flow.js";
import { commandUsage, DEFAULT_ARCHITECTURE_CANON_PATH } from "../command-contract.js";

const MAX_DIAGNOSTIC_LENGTH = 240;

type ArchitectureCommand = "example" | "validate" | "render";

interface ArchitectureArgs {
  readonly command: ArchitectureCommand;
  readonly file?: string;
  readonly outputRoot?: string;
  readonly json: boolean;
}

interface ArchitectureDiagnostic {
  readonly code: string;
  readonly message: string;
}

function usage(command?: ArchitectureCommand): string {
  if (command === "validate") return commandUsage("architecture.validate");
  if (command === "render") return commandUsage("architecture.render");
  return commandUsage("architecture.help");
}

function bounded(value: string): string {
  const message = value.replace(/\s+/gu, " ").trim();
  if (message.length <= MAX_DIAGNOSTIC_LENGTH) return message;
  return `${message.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return bounded(error instanceof Error ? error.message : String(error));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function parseArguments(
  args: readonly string[],
):
  | { readonly ok: true; readonly value: ArchitectureArgs }
  | { readonly ok: false; readonly json: boolean; readonly message: string } {
  const command = args[0];
  const json = args.includes("--json");
  if (command !== "example" && command !== "validate" && command !== "render") {
    return { ok: false, json, message: usage() };
  }

  let file: string | undefined;
  let outputRoot: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") continue;

    if (argument === "--out") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, json, message: "--out requires a directory" };
      }
      if (outputRoot !== undefined) return { ok: false, json, message: "--out may be provided only once" };
      outputRoot = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) return { ok: false, json, message: `unknown option: ${argument}` };
    if (file !== undefined) return { ok: false, json, message: "architecture commands accept one explicit file" };
    file = argument;
  }

  if (command === "example" && file !== undefined) {
    return { ok: false, json, message: "architecture example does not accept a file" };
  }
  if (command === "validate" && outputRoot !== undefined) {
    return { ok: false, json, message: "validate does not accept render options" };
  }
  if (command === "render" && outputRoot === undefined) {
    return { ok: false, json, message: "render requires --out <dir>" };
  }

  return { ok: true, value: { command, file, outputRoot, json } };
}

function writeFailure(command: ArchitectureCommand, json: boolean, diagnostic: ArchitectureDiagnostic): number {
  const result = {
    ok: false,
    command: `architecture ${command}`,
    diagnostics: [{ code: bounded(diagnostic.code), message: bounded(diagnostic.message) }],
  };
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    console.error(`${result.command}: ${result.diagnostics[0]?.message ?? "command failed"}`);
  }
  return 1;
}

function writeUsageFailure(json: boolean, message: string): number {
  const diagnostic = { code: "invalid-arguments", message: bounded(message) };
  if (json) {
    console.log(JSON.stringify({ ok: false, command: "architecture", diagnostics: [diagnostic] }));
  } else {
    console.error(diagnostic.message);
  }
  return 1;
}

/** Adapt the public architecture CLI to the existing Canon and projection APIs. */
export async function runArchitectureCli(args: readonly string[]): Promise<number> {
  const parsed = parseArguments(args);
  if (!parsed.ok) return writeUsageFailure(parsed.json, parsed.message);

  const { command, json } = parsed.value;
  if (command === "example") {
    try {
      const source = await readFile(new URL("../../docs/examples/minimal-canon.json", import.meta.url), "utf8");
      parseCanonicalArchitectureDocument(source);
      console.log(source.trim());
      return 0;
    } catch (error) {
      return writeFailure(command, json, { code: "example-unavailable", message: errorMessage(error) });
    }
  }

  const file = parsed.value.file ?? DEFAULT_ARCHITECTURE_CANON_PATH;
  let document;
  try {
    document = parseCanonicalArchitectureDocument(await readFile(file, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return writeFailure(command, json, {
        code: "invalid-canon",
        message: `architecture document not found: ${file}`,
      });
    }
    return writeFailure(command, json, { code: "invalid-canon", message: errorMessage(error) });
  }

  if (command === "validate") {
    if (json) {
      console.log(JSON.stringify({ ok: true, command: "architecture validate", file }));
    } else {
      console.log(`valid Architecture Canon: ${file}`);
    }
    return 0;
  }

  try {
    const documentation = projectArchitectureDocument(document);
    const reactFlow = await projectArchitectureDocumentToReactFlow(document);
    const result = await buildArchitectureSite({
      outputRoot: path.resolve(parsed.value.outputRoot as string),
      documentation,
      reactFlow,
    });

    if (json) {
      console.log(
        JSON.stringify({
          ok: true,
          command: "architecture render",
          file,
          outputRoot: result.outputRoot,
          projectionLosses: result.losses.length,
        }),
      );
    } else {
      console.log(`rendered architecture site: ${result.outputRoot}`);
    }
    return 0;
  } catch (error) {
    const code = error instanceof ArchitectureSiteError ? error.code : "render-failed";
    return writeFailure(command, json, { code, message: errorMessage(error) });
  }
}
