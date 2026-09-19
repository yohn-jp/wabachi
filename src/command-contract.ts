/**
 * The versioned authority for Wabachi's public command surface.
 *
 * Runtime execution remains in the existing CLI modules.  Syntax, options,
 * examples, and discovery projections are derived from this model so help,
 * skills, and the manual's routing guidance cannot grow separate contracts.
 */

export const COMMAND_CONTRACT_VERSION = "1.0.0" as const;
export const COMMAND_CONTRACT_ID = `urn:wabachi:command-contract:${COMMAND_CONTRACT_VERSION}` as const;
export const CLI_NAME = "wabachi" as const;

export type CommandDomain = "root" | "run" | "matrix" | "architecture" | "skill";
export type OptionValueType = "boolean" | "string";
export type OptionArity = "none" | "required" | "optional";
export type CommandId =
  | "root.help"
  | "root.version"
  | "run.execute"
  | "matrix.execute"
  | "architecture.help"
  | "architecture.validate"
  | "architecture.render"
  | "skill.index"
  | "skill.scenario";
export type OptionId = "help" | "version" | "json" | "revision" | "out" | "config" | "structurizrCommand";

export interface CommandOptionDefinition {
  readonly id: OptionId;
  readonly key: string;
  readonly aliases: readonly string[];
  readonly valueType: OptionValueType;
  readonly arity: OptionArity;
  readonly placeholder?: string;
  readonly description: string;
}

export interface CommandDefinition {
  readonly id: CommandId;
  readonly domain: CommandDomain;
  readonly operation: string;
  readonly path: readonly string[];
  readonly positionalSyntax?: string;
  readonly optionIds: readonly OptionId[];
  readonly summary: string;
  readonly examples: readonly string[];
}

const option = (
  id: OptionId,
  aliases: readonly string[],
  valueType: OptionValueType,
  arity: OptionArity,
  description: string,
  placeholder?: string,
): CommandOptionDefinition => ({
  id,
  key: aliases[0]?.replace(/^--/u, "") ?? id,
  aliases,
  valueType,
  arity,
  ...(placeholder === undefined ? {} : { placeholder }),
  description,
});

export const COMMAND_OPTIONS: Readonly<Record<OptionId, CommandOptionDefinition>> = {
  help: option(
    "help",
    ["--help"],
    "string",
    "optional",
    "Show progressive help; use --help=full for the complete command reference or --help=json for discovery.",
    "full|json",
  ),
  version: option("version", ["--version"], "boolean", "none", "Print the installed Wabachi version."),
  json: option("json", ["--json"], "boolean", "none", "Emit machine-readable JSON where supported."),
  revision: option(
    "revision",
    ["--revision"],
    "string",
    "required",
    "Repository revision or commit SHA to analyze.",
    "ref",
  ),
  out: option("out", ["--out"], "string", "required", "Directory in which retained artifacts are written.", "dir"),
  config: option(
    "config",
    ["--config"],
    "string",
    "required",
    "JSON workflow configuration for the provider matrix.",
    "path",
  ),
  structurizrCommand: option(
    "structurizrCommand",
    ["--structurizr-command"],
    "string",
    "required",
    "Structurizr CLI executable used for static export.",
    "executable-path",
  ),
};

const command = (
  id: CommandId,
  domain: CommandDomain,
  operation: string,
  path: readonly string[],
  summary: string,
  optionIds: readonly OptionId[],
  examples: readonly string[],
  positionalSyntax?: string,
): CommandDefinition => ({
  id,
  domain,
  operation,
  path,
  summary,
  optionIds,
  examples,
  ...(positionalSyntax === undefined ? {} : { positionalSyntax }),
});

