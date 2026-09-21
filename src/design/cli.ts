import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalArchitectureDocument } from "../architecture/canon/codec.js";
import { projectCommandHelp, renderCommandHelp } from "../command-contract.js";
import { canonicalizeJson } from "./digest.js";
import { decodeExternalCertificationInput } from "./certification/codec.js";
import { validateDesignReviewEvidence } from "./review/codec.js";
import { parseDesignArguments } from "./cli/arguments.js";
import { designReadOutput, executeDesignRead } from "./cli/read.js";
import { buildDesignIntentSite } from "./projection/site.js";
import { createDesignRuntime, type DesignRuntime } from "./runtime.js";

interface WorkflowArguments {
  readonly command?: string;
  readonly changeId?: string;
  readonly input?: string;
  readonly output?: string;
  readonly section?: string;
  readonly json: boolean;
  readonly force: boolean;
  readonly positional: readonly string[];
}

function failure(message: string, json: boolean, command = "design"): number {
  if (json) console.log(JSON.stringify({ ok: false, command, diagnostics: [{ code: "invalid-arguments", message }] }));
  else console.error(message);
  return 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWorkflowArguments(
  args: readonly string[],
): WorkflowArguments | { readonly error: string; readonly json: boolean } {
  const input = args[0] === "design" ? args.slice(1) : [...args];
  const command = input[0]?.startsWith("-") === true ? undefined : input[0];
  const positional: string[] = [];
  let json = false;
  let force = false;
  let inputPath: string | undefined;
  let output: string | undefined;
  let section: string | undefined;
  let changeId: string | undefined;
  for (let index = command === undefined ? 0 : 1; index < input.length; index += 1) {
    const token = input[index];
    if (token === "--json") {
      if (json) return { error: "--json may be provided only once", json };
      json = true;
      continue;
    }
    if (token === "--force") {
      if (force) return { error: "--force may be provided only once", json };
      force = true;
      continue;
    }
    const option = token === "--input" || token === "--out" || token === "--section" || token === "--change-id";
    if (option) {
      const value = input[index + 1];
      if (value === undefined || value.startsWith("--")) return { error: `${token} requires a value`, json };
      if (token === "--input") {
        if (inputPath !== undefined) return { error: "--input may be provided only once", json };
        inputPath = value;
      } else if (token === "--out") {
        if (output !== undefined) return { error: "--out may be provided only once", json };
        output = value;
      } else if (token === "--section") {
        if (section !== undefined) return { error: "--section may be provided only once", json };
        section = value;
      } else {
        if (changeId !== undefined || positional.length > 0)
          return { error: "change-id may be provided only once", json };
        changeId = value;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--")) return { error: `unknown Design option: ${token}`, json };
    positional.push(token);
  }
  if (changeId !== undefined) positional.unshift(changeId);
  return { command, input: inputPath, output, section, json, force, positional };
}

async function inputJson(runtime: DesignRuntime, file: string | undefined): Promise<unknown> {
  if (file === undefined) throw new Error("--input <path> is required");
  const source = await readFile(path.resolve(runtime.repositoryRoot, file), "utf8");
  return JSON.parse(source) as unknown;
}

function output(value: unknown, json: boolean): number {
  console.log(json ? canonicalizeJson(value) : typeof value === "string" ? value : canonicalizeJson(value));
  return 0;
}

function commandChangeId(parsed: WorkflowArguments): string {
  const value = parsed.positional[0];
  if (value === undefined || value.length === 0) throw new Error("change-id is required");
  return value;
}

async function executeWorkflow(runtime: DesignRuntime, parsed: WorkflowArguments): Promise<number> {
  const command = parsed.command;
  if (command === undefined) {
    const projection = projectCommandHelp(["design"]);
    if (projection === undefined) return failure("Design command is required", parsed.json);
    return output(renderCommandHelp(projection), false);
  }
  if (["show", "diff", "status", "validate"].includes(command)) {
    const parsedRead = parseDesignArguments([
      "design",
      command,
      ...parsed.positional.slice(0, 1),
      ...(parsed.section === undefined ? [] : ["--section", parsed.section]),
      ...(parsed.json ? ["--json"] : []),
    ]);
    if (!parsedRead.ok || parsedRead.value.command === undefined)
      return failure(parsedRead.ok ? "change-id is required" : parsedRead.message, parsed.json, `design ${command}`);
    const result = await executeDesignRead(parsedRead.value, runtime.ports);
    const rendered = designReadOutput(result, parsed.json);
    console.log(rendered.output);
    return rendered.exitCode;
  }

  if (command === "recover") return output(await runtime.application.recover(parsed.positional[0]), parsed.json);
  const changeId = commandChangeId(parsed);
  if (command === "create" || command === "amend") {
    if (parsed.positional.length < (command === "create" ? 2 : 2) && parsed.input === undefined) {
      return failure("a target Canon path or --input <path> is required", parsed.json, `design ${command}`);
    }
    const targetPath = parsed.input ?? parsed.positional[1];
    const target = parseCanonicalArchitectureDocument(
      await readFile(path.resolve(runtime.repositoryRoot, targetPath as string), "utf8"),
    );
    const current = await runtime.ports.canon.readCurrent();
    const result =
      command === "create"
        ? await runtime.application.create({
            changeId,
            base: current.revision,
            baseCanon: current.document,
            targetCanon: target,
          })
        : await runtime.application.amend(changeId, {
            changeId,
            base: current.revision,
            baseCanon: current.document,
            targetCanon: target,
          });
    return output(result, parsed.json);
  }
  if (command === "submit") return output(await runtime.application.submit(changeId), parsed.json);
  if (command === "start") return output(await runtime.application.start(changeId), parsed.json);
  if (command === "rework") return output(await runtime.application.rework(changeId), parsed.json);
  if (command === "promote") return output(await runtime.application.promote(changeId), parsed.json);
  if (command === "review") {
    const evidence = validateDesignReviewEvidence(await inputJson(runtime, parsed.input));
    if (evidence.changeId !== changeId) throw new Error("review evidence change-id does not match the command");
    return output(await runtime.application.review(evidence), parsed.json);
  }
  if (command === "link") {
    const link = await inputJson(runtime, parsed.input);
    if (
      typeof link !== "object" ||
      link === null ||
      Array.isArray(link) ||
      !("changeId" in link) ||
      link.changeId !== changeId
    ) {
      throw new Error("implementation link change-id does not match the command");
    }
    return output(await runtime.application.link(link), parsed.json);
  }
  if (command === "certify") {
    const raw = await inputJson(runtime, parsed.input);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error("certification input must be an object");
    const external = decodeExternalCertificationInput(raw);
    if (external.changeId !== changeId) throw new Error("certification input change-id does not match the command");
    return output(await runtime.application.certify({ ...raw, ...external, changeId }), parsed.json);
  }
  if (command === "render") {
    if (parsed.output === undefined) return failure("--out <dir> is required", parsed.json, "design render");
    const result = await executeDesignRead({ command: "show", changeId }, runtime.ports);
    if (!result.ok || !("view" in result.data)) {
      console.log(designReadOutput(result, parsed.json).output);
      return result.exitCode;
    }
    const site = await buildDesignIntentSite({
      outputRoot: path.resolve(parsed.output),
      view: result.data.view,
      lifecycle: result.data.lifecycle,
    });
    return output(site, parsed.json);
  }
  return failure(`unknown Design command: ${command}`, parsed.json);
}

export async function runDesignCli(args: readonly string[]): Promise<number> {
  const parsed = parseWorkflowArguments(args);
  if ("error" in parsed) return failure(parsed.error, parsed.json);
  try {
    const runtime = await createDesignRuntime();
    return await executeWorkflow(runtime, parsed);
  } catch (error) {
    return failure(errorMessage(error), parsed.json, `design ${parsed.command ?? ""}`.trim());
  }
}
