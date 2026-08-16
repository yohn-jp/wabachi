import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/**
 * Deterministic structural relations `graft build` (without `--deep`) can
 * emit that map onto a common observation predicate. Any edge relation not
 * listed here has no safe common predicate and is only preserved as raw,
 * provider-native evidence in wiring.json rather than forced into the
 * common envelope.
 */
const RELATION_TO_PREDICATE = {
    calls: "calls",
    imports: "imports",
    extends: "extends",
    implements: "implements",
    references: "references",
};
const GRAFT_BINARY = "graft";
export function createGraftProvider(options = {}) {
    const binary = options.binary ?? GRAFT_BINARY;
    let resolvedVersion = "unknown";
    return {
        get identity() {
            return { id: "graft", version: resolvedVersion, determinism: "deterministic" };
        },
        async isAvailable(_context) {
            try {
                resolvedVersion = await resolveVersion(binary);
                return true;
            }
            catch {
                return false;
            }
        },
        async execute(context) {
            const startedAt = new Date().toISOString();
            const graftDir = path.join(context.artifactRoot, "graft");
            const buildArgs = ["build", context.workspaceRoot, "--dir", graftDir];
            if (options.extensions && options.extensions.length > 0) {
                buildArgs.push("--extensions", ...options.extensions);
            }
            resolvedVersion = await resolveVersion(binary);
            const version = resolvedVersion;
            const invocation = { binary, args: buildArgs, version, deep: false };
            const invocationRelativePath = "invocation.json";
            await writeFile(path.join(context.artifactRoot, invocationRelativePath), `${JSON.stringify(invocation, null, 2)}\n`, "utf8");
            await mkdir(graftDir, { recursive: true });
            await execFileAsync(binary, buildArgs);
            const wiringRelativePath = "graft/.graph/wiring.json";
            const wiring = JSON.parse(await readFile(path.join(context.artifactRoot, wiringRelativePath), "utf8"));
            const identity = { id: "graft", version, determinism: "deterministic" };
            const observations = adaptWiringGraph(wiring, identity, context);
            const observationsRelativePath = "observations.json";
            await writeFile(path.join(context.artifactRoot, observationsRelativePath), `${JSON.stringify(observations, null, 2)}\n`, "utf8");
            return {
                status: "ok",
                artifacts: [invocationRelativePath, wiringRelativePath, observationsRelativePath],
                startedAt,
                finishedAt: new Date().toISOString(),
            };
        },
    };
}
async function resolveVersion(binary) {
    const { stdout } = await execFileAsync(binary, ["--version"]);
    return stdout.trim();
}
/**
 * Adapts Graft's wiring graph into the common observation envelope where a
 * safe predicate mapping exists. Nodes/edges without a safe mapping (e.g.
 * the file-contains-symbol structural edge, or any future Graft-specific
 * relation) are not force-normalized — they remain available only in the
 * raw wiring.json artifact retained alongside these observations.
 */
function adaptWiringGraph(wiring, provider, context) {
    const nodesById = new Map(wiring.nodes.map((node) => [node.id, node]));
    const observations = [];
    for (const edge of wiring.edges) {
        const predicate = RELATION_TO_PREDICATE[edge.relation];
        if (!predicate)
            continue;
        const sourceNode = nodesById.get(edge.source);
        const targetNode = nodesById.get(edge.target);
        if (!sourceNode || !targetNode)
            continue;
        observations.push(toObservation(edge, sourceNode, targetNode, predicate, provider, context));
    }
    return observations;
}
function toObservation(edge, sourceNode, targetNode, predicate, provider, context) {
    return {
        subject: { id: sourceNode.id, kind: sourceNode.kind },
        predicate,
        object: { id: targetNode.id, kind: targetNode.kind },
        provider,
        repository: context.repository,
        source: { path: sourceNode.path, span: sourceNode.span ?? undefined },
        determinism: "deterministic",
        providerNative: { node: sourceNode, edge },
    };
}
//# sourceMappingURL=graftProvider.js.map