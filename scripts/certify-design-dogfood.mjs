#!/usr/bin/env node
/*
 * Execute one self-hosted Design Intent through the installed Wabachi package.
 * The temporary repository is a real Git clone so every review, certification,
 * and promotion binding is an immutable repository revision rather than a
 * fabricated fixture value.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changeId = "wabachi-code-intent-bootstrap";
const timestamp = "2026-09-21T00:00:00.000Z";
const REVISION_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * Pure shape check for one main() result, shared by the regression run
 * (scripts/run-package-suite.mjs) and the harness test so both enforce the
 * same bounded contract without re-running the dogfood lifecycle.
 */
function validateDogfoodResult(result) {
  if (result === null || typeof result !== "object") return "dogfood result must be an object";
  if (result.changeId !== changeId) return "dogfood result changeId must match the bootstrap Code Intent change";
  for (const field of ["bootstrapRevision", "proposalRevision", "implementationRevision", "promotedRevision"]) {
    if (!REVISION_PATTERN.test(result[field])) return `dogfood result ${field} must be a 40-character Git revision`;
  }
  if (result.certificationResult !== "match") return "dogfood result certificationResult must be match";
  if (result.promotionOk !== true) return "dogfood result promotionOk must be true";
  if (result.lifecycleState !== "promoted") return "dogfood result lifecycleState must be promoted";
  if (result.rendered !== "ok") return "dogfood result rendered must be ok";
  if (!Array.isArray(result.renderedFiles) || !result.renderedFiles.includes("index.html")) {
    return "dogfood result renderedFiles must include index.html";
  }
  return undefined;
}

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe", ...options }).trim();
}

function runJson(bin, args, cwd) {
  const output = run(bin, [...args, "--json"], cwd);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`installed Design command returned invalid JSON: ${output}`, { cause: error });
  }
}

function git(cwd, args) {
  return run("git", args, cwd);
}

function commit(cwd, message) {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-qm", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function packageDirectory(consumer, packageName) {
  const packageJson = JSON.parse(
    requireUnavailableRead(path.join(consumer, "node_modules", packageName, "package.json")),
  );
  void packageJson;
  return path.join(consumer, "node_modules", packageName);
}

function requireUnavailableRead(file) {
  // Kept synchronous so the package path is resolved before dynamic imports.
  return execFileSync("node", ["-e", `process.stdout.write(require(${JSON.stringify(file)}))`], { encoding: "utf8" });
}

