import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureProvider } from "./runtime/fixtureProvider.js";
import { createGraftProvider } from "./runtime/graftProvider.js";
import { run } from "./runtime/run.js";
import { createScipTypescriptProvider } from "./runtime/scipProvider.js";
import { createTypeScriptProvider } from "./runtime/typescriptProvider.js";
import { runProviderMatrix } from "./runtime/workflow.js";
export async function runCli(argv) {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h") {
        printHelp();
        return command === undefined ? 1 : 0;
    }
    if (command === "--version") {
        console.log(getVersion());
        return 0;
    }
    if (command === "run") {
        return runRunCommand(argv.slice(1));
    }
    if (command === "matrix") {
        return runMatrixCommand(argv.slice(1));
    }
    console.error(`unknown command: ${command}`);
    printHelp();
    return 1;
}
async function runMatrixCommand(args) {
    const configIndex = args.indexOf("--config");
    const outIndex = args.indexOf("--out");
    let source = args[0];
    let revision = optionValue(args, "--revision");
    let configuredProviderIds;
    let configuredAdditionOrder;
    try {
        if (configIndex !== -1) {
            const configPath = args[configIndex + 1];
            if (configPath === undefined)
                throw new Error("--config requires a JSON file");
            const config = JSON.parse(await readFile(configPath, "utf8"));
            if (typeof config.source !== "string" || typeof config.revision !== "string") {
                throw new Error("workflow config must contain string source and revision");
            }
            if (!isStringArray(config.providers) || !isStringArray(config.additionOrder)) {
                throw new Error("workflow config must contain provider and additionOrder string arrays");
            }
            source = config.source;
            revision = config.revision;
            configuredProviderIds = config.providers;
            configuredAdditionOrder = config.additionOrder;
        }
        if (source === undefined)
            throw new Error("usage: PACKAGE_NAME matrix <repository> --revision <sha> --out <dir>");
        if (revision === undefined)
            throw new Error("matrix requires --revision <40-character commit SHA>");
        const runRoot = outIndex === -1 ? undefined : args[outIndex + 1];
        if (runRoot === undefined)
            throw new Error("matrix requires --out <dir> so artifacts are retained");
        const providers = [createTypeScriptProvider(), createGraftProvider(), createScipTypescriptProvider()];
        const providerIds = providers.map((provider) => provider.identity.id);
        if (configuredProviderIds !== undefined && !sameStrings(configuredProviderIds, providerIds)) {
            throw new Error(`workflow config provider set does not match registered providers: ${providerIds.join(", ")}`);
        }
        const configuredOrder = configuredAdditionOrder === undefined
            ? undefined
            : configuredAdditionOrder.map((id) => {
                const provider = providers.find((candidate) => candidate.identity.id === id);
                if (provider === undefined)
                    throw new Error(`workflow config names an unknown provider: ${id}`);
                return provider.identity;
            });
        const result = await runProviderMatrix({ source, revision, runRoot, providers, additionOrder: configuredOrder });
        console.log(result.matrixPaths.reportPath);
        return 0;
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}
function optionValue(args, option) {
    const index = args.indexOf(option);
    return index === -1 ? undefined : args[index + 1];
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
async function runRunCommand(args) {
    const source = args[0];
    if (source === undefined) {
        console.error("usage: PACKAGE_NAME run <repository> [--revision <ref>] [--out <dir>]");
        return 1;
    }
    const revisionIndex = args.indexOf("--revision");
    const revision = revisionIndex === -1 ? undefined : args[revisionIndex + 1];
    const outIndex = args.indexOf("--out");
    const runRoot = outIndex === -1 ? await mkdtemp(path.join(os.tmpdir(), "wabachi-run-")) : args[outIndex + 1];
    try {
        const { manifestPath } = await run({
            source,
            revision,
            runRoot,
            providers: [
                createFixtureProvider(),
                createTypeScriptProvider(),
                createGraftProvider(),
                createScipTypescriptProvider(),
            ],
        });
        console.log(manifestPath);
        return 0;
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}
function printHelp() {
    console.log([
        "Usage: PACKAGE_NAME <command> [options]",
        "",
        "Commands:",
        "  run <repository>   Resolve a repository/revision and execute registered providers",
        "  matrix <repository>  Run providers and generate auditable facts, correlation, matrix, and report",
        "  --help              Show this help",
        "  --version           Print the installed version",
    ].join("\n"));
}
function getVersion() {
    // TODO: replace with real package metadata (see docs on version wiring).
    return "0.0.1";
}
//# sourceMappingURL=cli.js.map