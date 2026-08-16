export type DeterminismClass = "deterministic" | "non-deterministic";
export interface ProviderIdentity {
    readonly id: string;
    readonly version: string;
    readonly determinism: DeterminismClass;
}
export interface ProviderContext {
    /** Absolute path to the isolated analysis workspace (never the source repository). */
    readonly workspaceRoot: string;
    /** Absolute path to a run-scoped directory this provider may write raw artifacts under. */
    readonly artifactRoot: string;
    readonly repository: ResolvedRepository;
}
export interface ProviderExecutionResult {
    readonly status: "ok" | "failed" | "unavailable";
    /** Paths (relative to artifactRoot) to raw artifacts this provider produced, if any. */
    readonly artifacts: readonly string[];
    /** Observation-envelope artifacts consumed by the common normalization workflow. */
    readonly observationArtifacts?: readonly string[];
    /** Lossless retained paths after the workflow compresses raw artifacts for audit storage. */
    readonly retainedArtifacts?: readonly string[];
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly error?: string;
}
export interface Provider {
    readonly identity: ProviderIdentity;
    isAvailable(context: ProviderContext): Promise<boolean>;
    execute(context: ProviderContext): Promise<ProviderExecutionResult>;
}
export interface ResolvedRepository {
    readonly source: string;
    readonly commitSha: string;
}
