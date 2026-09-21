import { canonicalizeJson, digestJson, type Digest } from "../digest.js";
import type {
  CanonRevisionReference,
  CertificationEvidence,
  DesignChangeOperation,
  DesignChangeSection,
  DesignChangeSet,
  DesignIntentCanonView,
  DesignIntentLifecycleRecord,
} from "../contracts.js";
import { validateArchitectureDocument, type ArchitectureDiagnostic } from "../../architecture/canon/validate.js";
import type { DesignIntentPorts } from "../ports.js";
import type { DesignArguments, DesignReadCommand } from "./arguments.js";

export type DesignReadPorts = Pick<DesignIntentPorts, "canon" | "changes" | "changeStore" | "lifecycle">;

export interface DesignReadDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface DesignReadBase {
  readonly ok: boolean;
  readonly command: DesignReadCommand;
  readonly changeId: string;
  readonly exitCode: 0 | 1;
}

export interface DesignShowData {
  readonly change: DesignChangeSet;
  readonly base: CanonRevisionReference;
  readonly current: CanonRevisionReference;
  readonly view: DesignIntentCanonView;
  readonly section?: DesignChangeSection;
  readonly lifecycle?: DesignIntentLifecycleRecord;
}

export interface DesignDiffData {
  readonly change: DesignChangeSet;
  readonly base: CanonRevisionReference;
  readonly current: CanonRevisionReference;
  readonly operations: readonly DesignChangeOperation[];
  readonly section?: DesignChangeSection;
}

export interface DesignStatusData {
  readonly change: DesignChangeSet;
  readonly lifecycle?: DesignIntentLifecycleRecord;
  readonly state: DesignIntentLifecycleRecord["state"] | "uninitialized";
  readonly review?: DesignIntentLifecycleRecord["review"];
  readonly implementations: DesignIntentLifecycleRecord["implementations"];
  readonly certification?: CertificationEvidence;
}

export interface DesignValidationData {
  readonly change: DesignChangeSet;
  readonly base: CanonRevisionReference;
  readonly current: CanonRevisionReference;
  readonly valid: boolean;
  readonly diagnostics: readonly DesignReadDiagnostic[];
}

export interface DesignReadSuccess<
  TData = DesignShowData | DesignDiffData | DesignStatusData | DesignValidationData,
> extends DesignReadBase {
  readonly ok: true;
  readonly exitCode: 0 | 1;
  readonly data: TData;
}

export interface DesignReadFailure extends DesignReadBase {
  readonly ok: false;
  readonly exitCode: 1;
  readonly diagnostics: readonly DesignReadDiagnostic[];
}

export type DesignReadResult = DesignReadSuccess | DesignReadFailure;

function payloadOf(change: DesignChangeSet): Omit<DesignChangeSet, "digest"> {
  const { digest: _digest, ...payload } = change;
  return payload;
}

