import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeManifest } from "./manifest.js";
import { createIsolatedWorkspace, resolveRepository } from "./repository.js";
/**
 * Resolves the input repository to an immutable commit, materializes it
 * into an isolated workspace, executes each provider through the common
 * contract, and persists a run manifest. A provider that is unavailable or
 * fails is recorded independently and does not stop the other providers or
 * corrupt their evidence.
 */
export async function run(options) {
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const bareRepoDir = path.join(options.runRoot, "source");
    const workspaceRoot = path.join(options.runRoot, "workspace");
    const artifactsRoot = path.join(options.runRoot, "raw");
    const resolution = await resolveRepository(options.source, options.revision, bareRepoDir);
    await createIsolatedWorkspace(resolution, workspaceRoot);
    const providerEntries = [];
    for (const provider of options.providers) {
        const artifactRoot = path.join(artifactsRoot, provider.identity.id);
        await mkdir(artifactRoot, { recursive: true });
        const context = {
            workspaceRoot,
            artifactRoot,
            repository: resolution.resolved,
        };
        const result = await executeProvider(provider, context);
        providerEntries.push({ identity: provider.identity, result });
    }
    const finishedAt = new Date().toISOString();
    const manifest = {
        runId,
        repository: resolution.resolved,
        startedAt,
        finishedAt,
        providers: providerEntries,
    };
    const manifestPath = await writeManifest(options.runRoot, manifest);
    return { manifest, manifestPath };
}
async function executeProvider(provider, context) {
    const startedAt = new Date().toISOString();
    let available;
    try {
        available = await provider.isAvailable(context);
    }
    catch (error) {
        return {
            status: "unavailable",
            artifacts: [],
            startedAt,
            finishedAt: new Date().toISOString(),
            error: toErrorMessage(error),
        };
    }
    if (!available) {
        return { status: "unavailable", artifacts: [], startedAt, finishedAt: new Date().toISOString() };
    }
    try {
        return await provider.execute(context);
    }
    catch (error) {
        return {
            status: "failed",
            artifacts: [],
            startedAt,
            finishedAt: new Date().toISOString(),
            error: toErrorMessage(error),
        };
    }
}
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=run.js.map