#!/usr/bin/env node
// Installs the packed tarball into an isolated directory and runs the
// installed bin through its real npm-generated launcher. `npm pack --dry-run`
// only lists file contents — it never proves install or execution actually
// work, which is the failure mode this guards against.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packageName = packageJson.name;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function fail(message) {
  console.error(`smoke test failed: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function packageBinTargets(packageDirectory) {
  const installedPackageJson = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
  const bin = installedPackageJson.bin;
  if (typeof bin !== "object" || bin === null) fail("installed package.json has no bin map");
  return Object.entries(bin).map(([name, relativeTarget]) => ({
    name,
    target: path.join(packageDirectory, relativeTarget),
  }));
}

function installedLauncher(binDirectory, name, args, cwd, timeout = 30_000) {
  const launcher = path.join(binDirectory, name);
  const result = spawnSync(launcher, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env },
  });
  if (result.error) fail(`installed ${name} ${args.join(" ")} failed to start: ${result.error.message}`);
  return result;
}

function runInstalledJson(binDirectory, name, args, cwd) {
  const result = installedLauncher(binDirectory, name, [...args, "--json"], cwd);
  if (result.status !== 0) {
    fail(`installed ${name} ${args.join(" ")} exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(
      `installed ${name} ${args.join(" ")} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeDesignTarget(sourcePath, targetPath) {
  const target = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  target.elements.push({ id: "installed-design-target", kind: "service" });
  target.globalIdentityRegistry.entries.push({ id: "installed-design-target", namespace: "element" });
  fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
}

function runInstalledDesignSmoke(packageDirectory, binDirectory, binName) {
  const designRepository = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-design-repository-"));
  try {
    run("git", ["init", "-q"], { cwd: designRepository });
    run("git", ["config", "user.email", "smoke@example.invalid"], { cwd: designRepository });
    run("git", ["config", "user.name", "Wabachi installed smoke"], { cwd: designRepository });

    const repositoryCanon = path.join(designRepository, ".wabachi", "architecture.json");
    fs.mkdirSync(path.dirname(repositoryCanon), { recursive: true });
    const minimalCanon = path.join(packageDirectory, "docs", "examples", "minimal-canon.json");
    fs.copyFileSync(minimalCanon, repositoryCanon);
    const targetCanon = path.join(designRepository, "target-canon.json");
    writeDesignTarget(minimalCanon, targetCanon);
    run("git", ["add", "."], { cwd: designRepository });
    run("git", ["commit", "-qm", "bootstrap Canon"], { cwd: designRepository });

    const change = runInstalledJson(
      binDirectory,
      binName,
      ["design", "create", "installed-design-smoke", "target-canon.json"],
      designRepository,
    );
    if (change.changeId !== "installed-design-smoke" || typeof change.digest !== "string") {
      fail("installed Design create did not return a bound Design Change");
    }
    if (!Array.isArray(change.target?.operations) || change.target.operations.length === 0) {
      fail("installed Design create did not produce a target operation");
    }

    for (const command of ["show", "diff", "status", "validate"]) {
      const result = runInstalledJson(binDirectory, binName, ["design", command, change.changeId], designRepository);
      if (result.ok === false) fail(`installed Design ${command} unexpectedly rejected the draft`);
    }
    const renderDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-design-site-"));
    fs.rmSync(renderDirectory, { recursive: true, force: true });
    try {
      const rendered = runInstalledJson(
        binDirectory,
        binName,
        ["design", "render", change.changeId, "--out", renderDirectory],
        designRepository,
      );
      if (
        rendered.status !== "ok" ||
        rendered.complete !== true ||
        !fs.existsSync(path.join(renderDirectory, "index.html"))
      ) {
        fail("installed Design render did not produce an offline site");
      }
    } finally {
      fs.rmSync(renderDirectory, { recursive: true, force: true });
    }

    const submitted = runInstalledJson(binDirectory, binName, ["design", "submit", change.changeId], designRepository);
    if (submitted.state !== "design-review") fail("installed Design submit did not enter design-review");

    // The proposal revision is made immutable before review evidence is
    // submitted, matching the production review freshness contract.
    run("git", ["add", ".wabachi"], { cwd: designRepository });
    run("git", ["commit", "-qm", "persist Design proposal"], { cwd: designRepository });
    const proposalRevision = run("git", ["rev-parse", "HEAD"], { cwd: designRepository }).stdout.trim();
    const reviewPath = path.join(designRepository, "design-review.json");
    fs.writeFileSync(
      reviewPath,
      `${JSON.stringify(
        {
          reviewId: "installed-smoke-review",
          changeId: change.changeId,
          proposalDigest: change.digest,
          proposalRevision,
          decision: "approved",
          actor: "installed-smoke",
          reason: "test-only package smoke fixture; not dogfood evidence",
          timestamp: "2026-09-21T00:00:00.000Z",
          evidence: [{ provider: "manual", reference: "test-only installed package smoke" }],
        },
        null,
        2,
      )}\n`,
    );
    const reviewed = runInstalledJson(
      binDirectory,
      binName,
      ["design", "review", change.changeId, "--input", "design-review.json"],
      designRepository,
    );
    if (reviewed.state !== "approved") fail("installed Design review did not record approved evidence");
    const started = runInstalledJson(binDirectory, binName, ["design", "start", change.changeId], designRepository);
    if (started.state !== "implementing") fail("installed Design start did not enter implementing");

    const targetEntryKey = change.target.operations[0].entryKey;
    const linkPath = path.join(designRepository, "implementation-review.json");
    fs.writeFileSync(
      linkPath,
      `${JSON.stringify(
        {
          linkId: "installed-smoke-link",
          changeId: change.changeId,
          changeDigest: change.digest,
          implementation: {
            repositoryHost: "github.com",
            repositoryId: "1335559861",
            repository: "yohn-jp/wabachi",
            number: 226,
          },
          targetEntryKeys: [targetEntryKey],
          evidence: [{ provider: "manual", reference: "test-only installed package smoke" }],
        },
        null,
        2,
      )}\n`,
    );
    const linked = runInstalledJson(
      binDirectory,
      binName,
      ["design", "link", change.changeId, "--input", "implementation-review.json"],
      designRepository,
    );
    if (linked.implementations?.length !== 1) fail("installed Design link did not persist implementation linkage");

    const certificationPath = path.join(designRepository, "certification.json");
    fs.writeFileSync(
      certificationPath,
      `${JSON.stringify(
        {
          changeId: change.changeId,
          changeDigest: change.digest,
          implementationRevision: { repository: "local/installed-smoke", revision: proposalRevision },
          result: "match",
        },
        null,
        2,
      )}\n`,
    );
    const fabricated = installedLauncher(
      binDirectory,
      binName,
      ["design", "certify", change.changeId, "--input", "certification.json", "--json"],
      designRepository,
    );
    if (
      fabricated.status === 0 ||
      !/unknown field: result|final CertificationEvidence|certification input/u.test(
        fabricated.stdout + fabricated.stderr,
      )
    ) {
      fail("installed Design certify accepted fabricated final-result evidence");
    }
    fs.writeFileSync(
      certificationPath,
      `${JSON.stringify(
        {
          changeId: change.changeId,
          changeDigest: change.digest,
          implementationRevision: { repository: "local/installed-smoke", revision: proposalRevision },
        },
        null,
        2,
      )}\n`,
    );
    const incomplete = installedLauncher(
      binDirectory,
      binName,
      ["design", "certify", change.changeId, "--input", "certification.json", "--json"],
      designRepository,
    );
    // Incomplete evidence fails closed at the certification result, not the
    // process exit code: `design certify` still exits 0 and prints the
    // derived CertificationEvidence so callers can inspect why the proof
    // plan is unresolved.
    let incompleteResult;
    try {
      incompleteResult = JSON.parse(incomplete.stdout);
    } catch {
      incompleteResult = undefined;
    }
    if (
      incomplete.status !== 0 ||
      incompleteResult?.certification?.result !== "unresolved" ||
      !/illegal lifecycle transition|unresolved|certification/u.test(incomplete.stdout + incomplete.stderr)
    ) {
      fail("installed Design certify did not fail closed for incomplete evidence");
    }
    console.log(
      "installed Design lifecycle smoke verified: create/show/diff/status/validate/render/review/link/certify guards.",
    );
  } finally {
    fs.rmSync(designRepository, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const index = argv.indexOf("--tarball");
  return { tarball: index === -1 ? undefined : argv[index + 1] };
}

function main() {
  const { tarball } = parseArgs(process.argv.slice(2));
  let tarballPath;
  let ownsTarball;
  if (tarball !== undefined) {
    tarballPath = path.resolve(tarball);
    ownsTarball = false;
    if (!fs.existsSync(tarballPath)) fail(`tarball not found: ${tarballPath}`);
  } else {
    console.log("packing tarball...");
    // Verifies the dist produced by the build step, not a re-built one:
    // prepack's implicit rebuild is intentionally not relied on here.
    const packResult = run("npm", ["pack", "--json", "--ignore-scripts"], { cwd: repoRoot });
    const packReport = JSON.parse(packResult.stdout);
    const packInfo = Array.isArray(packReport) ? packReport[0] : Object.values(packReport)[0];
    if (packInfo === undefined || typeof packInfo.filename !== "string") {
      fail("npm pack --json returned no package archive report");
    }
    tarballPath = path.join(repoRoot, packInfo.filename);
    ownsTarball = true;
  }

  const installDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-"));
  try {
    fs.writeFileSync(
      path.join(installDirectory, "package.json"),
      JSON.stringify({ name: "smoke-consumer", private: true, version: "0.0.0" }, null, 2),
    );

    console.log("installing packed tarball into isolated directory...");
    run("npm", ["install", "--no-save", tarballPath], { cwd: installDirectory });

    const scope = packageName.startsWith("@") ? packageName.split("/")[0] : undefined;
    const installedPackageDirectory = scope
      ? path.join(installDirectory, "node_modules", scope, packageName.split("/")[1])
      : path.join(installDirectory, "node_modules", packageName);
    if (!fs.existsSync(installedPackageDirectory)) fail(`${packageName} was not installed under node_modules`);

    for (const relativePath of [
      "docs/USAGE.md",
      "docs/examples/minimal-canon.json",
      "skills/wabachi/SKILL.md",
      ".codex-plugin/plugin.json",
    ]) {
      const bundledPath = path.join(installedPackageDirectory, relativePath);
      if (!fs.existsSync(bundledPath)) fail(`bundled asset is missing after install: ${relativePath}`);
    }

    const binTargets = packageBinTargets(installedPackageDirectory);
    if (binTargets.length === 0) fail("package.json defines no bin entries to smoke test");

    for (const { name, target } of binTargets) {
      if (!fs.existsSync(target)) fail(`bin target for "${name}" does not exist at ${target}`);
    }

    // Goes through node_modules/.bin so a broken npm-generated launcher is
    // caught too — checking bin target existence alone would miss that.
    const binDirectory = path.join(installDirectory, "node_modules", ".bin");
    for (const { name } of binTargets) {
      const launcher = path.join(binDirectory, name);
      if (!fs.existsSync(launcher)) fail(`npm did not generate a launcher for "${name}" at ${launcher}`);

      console.log(`running ${name} --help through its installed launcher...`);
      const helpResult = spawnSync(launcher, ["--help"], { cwd: installDirectory, encoding: "utf8", timeout: 10_000 });
      if (helpResult.error) fail(`launcher "${name}" failed to start: ${helpResult.error.message}`);
      if (helpResult.status !== 0) fail(`launcher "${name}" --help exited ${helpResult.status}, expected 0`);

      console.log(`running ${name} --version through its installed launcher...`);
      const versionResult = spawnSync(launcher, ["--version"], {
        cwd: installDirectory,
        encoding: "utf8",
        timeout: 10_000,
      });
      if (versionResult.error) fail(`launcher "${name}" failed to start: ${versionResult.error.message}`);
      if (versionResult.status !== 0) fail(`launcher "${name}" --version exited ${versionResult.status}, expected 0`);
      if (versionResult.stdout.trim().length === 0) fail(`launcher "${name}" --version printed nothing`);
    }

    const architectureBin = binTargets.find(({ name }) => name === packageName) ?? binTargets[0];
    if (architectureBin === undefined) fail("installed package has no executable architecture renderer");
    runInstalledDesignSmoke(installedPackageDirectory, binDirectory, architectureBin.name);
    const exampleResult = spawnSync(path.join(binDirectory, architectureBin.name), ["architecture", "example"], {
      cwd: installDirectory,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (exampleResult.error) fail(`installed architecture example failed to start: ${exampleResult.error.message}`);
    if (exampleResult.status !== 0) {
      fail(
        `installed architecture example exited ${exampleResult.status}:\n${exampleResult.stdout}\n${exampleResult.stderr}`,
      );
    }
    try {
      const example = JSON.parse(exampleResult.stdout);
      if (example.documentId !== "minimal-architecture-canon") {
        fail("installed architecture example returned an unexpected Canon");
      }
    } catch (error) {
      fail(
        `installed architecture example was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const architectureCanon = path.join(repoRoot, ".wabachi", "architecture.json");
    if (!fs.existsSync(architectureCanon)) fail(`architecture dogfood Canon is missing: ${architectureCanon}`);
    const architectureOutput = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-architecture-"));
    try {
      console.log("rendering .wabachi/architecture.json through the installed launcher...");
      const renderResult = spawnSync(
        path.join(binDirectory, architectureBin.name),
        ["architecture", "render", "--out", architectureOutput, "--json"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, PATH: path.dirname(process.execPath) },
        },
      );
      if (renderResult.error) fail(`installed architecture render failed to start: ${renderResult.error.message}`);
      if (renderResult.status !== 0) {
        fail(
          `installed architecture render exited ${renderResult.status}:\n${renderResult.stdout}\n${renderResult.stderr}`,
        );
      }
      const renderReport = JSON.parse(renderResult.stdout.trim());
      if (renderReport.ok !== true) fail("installed architecture render did not report success");
      for (const relativePath of ["index.html", "diagrams/index.html", "diagrams/wabachi-react-flow.css"]) {
        if (!fs.existsSync(path.join(architectureOutput, relativePath))) {
          fail(`installed architecture render did not create ${relativePath}`);
        }
      }
    } finally {
      fs.rmSync(architectureOutput, { recursive: true, force: true });
    }

    console.log("smoke test passed.");
  } finally {
    fs.rmSync(installDirectory, { recursive: true, force: true });
    if (ownsTarball) fs.rmSync(tarballPath, { force: true });
  }
}

main();
