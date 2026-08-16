import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
/**
 * Minimal deterministic provider used to exercise the provider contract in
 * tests and as a template for future concrete providers. It writes one raw
 * artifact listing the workspace's top-level entries.
 */
export function createFixtureProvider(options = {}) {
    const id = options.id ?? "fixture";
    const available = options.available ?? true;
    return {
        identity: { id, version: "0.0.1", determinism: "deterministic" },
        async isAvailable() {
            return available;
        },
        async execute(context) {
            const startedAt = new Date().toISOString();
            const entries = await readdir(context.workspaceRoot);
            const artifactRelativePath = "entries.json";
            await writeFile(path.join(context.artifactRoot, artifactRelativePath), `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
            return {
                status: "ok",
                artifacts: [artifactRelativePath],
                startedAt,
                finishedAt: new Date().toISOString(),
            };
        },
    };
}
//# sourceMappingURL=fixtureProvider.js.map