function failure(
  command: DesignReadCommand,
  changeId: string,
  code: string,
  message: string,
  path?: string,
): DesignReadFailure {
  return {
    ok: false,
    command,
    changeId,
    exitCode: 1,
    diagnostics: [
      {
        code,
        message,
        ...(path === undefined ? {} : { path }),
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSection(entryKey: string): DesignChangeSection | undefined {
  try {
    const encoded = JSON.parse(entryKey) as unknown;
    if (!Array.isArray(encoded) || typeof encoded[0] !== "string") return undefined;
    if (encoded[0] === "code-intent") return "codeIntent";
    if (encoded[0] === "repository-mapping") return "repositoryMappings";
    const section =
      encoded[0] === "element"
        ? "elements"
        : encoded[0] === "interface"
          ? "interfaces"
          : encoded[0] === "relationship"
            ? "relationships"
            : encoded[0] === "responsibility"
              ? "responsibilities"
              : encoded[0] === "boundary"
                ? "boundaries"
                : encoded[0] === "constraint"
                  ? "constraints"
                  : encoded[0] === "flow"
                    ? "flows"
                    : encoded[0] === "deployment"
                      ? "deployment"
                      : encoded[0] === "decision"
                        ? "decisions"
                        : encoded[0] === "view"
                          ? "views"
                          : encoded[0];
    const known: readonly DesignChangeSection[] = [
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
    return known.includes(section as DesignChangeSection) ? (section as DesignChangeSection) : undefined;
  } catch {
    return undefined;
  }
}

function selectOperations(
  operations: readonly DesignChangeOperation[],
  section: DesignChangeSection | undefined,
): readonly DesignChangeOperation[] {
  if (section === undefined) return operations;
  return operations.filter((operation) => readSection(operation.entryKey) === section);
}

function canonDiagnostics(diagnostics: readonly ArchitectureDiagnostic[]): readonly DesignReadDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    path: diagnostic.path,
    message: diagnostic.message,
  }));
}

function success<TData>(command: DesignReadCommand, changeId: string, data: TData): DesignReadSuccess<TData> {
  return { ok: true, command, changeId, exitCode: 0, data };
}

async function readChange(
  ports: DesignReadPorts,
  command: DesignReadCommand,
  changeId: string,
): Promise<DesignChangeSet | DesignReadFailure> {
  let change: DesignChangeSet | undefined;
  try {
    change = await ports.changeStore.read(changeId);
  } catch (error) {
    return failure(command, changeId, "read-failed", errorMessage(error));
  }
  if (change === undefined)
    return failure(command, changeId, "change-not-found", `Design Change not found: ${changeId}`);
  if (change.changeId !== changeId) {
    return failure(command, changeId, "change-id-mismatch", `stored Design Change has id ${change.changeId}`);
  }
  let expectedDigest: Digest;
  try {
    expectedDigest = digestJson(payloadOf(change));
  } catch (error) {
    return failure(command, changeId, "invalid-change", errorMessage(error));
  }
  if (expectedDigest !== change.digest) {
    return failure(command, changeId, "invalid-change-digest", `Design Change ${changeId} has an invalid digest`);
  }
  return change;
}

async function readRevisionContext(
  ports: DesignReadPorts,
  command: DesignReadCommand,
  change: DesignChangeSet,
): Promise<
  | {
      readonly base: CanonRevisionReference;
      readonly current: CanonRevisionReference;
      readonly currentDocument: DesignIntentCanonView["current"];
      readonly baseDocument: DesignIntentCanonView["current"];
    }
  | DesignReadFailure
> {
  try {
    const current = await ports.canon.readCurrent();
    const baseDocument = await ports.canon.readAt(change.base);
    if (digestJson(baseDocument) !== change.base.canonDigest) {
      return failure(
        command,
        change.changeId,
        "stale-base",
        `Canon bytes do not match the bound base digest for ${change.changeId}`,
      );
    }
    if (baseDocument.canonVersion !== change.base.canonVersion) {
      return failure(
        command,
        change.changeId,
        "canon-version-mismatch",
        `Canon version does not match the bound base for ${change.changeId}`,
      );
    }
    return {
      base: change.base,
      current: current.revision,
      currentDocument: current.document,
      baseDocument,
    };
  } catch (error) {
    return failure(command, change.changeId, "canon-read-failed", errorMessage(error));
  }
}

function staleLifecycle(
  command: DesignReadCommand,
  change: DesignChangeSet,
  lifecycle: DesignIntentLifecycleRecord | undefined,
): DesignReadFailure | undefined {
  if (lifecycle !== undefined && (lifecycle.changeId !== change.changeId || lifecycle.changeDigest !== change.digest)) {
    return failure(command, change.changeId, "stale-lifecycle", `lifecycle record is stale for ${change.changeId}`);
  }
  return undefined;
}

async function show(
  ports: DesignReadPorts,
  command: DesignReadCommand,
  change: DesignChangeSet,
  section: DesignChangeSection | undefined,
): Promise<DesignReadResult> {
  const context = await readRevisionContext(ports, command, change);
  if ("ok" in context && !context.ok) return context;
  if (!("baseDocument" in context))
    return failure(command, change.changeId, "canon-read-failed", "Canon context unavailable");

  let proposed;
  try {
    proposed = await ports.changes.apply(change, context.baseDocument);
  } catch (error) {
    return failure(command, change.changeId, "change-apply-failed", errorMessage(error));
  }
  let lifecycle: DesignIntentLifecycleRecord | undefined;
  try {
    lifecycle = await ports.lifecycle.read(change.changeId);
  } catch (error) {
    return failure(command, change.changeId, "lifecycle-read-failed", errorMessage(error));
  }
  const stale = staleLifecycle(command, change, lifecycle);
  if (stale !== undefined) return stale;
  return success(command, change.changeId, {
    change,
    base: context.base,
    current: context.current,
    view: {
      current: context.currentDocument,
      proposed,
    },
    ...(section === undefined ? {} : { section }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  });
}

async function diff(
  ports: DesignReadPorts,
  command: DesignReadCommand,
  change: DesignChangeSet,
  section: DesignChangeSection | undefined,
): Promise<DesignReadResult> {
  const context = await readRevisionContext(ports, command, change);
  if ("ok" in context && !context.ok) return context;
  if (!("baseDocument" in context))
    return failure(command, change.changeId, "canon-read-failed", "Canon context unavailable");
  return success(command, change.changeId, {
    change,
    base: context.base,
    current: context.current,
    operations: selectOperations(change.target.operations, section),
    ...(section === undefined ? {} : { section }),
  });
}

async function status(
  ports: DesignReadPorts,
  command: DesignReadCommand,
  change: DesignChangeSet,
): Promise<DesignReadResult> {
  let lifecycle: DesignIntentLifecycleRecord | undefined;
  try {
    lifecycle = await ports.lifecycle.read(change.changeId);
  } catch (error) {
    return failure(command, change.changeId, "lifecycle-read-failed", errorMessage(error));
  }
  const stale = staleLifecycle(command, change, lifecycle);
  if (stale !== undefined) return stale;
  return success(command, change.changeId, {
    change,
    ...(lifecycle === undefined ? {} : { lifecycle }),
    state: lifecycle?.state ?? "uninitialized",
    ...(lifecycle?.review === undefined ? {} : { review: lifecycle.review }),
    implementations: lifecycle?.implementations ?? [],
    ...(lifecycle?.certification === undefined ? {} : { certification: lifecycle.certification }),
  });
}

async function validate(
  ports: DesignReadPorts,
  command: DesignReadCommand,
  change: DesignChangeSet,
): Promise<DesignReadResult> {
  const context = await readRevisionContext(ports, command, change);
  if ("ok" in context && !context.ok) return context;
  if (!("baseDocument" in context))
    return failure(command, change.changeId, "canon-read-failed", "Canon context unavailable");

  const diagnostics: DesignReadDiagnostic[] = [];
  const baseValidation = validateArchitectureDocument(context.baseDocument);
  diagnostics.push(...canonDiagnostics(baseValidation.diagnostics));

  try {
    const proposed = await ports.changes.apply(change, context.baseDocument);
    const proposedValidation = validateArchitectureDocument(proposed);
    diagnostics.push(...canonDiagnostics(proposedValidation.diagnostics));
    if (digestJson(proposed) !== change.target.targetCanonDigest) {
      diagnostics.push({
        code: "target-digest-mismatch",
        message: `proposed Canon does not match target digest for ${change.changeId}`,
      });
    }
  } catch (error) {
    diagnostics.push({ code: "change-apply-failed", message: errorMessage(error) });
  }

  const valid = diagnostics.length === 0;
  const result = success(command, change.changeId, {
    change,
    base: context.base,
    current: context.current,
    valid,
    diagnostics,
  });
  return valid ? result : { ...result, exitCode: 1 };
}

/** Execute one read command using only the supplied read/domain ports. */
export async function executeDesignRead(
  command:
    | DesignArguments
    | { readonly command: DesignReadCommand; readonly changeId: string; readonly section?: DesignChangeSection },
  ports: DesignReadPorts,
): Promise<DesignReadResult> {
  const commandName = command.command;
  if (commandName === undefined) return failure("validate", "", "invalid-arguments", "Design read command is required");
  const changeId = command.changeId;
  if (changeId === undefined) return failure(commandName, "", "invalid-arguments", "change-id is required");

  const loaded = await readChange(ports, commandName, changeId);
  if ("ok" in loaded && !loaded.ok) return loaded;
  if (!("digest" in loaded)) return failure(commandName, changeId, "change-read-failed", "Design Change unavailable");

  if (commandName === "show") return show(ports, commandName, loaded, command.section);
  if (commandName === "diff") return diff(ports, commandName, loaded, command.section);
  if (commandName === "status") return status(ports, commandName, loaded);
  return validate(ports, commandName, loaded);
}

/** Compatibility name for callers that treat the adapter as a command runner. */
export const runDesignReadCommand = executeDesignRead;

export class DesignReadService {
  constructor(private readonly ports: DesignReadPorts) {}

  execute(
    command:
      | DesignArguments
      | { readonly command: DesignReadCommand; readonly changeId: string; readonly section?: DesignChangeSection },
  ): Promise<DesignReadResult> {
    return executeDesignRead(command, this.ports);
  }
}

export interface DesignReadExecution {
  readonly exitCode: 0 | 1;
  readonly result: DesignReadResult;
  readonly output: string;
}

function jsonValue(result: DesignReadResult): string {
  return canonicalizeJson(result);
}

/** Render the same result data for machine and human consumers. */
export function renderDesignReadResult(result: DesignReadResult, json = false): string {
  if (json) return jsonValue(result);
  if (!result.ok) {
    const diagnostics = result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("; ");
    return `design ${result.command} ${result.changeId}: ${diagnostics}`;
  }

  const lines = [`Design ${result.command}: ${result.changeId}`];
  if (result.command === "show") {
    const data = result.data as DesignShowData;
    lines.push(`change digest: ${data.change.digest}`, `state: ${data.lifecycle?.state ?? "uninitialized"}`);
    lines.push(`operations: ${data.change.target.operations.length}`);
    if (data.section !== undefined) lines.push(`section: ${data.section}`);
  } else if (result.command === "diff") {
    const data = result.data as DesignDiffData;
    lines.push(`change digest: ${data.change.digest}`, `operations: ${data.operations.length}`);
    if (data.section !== undefined) lines.push(`section: ${data.section}`);
  } else if (result.command === "status") {
    const data = result.data as DesignStatusData;
    lines.push(`change digest: ${data.change.digest}`, `state: ${data.state}`);
    lines.push(`implementations: ${data.implementations.length}`);
  } else {
    const data = result.data as DesignValidationData;
    lines.push(`valid: ${data.valid}`, `diagnostics: ${data.diagnostics.length}`);
  }
  return lines.join("\n");
}

export function serializeDesignReadResult(result: DesignReadResult): string {
  return renderDesignReadResult(result, true);
}

export function designReadOutput(result: DesignReadResult, json: boolean): DesignReadExecution {
  return { exitCode: result.exitCode, result, output: renderDesignReadResult(result, json) };
}