async function installPackage(root, workspace) {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!(await exists(path.join(root, "dist", "index.js")))) run("pnpm", ["run", "build"], root);
  const pack = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json"], root));
  const packEntry = Array.isArray(pack) ? pack[0] : Object.values(pack)[0];
  const tarball = path.join(root, packEntry.filename);
  const consumer = await mkdtemp(path.join(os.tmpdir(), "wabachi-dogfood-consumer-"));
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "dogfood-consumer", private: true }));
  run("npm", ["install", "--no-save", tarball], consumer, { stdio: "pipe" });
  const installed = path.join(consumer, "node_modules", packageJson.name);
  return { consumer, installed, tarball };
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = process.env.WABACHI_REPOSITORY_ROOT ?? scriptRoot;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "wabachi-design-dogfood-"));
  let packageInstall;
  try {
    packageInstall = await installPackage(root, tempRoot);
    const bin = path.join(packageInstall.consumer, "node_modules", ".bin", "wabachi");
    const repository = path.join(tempRoot, "repository");
    run("git", ["clone", "--quiet", root, repository], root);
    git(repository, ["config", "user.email", "dogfood@example.invalid"]);
    git(repository, ["config", "user.name", "Wabachi real dogfood"]);

    // The checked-in Canon is the bootstrap source of truth. Copying it into
    // the clone and committing it gives the runtime an immutable base revision.
    await cp(path.join(root, ".wabachi", "architecture.json"), path.join(repository, ".wabachi", "architecture.json"));
    // This script's own prior run may have checked in this changeId's
    // change.json/record.json as historical evidence (docs/DESIGN_DOGFOOD.md).
    // Clear it from the clone before authoring a fresh proposal so every run
    // starts from "no Design Change yet", exactly like a first real proposal.
    await rm(path.join(repository, ".wabachi", "changes", changeId), { recursive: true, force: true });
    const bootstrapChanged = git(repository, ["status", "--porcelain", "--", ".wabachi"]).length > 0;
    const bootstrapRevision = bootstrapChanged
      ? commit(repository, "dogfood: bootstrap current Canon")
      : git(repository, ["rev-parse", "HEAD"]);
    const current = JSON.parse(await readFile(path.join(repository, ".wabachi", "architecture.json"), "utf8"));
    const target = structuredClone(current);
    const intent = target.codeIntents?.entries?.find((entry) => entry.id === "create-architecture-document-intent");
    if (intent === undefined) throw new Error("bootstrap Canon is missing the createArchitectureDocument Code Intent");
    const provenInvariantText =
      "createArchitectureDocument preserves declared Canon sections, identity ownership, and source intent";
    // The bootstrap Canon may already carry the proven text from a prior
    // check-in (this script's own historical evidence). Re-running the same
    // production create/submit/.../promote path still requires one real
    // semantic operation, so restate the same invariant through its dated
    // source-of-truth wording and let this run re-derive the proven text.
    intent.invariants[0].text =
      intent.invariants[0].text === provenInvariantText
        ? "createArchitectureDocument preserves every declared Canon section and derives identity ownership"
        : provenInvariantText;
    const targetPath = path.join(repository, "dogfood-target.json");
    await writeFile(targetPath, `${JSON.stringify(target, null, 2)}\n`);

    const created = runJson(bin, ["design", "create", changeId, "dogfood-target.json"], repository);
    if (created.changeId !== changeId || created.target?.operations?.length !== 1) {
      throw new Error("production Design create did not author the bounded Code Intent change");
    }
    const proposalRevision = commit(repository, "dogfood: persist proposed Design Change");
    runJson(bin, ["design", "submit", changeId], repository);
    const reviewPath = path.join(repository, "dogfood-design-review.json");
    await writeFile(
      reviewPath,
      `${JSON.stringify(
        {
          reviewId: "wabachi-code-intent-design-review",
          changeId,
          proposalDigest: created.digest,
          proposalRevision,
          decision: "approved",
          actor: "wabachi-dogfood-reviewer",
          reason: "Wabachi self-hosted review of the createArchitectureDocument Code Intent proposal",
          timestamp,
          evidence: [{ provider: "git", reference: `${proposalRevision}:.wabachi/changes/${changeId}/change.json` }],
        },
        null,
        2,
      )}\n`,
    );
    const reviewed = runJson(bin, ["design", "review", changeId, "--input", "dogfood-design-review.json"], repository);
    if (reviewed.state !== "approved") throw new Error(`production Design review did not approve: ${reviewed.state}`);
    const started = runJson(bin, ["design", "start", changeId], repository);
    if (started.state !== "implementing")
      throw new Error(`production Design start did not enter implementing: ${started.state}`);

    const link = {
      linkId: "wabachi-code-intent-implementation",
      changeId,
      changeDigest: created.digest,
      implementation: {
        repositoryHost: "github.com",
        repositoryId: "1335559861",
        repository: "yohn-jp/wabachi",
        number: 227,
      },
      targetEntryKeys: created.target.operations.map((operation) => operation.entryKey),
      evidence: [
        {
          provider: "git",
          reference: `${proposalRevision}:src/architecture/canon/document.ts#createArchitectureDocument`,
        },
      ],
    };
    await writeFile(path.join(repository, "dogfood-link.json"), `${JSON.stringify(link, null, 2)}\n`);
    const linked = runJson(bin, ["design", "link", changeId, "--input", "dogfood-link.json"], repository);
    if (linked.implementations?.length !== 1)
      throw new Error("production Design link did not persist implementation linkage");
    const implementationRevision = commit(repository, "dogfood: bind implementation linkage");
    const revision = { repository, revision: implementationRevision };

    const runtimeModule = await import(
      pathToFileURL(path.join(packageInstall.installed, "dist/design/runtime.js")).href
    );
    const workflowModule = await import(
      pathToFileURL(path.join(packageInstall.installed, "dist/runtime/workflow.js")).href
    );
    const providerModule = await import(
      pathToFileURL(path.join(packageInstall.installed, "dist/runtime/typescriptProvider.js")).href
    );
    const factsModule = await import(pathToFileURL(path.join(packageInstall.installed, "dist/runtime/facts.js")).href);
    const runRoot = path.join(tempRoot, "provider-run");
    await workflowModule.runProviderMatrix({
      source: repository,
      revision: implementationRevision,
      runRoot,
      providers: [providerModule.createTypeScriptProvider()],
    });
    const observationsArtifact = JSON.parse(await readFile(path.join(runRoot, "normalized", "observations.json")));
    const factsArtifact = factsModule.normalizeFacts(observationsArtifact.observations, { includeComparisons: false });
    const tree = git(repository, ["ls-tree", "-r", "--name-only", implementationRevision]).split("\n").filter(Boolean);
    const targetEntryKeys = created.target.operations.map((operation) => operation.entryKey);
    const humanChecks = targetEntryKeys.map((targetEntryKey) => ({
      checkId: `design:${targetEntryKey}`,
      targetEntryKey,
      result: "match",
      detail: "Wabachi dogfood reviewer confirmed the realized Canon Code Intent change",
    }));
    const subject = git(repository, ["ls-tree", "-r", implementationRevision])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/u.exec(line);
        return match === null ? undefined : { mode: match[1], objectId: match[2], path: match[3] };
      })
      .filter((entry) => entry !== undefined && entry.path.startsWith("src/"));
    const appRuntime = await runtimeModule.createDesignRuntime({ repositoryRoot: repository });
    const certified = await appRuntime.application.certify({
      changeId,
      implementationRevision: revision,
      repositoryEvidence: {
        repository: revision,
        providers: factsArtifact.facts.slice(0, 1).map((fact) => fact.provider),
        facts: factsArtifact.facts,
        factsComplete: true,
        tree: { paths: tree, complete: true },
      },
      completionEvidence: [
        {
          evidenceId: "wabachi-code-intent-completion",
          changeId,
          changeDigest: created.digest,
          implementation: link.implementation,
          implementationRevision: revision,
          result: "match",
        },
      ],
      implementationSubject: subject,
      humanReviews: [
        {
          reviewId: "wabachi-code-intent-certification-review",
          changeId,
          changeDigest: created.digest,
          implementationRevision: revision,
          checks: humanChecks,
          actor: "wabachi-dogfood-certifier",
          reason: "Wabachi self-hosted certification review",
          timestamp,
        },
      ],
      codeIntent: target.codeIntents.entries,
      certificationId: "wabachi-code-intent-certification",
      recordedAt: timestamp,
    });
    if (certified.certification?.result !== "match") {
      throw new Error(
        `production certification was ${certified.certification?.result ?? "missing"}: ${JSON.stringify(
          certified.certification?.checks ?? [],
        )}`,
      );
    }
    const promotionPlanModule = await import(
      pathToFileURL(path.join(packageInstall.installed, "dist/design/promotion/plan.js")).href
    );
    const preflight = promotionPlanModule.preflightPromotion({
      current: await appRuntime.ports.canon.readCurrent(),
      change: await appRuntime.ports.changeStore.read(changeId),
      lifecycle: await appRuntime.ports.lifecycle.read(changeId),
      certifiedTarget: target,
      promotionTransition: { state: "promoted" },
      implementationRevision: revision,
    });
    if (preflight.ok !== true) {
      const storedLifecycle = await appRuntime.ports.lifecycle.read(changeId);
      throw new Error(
        `production promotion preflight rejected dogfood: ${preflight.failure.code}: ${preflight.failure.detail}; certification=${JSON.stringify(
          storedLifecycle?.certification,
        )}`,
      );
    }
    const promotion = await appRuntime.application.promote(changeId);
    if (promotion.ok !== true) throw new Error("production promotion did not succeed");
    const promotedCurrent = await appRuntime.ports.canon.readCurrent();
    if (promotedCurrent.document.codeIntents?.entries[0]?.invariants[0]?.text !== intent.invariants[0].text) {
      throw new Error("promotion did not produce the target current Canon");
    }
    const outputRoot = path.join(tempRoot, "documentation");
    const rendered = runJson(bin, ["design", "render", changeId, "--out", outputRoot], repository);
    if (rendered.status !== "ok" || rendered.complete !== true)
      throw new Error("production documentation render was incomplete");
    const promotedRevision = commit(repository, "dogfood: promote current Canon and render lifecycle");
    const lifecycle = JSON.parse(
      await readFile(path.join(repository, ".wabachi", "changes", changeId, "lifecycle.json"), "utf8"),
    );
    if (lifecycle.state !== "promoted") throw new Error(`dogfood lifecycle did not terminalize: ${lifecycle.state}`);
    const promotedCanon = JSON.parse(await readFile(path.join(repository, ".wabachi", "architecture.json"), "utf8"));
    const result = {
      changeId,
      bootstrapRevision,
      proposalRevision,
      implementationRevision,
      promotedRevision,
      certificationResult: certified.certification.result,
      promotionOk: promotion.ok,
      lifecycleState: lifecycle.state,
      rendered: rendered.status,
      renderedFiles: ["index.html", "report.json"].filter((file) =>
        requireUnavailableExists(path.join(outputRoot, file)),
      ),
      /** Retained so a caller can check the proven artifacts into the real repository as historical evidence. */
      artifacts: { change: created, lifecycle, promotedCanon },
    };
    const invalid = validateDogfoodResult(result);
    if (invalid !== undefined) throw new Error(`production dogfood result failed its own contract: ${invalid}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (packageInstall?.tarball !== undefined) await rm(packageInstall.tarball, { force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function requireUnavailableExists(file) {
  try {
    execFileSync("test", ["-f", file]);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { main, validateDogfoodResult };
