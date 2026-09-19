import { spawn } from "node:child_process";

export interface StructurizrLauncher {
  /** Executable used to start the Structurizr vNext CLI or launcher. */
  readonly executable: string;
  /** Arguments needed by a launcher before Structurizr's own arguments. */
  readonly args?: readonly string[];
}

export interface StructurizrStaticExportRequest {
  readonly launcher: StructurizrLauncher;
  /** Path to the already-generated Structurizr DSL or JSON workspace. */
  readonly workspacePath: string;
  /** Explicit caller-owned directory in which Structurizr writes the static site. */
  readonly outputDirectory: string;
}

export interface StructurizrToolIdentity {
  readonly id: "structurizr";
  readonly executable: string;
  readonly launcherArgs: readonly string[];
  readonly version: string | null;
}

export interface StructurizrProcessInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly shell: false;
}

export interface StructurizrProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export type StructurizrExportFailureCode =
  "invalid-input" | "unavailable" | "spawn-failed" | "non-zero-exit" | "version-output-missing";

export interface StructurizrExportDiagnostic {
  readonly code: StructurizrExportFailureCode;
  readonly phase: "version" | "export" | "input";
  readonly message: string;
}

interface StructurizrExportResultBase {
  readonly tool: StructurizrToolIdentity;
  readonly workspacePath: string;
  readonly outputDirectory: string;
  readonly invocations: {
    readonly version: StructurizrProcessInvocation;
    readonly export: StructurizrProcessInvocation;
  };
  readonly versionOutput: StructurizrProcessOutput;
  readonly output: StructurizrProcessOutput;
}

export interface StructurizrExportSuccess extends StructurizrExportResultBase {
  readonly status: "ok";
  readonly exitCode: 0;
  readonly signal: null;
  readonly diagnostic: null;
}

export interface StructurizrExportFailure extends StructurizrExportResultBase {
  readonly status: "invalid-input" | "unavailable" | "spawn-failed" | "failed";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly diagnostic: StructurizrExportDiagnostic;
}

export type StructurizrStaticExportResult = StructurizrExportSuccess | StructurizrExportFailure;

interface ProcessExit {
  readonly kind: "exit";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: StructurizrProcessOutput;
}

interface ProcessSpawnFailure {
  readonly kind: "spawn-failed";
  readonly error: Error;
  readonly output: StructurizrProcessOutput;
}

type ProcessResult = ProcessExit | ProcessSpawnFailure;

const EMPTY_OUTPUT: StructurizrProcessOutput = Object.freeze({ stdout: "", stderr: "" });

function processError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isMissingExecutable(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function runArgv(executable: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ kind: "spawn-failed", error: processError(error), output: EMPTY_OUTPUT });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error: Error) => {
      if (settled) return;
      settled = true;
      resolve({ kind: "spawn-failed", error, output: { stdout, stderr } });
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({ kind: "exit", exitCode, signal, output: { stdout, stderr } });
    });
  });
}

function invocation(executable: string, args: readonly string[]): StructurizrProcessInvocation {
  return Object.freeze({ executable, args: Object.freeze([...args]), shell: false as const });
}

function baseResult(
  request: StructurizrStaticExportRequest,
  launcherArgs: readonly string[],
  versionInvocation: StructurizrProcessInvocation,
  exportInvocation: StructurizrProcessInvocation,
  version: string | null,
  versionOutput: StructurizrProcessOutput,
  output: StructurizrProcessOutput,
): StructurizrExportResultBase {
  return {
    tool: {
      id: "structurizr",
      executable: request.launcher.executable,
      launcherArgs: Object.freeze([...launcherArgs]),
      version,
    },
    workspacePath: request.workspacePath,
    outputDirectory: request.outputDirectory,
    invocations: { version: versionInvocation, export: exportInvocation },
    versionOutput,
    output,
  };
}

function invalidInputResult(
  request: StructurizrStaticExportRequest,
  launcherArgs: readonly string[],
  versionInvocation: StructurizrProcessInvocation,
  exportInvocation: StructurizrProcessInvocation,
  message: string,
): StructurizrExportFailure {
  return {
    ...baseResult(request, launcherArgs, versionInvocation, exportInvocation, null, EMPTY_OUTPUT, EMPTY_OUTPUT),
    status: "invalid-input",
    exitCode: null,
    signal: null,
    diagnostic: { code: "invalid-input", phase: "input", message },
  };
}

