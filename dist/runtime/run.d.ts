import type { RunManifest } from "./manifest.js";
import type { Provider } from "./provider.js";
export interface RunOptions {
    readonly source: string;
    readonly revision?: string;
    /** Root directory for this run's isolated workspace, artifacts, and manifest. */
    readonly runRoot: string;
    readonly providers: readonly Provider[];
}
export interface RunResult {
    readonly manifest: RunManifest;
    readonly manifestPath: string;
}
/**
 * Resolves the input repository to an immutable commit, materializes it
 * into an isolated workspace, executes each provider through the common
 * contract, and persists a run manifest. A provider that is unavailable or
 * fails is recorded independently and does not stop the other providers or
 * corrupt their evidence.
 */
export declare function run(options: RunOptions): Promise<RunResult>;