export const COMMANDS: readonly CommandDefinition[] = [
  command(
    "root.help",
    "root",
    "help",
    [],
    "Discover supported commands and resolve exact syntax progressively.",
    ["help", "version"],
    ["wabachi --help", "wabachi --help=full"],
    "[command]",
  ),
  command("root.version", "root", "version", [], "Print the installed version.", ["version"], ["wabachi --version"]),
  command(
    "run.execute",
    "run",
    "execute",
    ["run"],
    "Resolve a repository and execute the registered analysis providers.",
    ["help", "revision", "out"],
    ["wabachi run <repository> --revision <ref> --out <dir>", "wabachi run <repository>"],
    "<repository>",
  ),
  command(
    "matrix.execute",
    "matrix",
    "execute",
    ["matrix"],
    "Run providers and retain auditable facts, correlations, matrices, and reports.",
    ["help", "revision", "out", "config"],
    ["wabachi matrix <repository> --revision <sha> --out <dir>", "wabachi matrix --config <path>"],
    "<repository>",
  ),
  command(
    "architecture.help",
    "architecture",
    "help",
    ["architecture"],
    "Discover Architecture Canon validation and rendering commands.",
    ["help"],
    ["wabachi architecture --help"],
  ),
  command(
    "architecture.validate",
    "architecture",
    "validate",
    ["architecture", "validate"],
    "Validate one explicit Architecture Canon document.",
    ["help", "json"],
    ["wabachi architecture validate <file> --json"],
    "<file>",
  ),
  command(
    "architecture.render",
    "architecture",
    "render",
    ["architecture", "render"],
    "Render one explicit Architecture Canon document as a site.",
    ["help", "out", "structurizrCommand", "json"],
    ["wabachi architecture render <file> --out <dir>", "wabachi architecture render <file> --out <dir> --json"],
    "<file>",
  ),
  command(
    "skill.index",
    "skill",
    "index",
    ["skill"],
    "List bounded intent-oriented Wabachi playbooks.",
    ["help", "json"],
    ["wabachi skill", "wabachi skill --json"],
  ),
  command(
    "skill.scenario",
    "skill",
    "scenario",
    ["skill"],
    "Print one bounded playbook for a named intent.",
    ["help", "json"],
    ["wabachi skill <scenario>", "wabachi skill <scenario> --json"],
    "<scenario>",
  ),
];

const commandsById = new Map(COMMANDS.map((entry) => [entry.id, entry]));
const optionsByAlias = new Map<string, CommandOptionDefinition>();
for (const definition of Object.values(COMMAND_OPTIONS)) {
  for (const alias of definition.aliases) optionsByAlias.set(alias, definition);
}

export function getCommand(id: CommandId): CommandDefinition {
  const definition = commandsById.get(id);
  if (definition === undefined) throw new Error(`Unknown Wabachi command contract id: ${id}`);
  return definition;
}

export function getOption(id: OptionId): CommandOptionDefinition {
  return COMMAND_OPTIONS[id];
}

export function getOptionForToken(token: string): CommandOptionDefinition | undefined {
  return optionsByAlias.get(token.split("=", 1)[0]);
}

export function getDomainCommands(domain: Exclude<CommandDomain, "root">): readonly CommandDefinition[] {
  return COMMANDS.filter((entry) => entry.domain === domain);
}

export function commandInvocation(id: CommandId): string {
  const definition = getCommand(id);
  return [CLI_NAME, ...definition.path].join(" ");
}

export function commandHelpPointer(id: CommandId): string {
  const definition = getCommand(id);
  return definition.path.length === 0 ? `${CLI_NAME} --help` : `${commandInvocation(id)} --help`;
}

export function optionSyntax(definition: CommandOptionDefinition): string {
  const name = definition.aliases[0] ?? `--${definition.id}`;
  if (definition.arity === "none") return name;
  if (definition.arity === "optional") return `${name}[=${definition.placeholder ?? "value"}]`;
  return `${name} <${definition.placeholder ?? "value"}>`;
}

export function commandUsage(id: CommandId): string {
  const definition = getCommand(id);
  const pathText = [CLI_NAME, ...definition.path].join(" ");
  const positional = definition.positionalSyntax === undefined ? "" : ` ${definition.positionalSyntax}`;
  const options = definition.optionIds.map((optionId) => ` [${optionSyntax(getOption(optionId))}]`).join("");
  return `usage: ${pathText}${positional}${options}`;
}

export function commandExample(id: CommandId): string {
  return getCommand(id).examples[0] ?? commandInvocation(id);
}

/** Extract positional tokens while ignoring contract-owned option values. */
export function positionalTokens(argv: readonly string[]): readonly string[] {
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const definition = getOptionForToken(token);
      if (definition?.arity === "required" && !token.includes("=")) index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    positionals.push(token);
  }
  return positionals;
}

