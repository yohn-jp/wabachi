#!/usr/bin/env node
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const STRUCTURIZR_VERSION = "2026.06.28";
export const STRUCTURIZR_IMAGE = "structurizr/structurizr";
export const STRUCTURIZR_IMAGE_DIGEST = "sha256:b5140a2a783b0cc780fe4b54dcfeecb565ddd5fce5a578e7ff600b78ad0cc03a";
export const STRUCTURIZR_IMAGE_IDENTITY = `${STRUCTURIZR_IMAGE}@${STRUCTURIZR_IMAGE_DIGEST}`;
export const STRUCTURIZR_CONTAINER_ROOT = "/usr/local/structurizr";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runProcess(executable, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, [...args], {
        cwd: options.cwd ?? repoRoot,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ exitCode: null, signal: null, stdout: "", stderr: "", error });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, signal: null, stdout, stderr, error });
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, signal, stdout, stderr, error: null });
    });
  });
}

function commandFailure(label, result) {
  const details = [result.error?.message, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  return new Error(`${label} failed with exit code ${String(result.exitCode)}${details ? `\n${details}` : ""}`);
}

async function requireSuccess(label, result) {
  if (result.exitCode !== 0 || result.error !== null) throw commandFailure(label, result);
  return result;
}

function relativeContainerPath(root, value) {
  if (!path.isAbsolute(value)) return value;
  const relative = path.relative(root, value);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative === "..") {
    return value;
  }
  return path.posix.join(STRUCTURIZR_CONTAINER_ROOT, relative.split(path.sep).join("/"));
}

export function dockerShimInvocation(root, args) {
  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  return Object.freeze({
    executable: "docker",
    shell: false,
    args: Object.freeze([
      "run",
      "--rm",
      "--user",
      user,
      "--mount",
      `type=bind,src=${root},dst=${STRUCTURIZR_CONTAINER_ROOT}`,
      STRUCTURIZR_IMAGE_IDENTITY,
      ...args.map((argument) => relativeContainerPath(root, argument)),
    ]),
  });
}

async function writeStructurizrShim(directory, mountRoot) {
  const shimPath = path.join(directory, "structurizr-vnext");
  const source = `#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";

const root = ${JSON.stringify(mountRoot)};
const containerRoot = ${JSON.stringify(STRUCTURIZR_CONTAINER_ROOT)};
const image = ${JSON.stringify(STRUCTURIZR_IMAGE_IDENTITY)};
const args = process.argv.slice(2);
const user = process.getuid?.() === undefined ? "0:0" : process.getuid() + ":" + process.getgid();

function mapPath(value) {
  if (!path.isAbsolute(value)) return value;
  const relative = path.relative(root, value);
  if (relative === "" || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return value;
  return containerRoot + "/" + relative.split(path.sep).join("/");
}

const dockerArgs = [
  "run",
  "--rm",
  "--user",
  user,
  "--mount",
  "type=bind,src=" + root + ",dst=" + containerRoot,
  image,
  ...args.map(mapPath),
];
const child = spawn("docker", dockerArgs, { shell: false, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 127;
});
child.once("close", (exitCode, signal) => {
  if (signal !== null) process.exitCode = 128;
  else process.exitCode = exitCode ?? 1;
});
`;
  await writeFile(shimPath, source, { encoding: "utf8", mode: 0o755 });
  await chmod(shimPath, 0o755);
  return shimPath;
}

export async function assertArchitectureArtifacts(outputRoot) {
  const documentation = await readFile(path.join(outputRoot, "index.html"), "utf8");
  if (!documentation.includes("Wabachi architecture site") || !documentation.includes("Documentation")) {
    throw new Error("generated site is missing Wabachi documentation");
  }
  if (!documentation.includes("diagrams/index.html") || !documentation.includes("projection-losses.json")) {
    throw new Error("generated site is missing its artifact navigation");
  }

  const report = JSON.parse(await readFile(path.join(outputRoot, "projection-losses.json"), "utf8"));
  if (!Array.isArray(report.losses) || report.losses.length === 0) {
    throw new Error("generated site is missing a visible non-empty projection-loss report");
  }

  const diagramsHtml = await readFile(path.join(outputRoot, "diagrams", "index.html"), "utf8");
  if (!diagramsHtml.includes("react-flow-view")) {
    throw new Error("generated site is missing real React Flow static diagram output");
  }
  const diagramsCss = await readFile(path.join(outputRoot, "diagrams", "wabachi-react-flow.css"), "utf8");
  if (!diagramsCss.includes("wabachi-react-flow")) {
    throw new Error("generated site is missing its React Flow stylesheet");
  }

  const diagrams = await readdir(path.join(outputRoot, "diagrams"));
  return Object.freeze({ documentation: true, projectionLosses: report.losses.length, diagrams });
}

async function provisionPinnedImage() {
  await requireSuccess(
    "pinned Structurizr image pull",
    await runProcess("docker", ["pull", STRUCTURIZR_IMAGE_IDENTITY]),
  );
  const inspection = await requireSuccess(
    "pinned Structurizr image inspection",
    await runProcess("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", STRUCTURIZR_IMAGE_IDENTITY]),
  );
  if (!inspection.stdout.includes(STRUCTURIZR_IMAGE_IDENTITY)) {
    throw new Error(`Docker did not report the pinned Structurizr digest: ${inspection.stdout.trim()}`);
  }
  console.log(`pinned official Structurizr v${STRUCTURIZR_VERSION}: ${STRUCTURIZR_IMAGE_IDENTITY}`);
}

async function runProductionCli(args) {
  return runProcess(process.execPath, ["--import", "tsx", "src/index.ts", ...args], { cwd: repoRoot });
}

async function main() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-architecture-certification-"));
  try {
    await provisionPinnedImage();
    const shim = await writeStructurizrShim(temporaryRoot, temporaryRoot);
    const version = await requireSuccess("real Structurizr version probe", await runProcess(shim, ["version"]));
    if (!version.stdout.includes(`structurizr: ${STRUCTURIZR_VERSION}`)) {
      throw new Error(`real Structurizr reported an unexpected version:\n${version.stdout}`);
    }
    console.log(`real Structurizr version evidence: ${version.stdout.trim().replace(/\s+/gu, " ")}`);

    const validateArgs = ["architecture", "validate"];
    console.log(`production CLI validate argv: ${JSON.stringify(validateArgs)}`);
    await requireSuccess("production architecture validate", await runProductionCli(validateArgs));

    const outputRoot = path.join(temporaryRoot, "output");
    const renderArgs = ["architecture", "render", "--out", outputRoot];
    console.log(`production CLI render argv: ${JSON.stringify(renderArgs)}`);
    await requireSuccess("production architecture render", await runProductionCli(renderArgs));
    const artifacts = await assertArchitectureArtifacts(outputRoot);
    console.log(`real render artifacts verified: ${JSON.stringify(artifacts)}`);

    const invalidWorkspace = path.join(temporaryRoot, "invalid.dsl");
    await writeFile(invalidWorkspace, "workspace { this is invalid Structurizr DSL\n", "utf8");
    const invalidOutput = path.join(temporaryRoot, "invalid-output");
    const invalidExport = await runProcess(shim, [
      "export",
      "-format",
      "static",
      "-workspace",
      invalidWorkspace,
      "-output",
      invalidOutput,
    ]);
    if (invalidExport.exitCode === 0 || invalidExport.error !== null) {
      throw new Error("real Structurizr accepted invalid DSL or could not be invoked for the failure proof");
    }
    console.log(`real exporter invalid-DSL failure returned non-zero: ${String(invalidExport.exitCode)}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
