import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderExecutionResult, ProviderIdentity, ResolvedRepository } from "./provider.js";

export interface ManifestProviderEntry {
  readonly identity: ProviderIdentity;
  readonly result: ProviderExecutionResult;
}

export interface RunManifest {
  readonly runId: string;
  readonly repository: ResolvedRepository;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly providers: readonly ManifestProviderEntry[];
}

export async function writeManifest(runRoot: string, manifest: RunManifest): Promise<string> {
  await mkdir(runRoot, { recursive: true });
  const manifestPath = path.join(runRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}