export function getCommandForPositionals(positionals: readonly string[]): CommandDefinition | undefined {
  if (positionals.length === 0) return getCommand("root.help");
  return COMMANDS.find((entry) => {
    if (entry.domain === "root" || positionals.length < entry.path.length) return false;
    if (!entry.path.every((part, index) => positionals[index] === part)) return false;
    const maximumPositionals = entry.positionalSyntax === undefined ? entry.path.length : entry.path.length + 1;
    return positionals.length <= maximumPositionals;
  });
}

export type HelpMode = "summary" | "full" | "json";

export interface HelpCommandEntry {
  readonly id: CommandId;
  readonly usage: string;
  readonly summary: string;
}

export interface HelpOptionEntry {
  readonly id: OptionId;
  readonly syntax: string;
  readonly description: string;
}

export interface CommandHelpProjection {
  readonly contract: typeof COMMAND_CONTRACT_ID;
  readonly kind: "root" | "domain" | "leaf";
  readonly commandId: CommandId;
  readonly usage: string;
  readonly summary: string;
  readonly commands: readonly HelpCommandEntry[];
  readonly options: readonly HelpOptionEntry[];
  readonly examples: readonly string[];
}

function helpEntries(commands: readonly CommandDefinition[]): readonly HelpCommandEntry[] {
  return commands.map((entry) => ({ id: entry.id, usage: commandUsage(entry.id), summary: entry.summary }));
}

export function projectCommandHelp(
  positionals: readonly string[],
  mode: HelpMode = "summary",
): CommandHelpProjection | undefined {
  const commandDefinition = getCommandForPositionals(positionals);
  if (commandDefinition === undefined) return undefined;

  const isRoot = commandDefinition.id === "root.help";
  const isDomain = commandDefinition.id === "architecture.help" || commandDefinition.id === "skill.index";
  const children = isRoot
    ? COMMANDS.filter((entry) =>
        ["run.execute", "matrix.execute", "architecture.help", "skill.index"].includes(entry.id),
      )
    : isDomain
      ? COMMANDS.filter((entry) => entry.domain === commandDefinition.domain && entry.id !== commandDefinition.id)
      : [];
  const listedCommands = mode === "full" && isRoot ? COMMANDS.filter((entry) => entry.domain !== "root") : children;
  const optionEntries = commandDefinition.optionIds.map((optionId) => {
    const definition = getOption(optionId);
    return { id: optionId, syntax: optionSyntax(definition), description: definition.description };
  });
  return {
    contract: COMMAND_CONTRACT_ID,
    kind: isRoot ? "root" : isDomain ? "domain" : "leaf",
    commandId: commandDefinition.id,
    usage: commandUsage(commandDefinition.id),
    summary: commandDefinition.summary,
    commands: helpEntries(listedCommands),
    options: optionEntries,
    examples: commandDefinition.examples,
  };
}

export function renderCommandHelp(projection: CommandHelpProjection): string {
  const lines = [
    `Wabachi help (${projection.contract})`,
    "",
    `Usage: ${projection.usage.replace(/^usage: /u, "")}`,
    projection.summary,
  ];
  if (projection.commands.length > 0) {
    lines.push("", "Commands:");
    for (const entry of projection.commands) lines.push(`  ${entry.usage.replace(/^usage: /u, "")}  ${entry.summary}`);
  }
  if (projection.options.length > 0) {
    lines.push("", "Options:");
    for (const optionEntry of projection.options) lines.push(`  ${optionEntry.syntax}  ${optionEntry.description}`);
  }
  if (projection.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of projection.examples) lines.push(`  ${example}`);
  }
  return lines.join("\n");
}

export interface HelpRequest {
  readonly positionals: readonly string[];
  readonly mode: HelpMode;
}

export function parseHelpRequest(argv: readonly string[]): HelpRequest | undefined {
  const helpToken = argv.find((token) => token === "--help" || token.startsWith("--help="));
  if (helpToken === undefined) return undefined;
  const value = helpToken.includes("=") ? helpToken.slice(helpToken.indexOf("=") + 1) : "summary";
  const mode: HelpMode = value === "full" || value === "json" ? value : "summary";
  return { positionals: positionalTokens(argv), mode };
}
