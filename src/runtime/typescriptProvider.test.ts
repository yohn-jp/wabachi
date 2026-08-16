import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { Observation } from "./observation.js";
import type { ProviderContext } from "./provider.js";
import { createTypeScriptProvider } from "./typescriptProvider.js";

const tmpRoots: string[] = [];

after(async () => {
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wabachi-ts-workspace-"));
  tmpRoots.push(dir);
  return dir;
}

async function writeFixtureProject(workspaceRoot: string): Promise<void> {
  await writeFile(
    path.join(workspaceRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });

  await writeFile(
    path.join(workspaceRoot, "src", "shapes.ts"),
    [
      "export interface Shape {",
      "  area(): number;",
      "}",
      "",
      "export class Circle implements Shape {",
      "  constructor(public radius: number) {}",
      "  area(): number {",
      "    return Math.PI * this.radius * this.radius;",
      "  }",
      "}",
      "",
      "export class ColoredCircle extends Circle {",
      "  constructor(radius: number, public color: string) {",
      "    super(radius);",
      "  }",
      "}",
      "",
      "export function describe(shape: Shape): string {",
      '  return "area=" + shape.area();',
      "}",
      "",
      "export function overload(value: string): string;",
      "export function overload(value: number): number;",
      "export function overload(value: string | number): string | number {",
      "  return value;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "src", "index.ts"),
    [
      'import { Circle as CircleAlias, describe } from "./shapes.js";',
      "",
      "const circle = new CircleAlias(2);",
      "export const summary = describe(circle);",
      "",
    ].join("\n"),
    "utf8",
  );
}

function makeContext(workspaceRoot: string, artifactRoot: string): ProviderContext {
  return {
    workspaceRoot,
    artifactRoot,
    repository: { source: workspaceRoot, commitSha: "0000000000000000000000000000000000000000" },
  };
}

test("is unavailable without a tsconfig.json", async () => {
  const workspaceRoot = await newWorkspace();
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  const available = await provider.isAvailable(makeContext(workspaceRoot, artifactRoot));
  assert.equal(available, false);
});

test("is available with a tsconfig.json", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  const available = await provider.isAvailable(makeContext(workspaceRoot, artifactRoot));
  assert.equal(available, true);
});

test("records the exact TypeScript version and project configuration used", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  const result = await provider.execute(makeContext(workspaceRoot, artifactRoot));
  assert.equal(result.status, "ok");

  const meta = JSON.parse(await readFile(path.join(artifactRoot, "meta.json"), "utf8"));
  assert.equal(meta.typescriptVersion, provider.identity.version);
  assert.equal(meta.tsconfigPath, "tsconfig.json");
  assert.ok(meta.rootFiles.some((file: string) => file.endsWith("shapes.ts")));
  assert.ok(meta.rootFiles.some((file: string) => file.endsWith("index.ts")));
});

async function readObservations(artifactRoot: string): Promise<Observation[]> {
  const content = await readFile(path.join(artifactRoot, "observations.jsonl"), "utf8");
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Observation);
}

test("emits defines observations for classes, interfaces, and overloaded functions", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  await provider.execute(makeContext(workspaceRoot, artifactRoot));
  const observations = await readObservations(artifactRoot);
  const defines = observations.filter((o) => o.predicate === "defines");

  assert.ok(defines.some((o) => o.object.kind === "InterfaceDeclaration" && o.object.name.includes("Shape")));
  assert.ok(defines.some((o) => o.object.kind === "ClassDeclaration" && o.object.name.includes("Circle")));
  assert.ok(defines.some((o) => o.object.kind === "ClassDeclaration" && o.object.name.includes("ColoredCircle")));

  const overloadDefines = defines.filter((o) => o.object.name.includes("overload"));
  assert.ok(overloadDefines.length >= 1, "expected at least one definition for the overloaded function");
});

test("emits extends and implements observations from heritage clauses", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  await provider.execute(makeContext(workspaceRoot, artifactRoot));
  const observations = await readObservations(artifactRoot);

  const implementsObs = observations.find((o) => o.predicate === "implements");
  assert.ok(implementsObs);
  assert.match(implementsObs.subject.name, /Circle$/u);
  assert.match(implementsObs.object.name, /Shape$/u);

  const extendsObs = observations.find((o) => o.predicate === "extends");
  assert.ok(extendsObs);
  assert.match(extendsObs.subject.name, /ColoredCircle$/u);
  assert.match(extendsObs.object.name, /Circle$/u);
});

test("emits imports observations and resolves aliased import calls", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  await provider.execute(makeContext(workspaceRoot, artifactRoot));
  const observations = await readObservations(artifactRoot);

  const importObs = observations.find((o) => o.predicate === "imports" && o.subject.name.endsWith("index.ts"));
  assert.ok(importObs);
  assert.match(importObs.object.name, /shapes\.js$/u);

  const callObs = observations.filter((o) => o.predicate === "calls");
  assert.ok(
    callObs.some((o) => o.object.name.includes("describe")),
    "expected a call observation resolving to the imported describe function",
  );
});

test("emits export observations", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  await provider.execute(makeContext(workspaceRoot, artifactRoot));
  const observations = await readObservations(artifactRoot);

  assert.ok(observations.some((o) => o.predicate === "exports"));
});

test("retains raw diagnostics evidence alongside observations", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);
  const artifactRoot = await newWorkspace();
  const provider = createTypeScriptProvider();

  const result = await provider.execute(makeContext(workspaceRoot, artifactRoot));
  assert.ok(result.artifacts.includes("diagnostics.json"));
  const diagnostics = JSON.parse(await readFile(path.join(artifactRoot, "diagnostics.json"), "utf8"));
  assert.equal(diagnostics.length, 0);
});

test("produces stable deterministic output for the same revision and configuration", async () => {
  const workspaceRoot = await newWorkspace();
  await writeFixtureProject(workspaceRoot);

  const artifactRootA = await newWorkspace();
  const artifactRootB = await newWorkspace();
  const provider = createTypeScriptProvider();

  await provider.execute(makeContext(workspaceRoot, artifactRootA));
  await provider.execute(makeContext(workspaceRoot, artifactRootB));

  const observationsA = await readFile(path.join(artifactRootA, "observations.jsonl"), "utf8");
  const observationsB = await readFile(path.join(artifactRootB, "observations.jsonl"), "utf8");
  assert.equal(observationsA, observationsB);

  const metaA = await readFile(path.join(artifactRootA, "meta.json"), "utf8");
  const metaB = await readFile(path.join(artifactRootB, "meta.json"), "utf8");
  assert.equal(metaA, metaB);
});
