#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY = "yohn-jp/wabachi";
const CERTIFICATION_WORKFLOW = "Architecture dogfood certification";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function required(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) fail(`${key} is required`);
  return value;
}

function packageMetadata(repositoryRoot) {
  const value = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  if (value?.name !== "wabachi" || typeof value.version !== "string" || value.version.length === 0) {
    fail("package.json must identify wabachi and a non-empty version");
  }
  return { name: value.name, version: value.version };
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function checkedOutSha(repositoryRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error !== undefined || result.status !== 0) fail("could not resolve checked-out source SHA");
  return String(result.stdout ?? "").trim();
}

export function parseWorkflowContext(environment = process.env, repositoryRoot = REPOSITORY_ROOT) {
  if (required(environment, "GITHUB_REPOSITORY") !== REPOSITORY) {
    fail(`GITHUB_REPOSITORY must be ${REPOSITORY}`);
  }

  const sourceSha = required(environment, "RELEASE_SOURCE_SHA");
  const tag = required(environment, "RELEASE_TAG");
  const artifactPath = path.resolve(required(environment, "RELEASE_ARTIFACT_PATH"));
  const artifactSha256 = required(environment, "RELEASE_ARTIFACT_SHA256");
  const token = required(environment, "GITHUB_TOKEN");

  if (!/^[0-9a-f]{40}$/u.test(sourceSha)) fail("RELEASE_SOURCE_SHA must be an exact lowercase commit SHA");
  if (!/^[0-9a-f]{64}$/u.test(artifactSha256)) fail("RELEASE_ARTIFACT_SHA256 must be a lowercase SHA-256 digest");
  if (!statSync(artifactPath).isFile()) fail("RELEASE_ARTIFACT_PATH must be a regular file");

  const metadata = packageMetadata(repositoryRoot);
  if (tag !== `v${metadata.version}`) fail(`release tag ${tag} does not match package version ${metadata.version}`);
  if (checkedOutSha(repositoryRoot) !== sourceSha) fail("checked-out source SHA does not match RELEASE_SOURCE_SHA");
  if (sha256(artifactPath) !== artifactSha256) fail("packed tarball digest does not match RELEASE_ARTIFACT_SHA256");

  return { sourceSha, tag, artifactPath, artifactSha256, token, metadata };
}

export function hasSuccessfulDogfoodRun(payload, sourceSha) {
  return (
    Array.isArray(payload?.workflow_runs) &&
    payload.workflow_runs.some(
      (run) =>
        run?.name === CERTIFICATION_WORKFLOW &&
        run?.head_sha === sourceSha &&
        run?.status === "completed" &&
        run?.conclusion === "success",
    )
  );
}

async function readJsonBounded(response) {
  if (!response.ok) fail(`GitHub Actions lookup returned HTTP ${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) fail("GitHub Actions response exceeds size bound");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) fail("GitHub Actions response exceeds size bound");
  return JSON.parse(bytes.toString("utf8"));
}

export async function verifyReleaseCertification({
  environment = process.env,
  repositoryRoot = REPOSITORY_ROOT,
  fetchImpl = globalThis.fetch,
} = {}) {
  const context = parseWorkflowContext(environment, repositoryRoot);
  if (typeof fetchImpl !== "function") fail("fetch is unavailable");

  const apiBase = environment.GITHUB_API_URL || "https://api.github.com";
  const url = new URL(`/repos/${REPOSITORY}/actions/runs`, apiBase);
  url.searchParams.set("head_sha", context.sourceSha);
  url.searchParams.set("per_page", "100");

  const payload = await readJsonBounded(
    await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${context.token}`,
        "x-github-api-version": "2022-11-28",
      },
    }),
  );

  if (!hasSuccessfulDogfoodRun(payload, context.sourceSha)) {
    fail(`no successful ${CERTIFICATION_WORKFLOW} run exists for release source ${context.sourceSha}`);
  }

  return {
    passed: true,
    sourceSha: context.sourceSha,
    tag: context.tag,
    artifactSha256: context.artifactSha256,
    certificationWorkflow: CERTIFICATION_WORKFLOW,
  };
}

async function main() {
  try {
    const result = await verifyReleaseCertification();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ passed: false, message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
