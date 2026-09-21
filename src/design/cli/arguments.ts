import type { DesignChangeSection } from "../contracts.js";

/** The read-only Design leaves implemented by this adapter. */
export type DesignReadCommand = "show" | "diff" | "status" | "validate";

export type DesignHelpMode = "summary" | "full" | "json";

export const DESIGN_READ_COMMANDS: readonly DesignReadCommand[] = ["show", "diff", "status", "validate"];

export const DESIGN_CHANGE_SECTIONS: readonly DesignChangeSection[] = [
  "elements",
  "interfaces",
  "relationships",
  "responsibilities",
  "authority",
  "boundaries",
  "constraints",
  "flows",
  "deployment",
  "repositoryMappings",
  "decisions",
  "views",
  "codeIntent",
];

export interface DesignArguments {
  readonly domain: "design";
  readonly command?: DesignReadCommand;
  readonly changeId?: string;
  readonly section?: DesignChangeSection;
  readonly json: boolean;
  readonly help?: DesignHelpMode;
}

export interface DesignArgumentsSuccess {
  readonly ok: true;
  readonly value: DesignArguments;
}

export interface DesignArgumentsFailure {
  readonly ok: false;
  readonly json: boolean;
  readonly message: string;
}

export type DesignArgumentsResult = DesignArgumentsSuccess | DesignArgumentsFailure;

function isChangeSection(value: string): value is DesignChangeSection {
  return DESIGN_CHANGE_SECTIONS.includes(value as DesignChangeSection);
}

function isDesignReadCommand(value: string | undefined): value is DesignReadCommand {
  return value !== undefined && DESIGN_READ_COMMANDS.includes(value as DesignReadCommand);
}

function helpMode(value: string): DesignHelpMode | undefined {
  if (value === "summary" || value === "full" || value === "json") return value;
  return undefined;
}

function malformedIdentifier(value: string): boolean {
  return value.length === 0 || /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}

function usage(command?: DesignReadCommand): string {
  if (command === undefined)
    return "usage: wabachi design <show|diff|status|validate> <change-id> [--section <section>] [--json]";
  const section = command === "show" || command === "diff" ? " [--section <section>]" : "";
  return `usage: wabachi design ${command} <change-id>${section} [--json]`;
}

function failure(message: string, json: boolean): DesignArgumentsFailure {
  return { ok: false, json, message };
}

/**
 * Parse the bounded read-only Design command surface.
 *
 * The parser accepts either argv after `design` (the form used by a router)
 * or a complete `design ...` argv. It deliberately does not consume unknown
 * leaves or options: an unknown Design command must never be dispatched to a
 * different command family.
 */
export function parseDesignArguments(argv: readonly string[]): DesignArgumentsResult {
  const args = argv[0] === "design" ? argv.slice(1) : [...argv];
  let json = false;
  let command: DesignReadCommand | undefined;
  let changeId: string | undefined;
  let section: DesignChangeSection | undefined;
  let help: DesignHelpMode | undefined;
  let changeIdOption = false;
  let sectionOption = false;
  let helpOption = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;

    if (argument === "--json") {
      if (json) return failure("--json may be provided only once", json);
      json = true;
      continue;
    }

    if (argument === "--help" || argument.startsWith("--help=")) {
      if (helpOption) return failure("--help may be provided only once", json);
      const value = argument === "--help" ? "summary" : argument.slice("--help=".length);
      const parsedHelp = helpMode(value);
      if (parsedHelp === undefined) return failure("--help accepts summary, full, or json", json);
      help = parsedHelp;
      helpOption = true;
      continue;
    }

    if (argument === "--change-id") {
      if (changeIdOption) return failure("--change-id may be provided only once", json);
      if (changeId !== undefined)
        return failure("change-id may be provided either positionally or with --change-id", json);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return failure("--change-id requires a value", json);
      if (malformedIdentifier(value)) return failure("--change-id must be a non-empty identifier", json);
      changeId = value.normalize("NFC");
      changeIdOption = true;
      index += 1;
      continue;
    }

    if (argument === "--section") {
      if (sectionOption) return failure("--section may be provided only once", json);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return failure("--section requires a value", json);
      if (!isChangeSection(value)) return failure(`unknown Design section: ${value}`, json);
      section = value;
      sectionOption = true;
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) return failure(`unknown Design option: ${argument}`, json);

    if (command === undefined) {
      if (!isDesignReadCommand(argument)) return failure(`unknown Design leaf: ${argument}`, json);
      command = argument;
      continue;
    }

    if (changeId !== undefined) return failure("Design commands accept one change-id", json);
    if (malformedIdentifier(argument)) return failure("change-id must be a non-empty identifier", json);
    changeId = argument.normalize("NFC");
  }

  if (command === undefined) {
    return { ok: true, value: { domain: "design", json, ...(help === undefined ? {} : { help }) } };
  }

  if (help !== undefined) {
    return { ok: true, value: { domain: "design", command, json, ...(help === undefined ? {} : { help }) } };
  }

  if (changeId === undefined) return failure(`${usage(command)}\nchange-id is required`, json);
  if (section !== undefined && command !== "show" && command !== "diff") {
    return failure(`${command} does not accept --section`, json);
  }

  return {
    ok: true,
    value: {
      domain: "design",
      command,
      changeId,
      json,
      ...(section === undefined ? {} : { section }),
    },
  };
}

/** Alias used by callers that name the input a command line rather than arguments. */
export const parseDesignCommandArguments = parseDesignArguments;

/** Stable usage text for help projections and diagnostics. */
export function designCommandUsage(command?: DesignReadCommand): string {
  return usage(command);
}