function failureResult(
  base: StructurizrExportResultBase,
  status: StructurizrExportFailure["status"],
  phase: StructurizrExportDiagnostic["phase"],
  code: StructurizrExportFailureCode,
  message: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): StructurizrExportFailure {
  return { ...base, status, exitCode, signal, diagnostic: { code, phase, message } };
}

function versionFromOutput(output: string): string | null {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const releaseLine = lines.find((line) => /\bstructurizr:\s+\S+/iu.test(line));
  return releaseLine?.replace(/^.*?\b(structurizr:\s+\S+).*$/iu, "$1") ?? lines[0] ?? null;
}

/**
 * Run the current Structurizr static export surface against an existing
 * generated workspace. The adapter never creates or rewrites that workspace.
 */
export async function runStructurizrStaticExport(
  request: StructurizrStaticExportRequest,
): Promise<StructurizrStaticExportResult> {
  const launcherArgs = request.launcher.args === undefined ? [] : [...request.launcher.args];
  const versionArgs = [...launcherArgs, "version"];
  const exportArgs = [
    ...launcherArgs,
    "export",
    "-format",
    "static",
    "-workspace",
    request.workspacePath,
    "-output",
    request.outputDirectory,
  ];
  const versionInvocation = invocation(request.launcher.executable, versionArgs);
  const exportInvocation = invocation(request.launcher.executable, exportArgs);

  if (
    request.launcher.executable.length === 0 ||
    launcherArgs.some((argument) => typeof argument !== "string") ||
    request.workspacePath.length === 0 ||
    request.outputDirectory.length === 0
  ) {
    return invalidInputResult(
      request,
      launcherArgs,
      versionInvocation,
      exportInvocation,
      "Structurizr executable, launcher arguments, workspace path, and output directory must be non-empty strings",
    );
  }

  const versionResult = await runArgv(request.launcher.executable, versionArgs);
  if (versionResult.kind === "spawn-failed") {
    const base = baseResult(
      request,
      launcherArgs,
      versionInvocation,
      exportInvocation,
      null,
      versionResult.output,
      EMPTY_OUTPUT,
    );
    const missing = isMissingExecutable(versionResult.error);
    return failureResult(
      base,
      missing ? "unavailable" : "spawn-failed",
      "version",
      missing ? "unavailable" : "spawn-failed",
      `Structurizr version process could not be started: ${versionResult.error.message}`,
      null,
      null,
    );
  }

  const version = versionFromOutput(versionResult.output.stdout);
  const versionBase = baseResult(
    request,
    launcherArgs,
    versionInvocation,
    exportInvocation,
    version,
    versionResult.output,
    EMPTY_OUTPUT,
  );
  if (versionResult.exitCode !== 0) {
    return failureResult(
      versionBase,
      "failed",
      "version",
      "non-zero-exit",
      `Structurizr version process exited with code ${String(versionResult.exitCode)}`,
      versionResult.exitCode,
      versionResult.signal,
    );
  }
  if (version === null) {
    return failureResult(
      versionBase,
      "failed",
      "version",
      "version-output-missing",
      "Structurizr version process exited successfully without version output",
      versionResult.exitCode,
      versionResult.signal,
    );
  }

  const exportResult = await runArgv(request.launcher.executable, exportArgs);
  if (exportResult.kind === "spawn-failed") {
    const base = baseResult(
      request,
      launcherArgs,
      versionInvocation,
      exportInvocation,
      version,
      versionResult.output,
      exportResult.output,
    );
    const missing = isMissingExecutable(exportResult.error);
    return failureResult(
      base,
      missing ? "unavailable" : "spawn-failed",
      "export",
      missing ? "unavailable" : "spawn-failed",
      `Structurizr export process could not be started: ${exportResult.error.message}`,
      null,
      null,
    );
  }

  const base = baseResult(
    request,
    launcherArgs,
    versionInvocation,
    exportInvocation,
    version,
    versionResult.output,
    exportResult.output,
  );
  if (exportResult.exitCode !== 0) {
    return failureResult(
      base,
      "failed",
      "export",
      "non-zero-exit",
      `Structurizr export process exited with code ${String(exportResult.exitCode)}`,
      exportResult.exitCode,
      exportResult.signal,
    );
  }

  return { ...base, status: "ok", exitCode: 0, signal: null, diagnostic: null };
}

export const executeStructurizrStaticExport = runStructurizrStaticExport;
