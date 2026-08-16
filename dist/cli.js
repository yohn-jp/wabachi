import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureProvider } from "./runtime/fixtureProvider.js";
import { run } from "./runtime/run.js";
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
    console.error(`unknown command: ${command}`);
    printHelp();
    return 1;
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
            providers: [createFixtureProvider()],
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
        "  --help              Show this help",
        "  --version           Print the installed version",
    ].join("\n"));
}
function getVersion() {
    // TODO: replace with real package metadata (see docs on version wiring).
    return "0.0.1";
}
//# sourceMappingURL=cli.js.map