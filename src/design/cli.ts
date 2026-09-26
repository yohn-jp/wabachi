import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalArchitectureDocument } from "../architecture/canon/codec.js";
import {
  commandOutput,
  jsonMachine,
  wabachiDomainError,
  WabachiDomainError,
  type WabachiCommandResult,
} from "../cli/result.js";
import { canonicalizeJson } from "./digest.js";
import { decodeExternalCertificationInput } from "./certification/codec.js";
import { validateDesignReviewEvidence } from "./review/codec.js";
import { buildDesignIntentSite } from "./projection/site.js";
import { createDesignRuntime, type DesignRuntime } from "./runtime.js";
import { executeDesignRead, renderDesignReadResult, type DesignReadCommand } from "./cli/read.js";
import type { DesignChangeSection } from "./contracts.js";

type DesignCommand =
  | "create"
  | "show"
  | "diff"
  | "status"
  | "validate"
  | "amend"
  | "submit"
  | "review"
  | "start"
  | "link"
  | "certify"
  | "rework"
  | "promote"
  | "recover"
  | "render";

interface DesignCommandInput {
  readonly changeId?: string;
  readonly changeIdOption?: string;
  readonly canon?: string;
  readonly input?: string;
  readonly output?: string;
  readonly section?: DesignChangeSection;
  readonly force?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function omitUndefinedProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => omitUndefinedProperties(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, omitUndefinedProperties(entry)]),
    );
  }
  return value;
}

function renderDesignCommandOutput(value: unknown): string {
  if (typeof value === "string") return value;
  return canonicalizeJson(omitUndefinedProperties(value));
}

function success(value: unknown): WabachiCommandResult {
  const text = `${renderDesignCommandOutput(value)}\n`;
  return commandOutput(text, jsonMachine(omitUndefinedProperties(value)));
}

function failure(command: DesignCommand, message: string): WabachiDomainError {
  return wabachiDomainError(
    `${message}\n`,
    jsonMachine({
      ok: false,
      command: `design ${command}`,
      diagnostics: [{ code: "invalid-arguments", message }],
    }),
  );
}

function designReadResult(command: DesignReadCommand, changeId: string, section?: DesignChangeSection) {
  return { command, changeId, ...(section === undefined ? {} : { section }) } as const;
}

function readChangeId(input: DesignCommandInput, required: boolean): string | undefined {
  if (input.changeId !== undefined && input.changeIdOption !== undefined) {
    throw new Error("change-id may be provided only once");
  }
  const value = input.changeIdOption ?? input.changeId;
  if (required && value === undefined) throw new Error("change-id is required");
  return value;
}

async function inputJson(runtime: DesignRuntime, file: string | undefined): Promise<unknown> {
  if (file === undefined) throw new Error("--input <path> is required");
  const source = await readFile(path.resolve(runtime.repositoryRoot, file), "utf8");
  return JSON.parse(source) as unknown;
}

function readFailure(result: Awaited<ReturnType<typeof executeDesignRead>>): WabachiDomainError {
  return wabachiDomainError(`${renderDesignReadResult(result)}\n`, jsonMachine(omitUndefinedProperties(result)), {
    text: "stdout",
    machine: "stdout",
  });
}

export async function executeDesignCommand(
  command: DesignCommand,
  input: DesignCommandInput,
): Promise<WabachiCommandResult> {
  try {
    const runtime = await createDesignRuntime();

    if (command === "recover") return success(await runtime.application.recover(readChangeId(input, false)));

    const changeId = readChangeId(input, true) as string;
    if (command === "show" || command === "diff" || command === "status" || command === "validate") {
      const result = await executeDesignRead(designReadResult(command, changeId, input.section), runtime.ports);
      if (result.exitCode !== 0) throw readFailure(result);
      return commandOutput(`${renderDesignReadResult(result)}\n`, jsonMachine(omitUndefinedProperties(result)));
    }

    if (command === "create" || command === "amend") {
      const targetPath = input.input ?? input.canon;
      if (targetPath === undefined) throw new Error("a target Canon path or --input <path> is required");
      const target = parseCanonicalArchitectureDocument(
        await readFile(path.resolve(runtime.repositoryRoot, targetPath), "utf8"),
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
      return success(result);
    }

    if (command === "submit") return success(await runtime.application.submit(changeId));
    if (command === "start") return success(await runtime.application.start(changeId));
    if (command === "rework") return success(await runtime.application.rework(changeId));
    if (command === "promote") return success(await runtime.application.promote(changeId));

    if (command === "review") {
      const evidence = validateDesignReviewEvidence(await inputJson(runtime, input.input));
      if (evidence.changeId !== changeId) throw new Error("review evidence change-id does not match the command");
      return success(await runtime.application.review(evidence));
    }

    if (command === "link") {
      const link = await inputJson(runtime, input.input);
      if (
        typeof link !== "object" ||
        link === null ||
        Array.isArray(link) ||
        !("changeId" in link) ||
        link.changeId !== changeId
      ) {
        throw new Error("implementation link change-id does not match the command");
      }
      return success(await runtime.application.link(link));
    }

    if (command === "certify") {
      const raw = await inputJson(runtime, input.input);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        throw new Error("certification input must be an object");
      const external = decodeExternalCertificationInput(raw);
      if (external.changeId !== changeId) throw new Error("certification input change-id does not match the command");
      return success(await runtime.application.certify({ ...raw, ...external, changeId }));
    }

    if (command === "render") {
      const result = await executeDesignRead({ command: "show", changeId }, runtime.ports);
      if (!result.ok || !("view" in result.data)) throw readFailure(result);
      const site = await buildDesignIntentSite({
        outputRoot: path.resolve(input.output as string),
        view: result.data.view,
        lifecycle: result.data.lifecycle,
      });
      return success(site);
    }

    throw failure(command, `unknown Design command: ${command}`);
  } catch (error) {
    if (error instanceof WabachiDomainError) throw error;
    throw failure(command, errorMessage(error));
  }
}
