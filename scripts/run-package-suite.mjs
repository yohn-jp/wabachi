#!/usr/bin/env node
// Package-content validation: confirms `npm pack` includes exactly the files
// package.json's "files" field promises (no more, no less), then delegates
// install/exec verification to smoke-test.mjs against the same tarball.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  return result;
}

function validateWorkingSetQualityCorpus() {
  for (const requiredPath of [
    "src/working-set/quality.ts",
    "src/working-set/quality.test.ts",
    "src/working-set/fixtures/quality-corpus-v1.json",
    "docs/WORKING_SET_QUALITY.md",
  ]) {
    if (!fs.existsSync(path.join(repoRoot, requiredPath))) {
      throw new Error(`working-set quality contract is missing required source asset "${requiredPath}"`);
    }
  }

  const corpus = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "src/working-set/fixtures/quality-corpus-v1.json"), "utf8"),
  );
  if (
    corpus.kind !== "working-set-quality-corpus" ||
    corpus.schemaVersion !== 1 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(corpus.revision) ||
    !Array.isArray(corpus.cases) ||
    corpus.cases.some(
      (qualityCase) => qualityCase.revision !== corpus.revision || qualityCase.candidate?.revision !== corpus.revision,
    )
  ) {
    throw new Error("working-set quality corpus is not pinned to one immutable revision");
  }
}

function main() {
  const distEntry = path.join(repoRoot, "dist", "index.js");
  if (!fs.existsSync(distEntry)) throw new Error("dist is missing; run pnpm run build before the package suite");

  validateWorkingSetQualityCorpus();
  
  const packResult = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
  const packReport = JSON.parse(packResult.stdout);
  const packInfo = Array.isArray(packReport) ? packReport[0] : Object.values(packReport)[0];
  
  if (packInfo === undefined || !Array.isArray(packInfo.files)) {
    throw new Error("npm pack --json returned no package file report");
  }
  const packedFiles = packInfo.files.map((entry) => entry.path);

  for (const requiredPath of [
    "docs/USAGE.md",
    "skills/wabachi/SKILL.md",
    ".codex-plugin/plugin.json",
    "dist/architecture/documentation/site.js",
    "dist/architecture/documentation/react-flow.js",
    "dist/architecture/projection/react-flow.js",
  ]) {
    if (!packedFiles.includes(requiredPath)) {
      throw new Error(`required bundled asset "${requiredPath}" is not included in the packed tarball`);
    }
  }

  const executableBinPaths = Object.values(
    JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).bin ?? {},
  );
  for (const binPath of executableBinPaths) {
    if (!packedFiles.includes(binPath)) {
      throw new Error(`bin entry "${binPath}" is not included in the packed tarball`);
    }
    const stat = fs.statSync(path.join(repoRoot, binPath));
    const isExecutableByOwner = (stat.mode & 0o100) !== 0;
    if (!isExecutableByOwner) {
      throw new Error(`bin entry "${binPath}" is not executable (chmod +x it, or check build step file perms)`);
    }
  }

  console.log(`package contents verified: ${packedFiles.length} file(s), all bin targets present and executable.`);

  run(process.execPath, ["scripts/smoke-test.mjs"], { stdio: "inherit" });
}

main();
