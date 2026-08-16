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
export declare function writeManifest(runRoot: string, manifest: RunManifest): Promise<string>;
