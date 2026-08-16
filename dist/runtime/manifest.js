import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/** Collects versions that are outside an individual provider identity. */
export async function collectToolchainVersions() {
    const versions = {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
    };
    for (const [name, command, args] of [
        ["git", "git", ["--version"]],
        ["pnpm", "pnpm", ["--version"]],
        ["tar", "tar", ["--version"]],
        ["graft", "graft", ["--version"]],
    ]) {
        versions[name] = await commandVersion(command, args);
    }
    versions.tsx = await commandVersion("pnpm", ["exec", "tsx", "--version"], process.cwd());
    return versions;
}
async function commandVersion(command, args, cwd) {
    try {
        const options = { encoding: "utf8", ...(cwd === undefined ? {} : { cwd }) };
        const { stdout } = await execFileAsync(command, [...args], options);
        return stdout.trim().split("\n")[0] ?? "unknown";
    }
    catch {
        return "unavailable";
    }
}
export async function writeManifest(runRoot, manifest) {
    await mkdir(runRoot, { recursive: true });
    const manifestPath = path.join(runRoot, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifestPath;
}
//# sourceMappingURL=manifest.js.map