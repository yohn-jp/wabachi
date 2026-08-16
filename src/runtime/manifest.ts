import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ProviderExecutionResult, ProviderIdentity, ResolvedRepository } from "./provider.js";

const execFileAsync = promisify(execFile);

export interface ManifestProviderEntry {
  readonly identity: ProviderIdentity;
  readonly result: ProviderExecutionResult;
}

export interface RunManifest {
  readonly runId: string;
  readonly repository: ResolvedRepository;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Runtime and command-line tool versions used by the experiment. */
  readonly toolchain: Readonly<Record<string, string>>;
  readonly providers: readonly ManifestProviderEntry[];
}

/** Collects versions that are outside an individual provider identity. */
export async function collectToolchainVersions(): Promise<Readonly<Record<string, string>>> {
  const versions: Record<string, string> = {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
  for (const [name, command, args] of [
    ["git", "git", ["--version"]],
    ["pnpm", "pnpm", ["--version"]],
    ["tar", "tar", ["--version"]],
    ["graft", "graft", ["--version"]],
  ] as const) {
    versions[name] = await commandVersion(command, args);
  }
  versions.tsx = await commandVersion("pnpm", ["exec", "tsx", "--version"], process.cwd());
  return versions;
}

async function commandVersion(command: string, args: readonly string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      encoding: "utf8",
      ...(cwd === undefined ? {} : { cwd }),
    });
    return stdout.trim().split("\n")[0] ?? "unknown";
  } catch {
    return "unavailable";
  }
}

export async function writeManifest(runRoot: string, manifest: RunManifest): Promise<string> {
  await mkdir(runRoot, { recursive: true });
  const manifestPath = path.join(runRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}
