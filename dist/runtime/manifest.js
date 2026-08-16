import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export async function writeManifest(runRoot, manifest) {
    await mkdir(runRoot, { recursive: true });
    const manifestPath = path.join(runRoot, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifestPath;
}
//# sourceMappingURL=manifest.js.map