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
    /** Runtime and command-line tool versions used by the experiment. */
    readonly toolchain: Readonly<Record<string, string>>;
    readonly providers: readonly ManifestProviderEntry[];
}
/** Collects versions that are outside an individual provider identity. */
export declare function collectToolchainVersions(): Promise<Readonly<Record<string, string>>>;
export declare function writeManifest(runRoot: string, manifest: RunManifest): Promise<string>;
