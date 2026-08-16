import type { ResolvedRepository } from "./provider.js";
export interface RepositoryResolution {
    readonly resolved: ResolvedRepository;
    /** Local directory `git archive` can read the resolved commit from. */
    readonly archiveDir: string;
}
/**
 * Resolves a local repository path or a Git URL, plus an optional revision,
 * to an immutable commit SHA. For a local path this only reads the
 * repository (no mutation of its working tree, index, or HEAD). For a
 * remote URL it fetches the requested revision into a bare repository
 * under `bareRepoDir`.
 */
export declare function resolveRepository(source: string, revision: string | undefined, bareRepoDir: string): Promise<RepositoryResolution>;
/**
 * Materializes the resolved commit into an isolated analysis workspace via
 * `git archive | tar -x`, so the source repository's working tree, index,
 * and HEAD are never touched.
 */
export declare function createIsolatedWorkspace(resolution: RepositoryResolution, workspaceRoot: string): Promise<void>;
