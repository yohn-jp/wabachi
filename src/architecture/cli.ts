import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalArchitectureDocument } from "./canon/codec.js";
import type { ArchitectureDocumentV1 } from "./canon/document.js";
import { projectArchitectureDocument } from "./documentation/project.js";
import { ArchitectureSiteError, buildArchitectureSite } from "./documentation/site.js";
import { projectArchitectureDocumentToReactFlow } from "./projection/react-flow.js";
import { assertNoPendingTransactions } from "../design/storage/transaction.js";
import { resolveRepositoryRoot } from "../design/storage/paths.js";
import {
  commandOutput,
  jsonMachine,
  textMachine,
  wabachiDomainError,
  type WabachiCommandResult,
  type WabachiDomainError,
} from "../cli/result.js";

const MAX_DIAGNOSTIC_LENGTH = 240;
const DEFAULT_ARCHITECTURE_CANON_PATH = ".wabachi/architecture.json";

interface ArchitectureCanonCounts {
  readonly elements: number;
  readonly interfaces: number;
  readonly relationships: number;
  readonly flows: number;
  readonly views: number;
}

function bounded(value: string): string {
  const message = value.replace(/\s+/gu, " ").trim();
  if (message.length <= MAX_DIAGNOSTIC_LENGTH) return message;
  return `${message.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return bounded(error instanceof Error ? error.message : String(error));
}

function architectureCanonCounts(document: ArchitectureDocumentV1): ArchitectureCanonCounts {
  return {
    elements: document.elements.length,
    interfaces: document.interfaces.length,
    relationships: document.relationships.length,
    flows: document.flows.length,
    views: document.views.length,
  };
}

function architectureCanonSummary(counts: ArchitectureCanonCounts): string {
  return `Architecture Canon summary: elements=${counts.elements}, interfaces=${counts.interfaces}, relationships=${counts.relationships}, flows=${counts.flows}, views=${counts.views}`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function guardManagedCanonRead(file: string): Promise<void> {
  let repositoryRoot: string;
  try {
    repositoryRoot = await resolveRepositoryRoot();
  } catch {
    return;
  }
  const managedPath = path.resolve(repositoryRoot, DEFAULT_ARCHITECTURE_CANON_PATH);
  if (file === DEFAULT_ARCHITECTURE_CANON_PATH || path.resolve(file) === managedPath) {
    await assertNoPendingTransactions(repositoryRoot);
  }
}

function architectureFailure(
  command: "example" | "validate" | "render",
  code: string,
  message: string,
): WabachiDomainError {
  const diagnostic = { code, message: bounded(message) };
  return wabachiDomainError(
    `architecture ${command}: ${diagnostic.message}\n`,
    jsonMachine({ ok: false, command: `architecture ${command}`, diagnostics: [diagnostic] }),
  );
}

export async function executeArchitectureExample(): Promise<WabachiCommandResult> {
  try {
    const source = await readFile(new URL("../../docs/examples/minimal-canon.json", import.meta.url), "utf8");
    parseCanonicalArchitectureDocument(source);
    const output = `${source.trim()}\n`;
    return commandOutput(output, textMachine(output));
  } catch (error) {
    throw architectureFailure("example", "example-unavailable", errorMessage(error));
  }
}

export async function executeArchitectureValidate(file?: string): Promise<WabachiCommandResult> {
  const input = file ?? DEFAULT_ARCHITECTURE_CANON_PATH;
  let document: ArchitectureDocumentV1;
  try {
    await guardManagedCanonRead(input);
    document = parseCanonicalArchitectureDocument(await readFile(input, "utf8"));
  } catch (error) {
    const message = isMissingFileError(error) ? `architecture document not found: ${input}` : errorMessage(error);
    throw architectureFailure("validate", "invalid-canon", message);
  }

  const counts = architectureCanonCounts(document);
  const text = `valid Architecture Canon: ${input}\n${architectureCanonSummary(counts)}\n`;
  return commandOutput(text, jsonMachine({ ok: true, command: "architecture validate", file: input, ...counts }));
}

export async function executeArchitectureRender(
  file: string | undefined,
  outputRoot: string,
): Promise<WabachiCommandResult> {
  const input = file ?? DEFAULT_ARCHITECTURE_CANON_PATH;
  let document: ArchitectureDocumentV1;
  try {
    await guardManagedCanonRead(input);
    document = parseCanonicalArchitectureDocument(await readFile(input, "utf8"));
  } catch (error) {
    const message = isMissingFileError(error) ? `architecture document not found: ${input}` : errorMessage(error);
    throw architectureFailure("render", "invalid-canon", message);
  }

  try {
    const documentation = projectArchitectureDocument(document);
    const reactFlow = await projectArchitectureDocumentToReactFlow(document);
    const result = await buildArchitectureSite({
      outputRoot: path.resolve(outputRoot),
      documentation,
      reactFlow,
    });
    return commandOutput(
      `rendered architecture site: ${result.outputRoot}\n`,
      jsonMachine({
        ok: true,
        command: "architecture render",
        file: input,
        outputRoot: result.outputRoot,
        projectionLosses: result.losses.length,
      }),
    );
  } catch (error) {
    const code = error instanceof ArchitectureSiteError ? error.code : "render-failed";
    throw architectureFailure("render", code, errorMessage(error));
  }
}
