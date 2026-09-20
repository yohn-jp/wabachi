import assert from "node:assert/strict";
import test from "node:test";
import { createArchitectureDocument } from "../architecture/canon/document.js";
import { normalizeFacts, type FactObservation } from "../runtime/facts.js";
import type { ObservationEntity } from "../runtime/observation.js";
import type { ProviderIdentity } from "../runtime/provider.js";
import { resolveWorkingSetSeeds, type WorkingSetSeedResolutionContext } from "./seeds.js";
import { deriveCandidateWorkingSet } from "./derive.js";

const revision = "0123456789abcdef0123456789abcdef01234567";
const repository = { repositoryHost: "github.com", repositoryId: "1335559861", repository: "yohn-jp/wabachi" } as const;
const provider: ProviderIdentity = { id: "typescript", version: "1", determinism: "deterministic" };
const resolvedRepository = { source: "https://github.com/yohn-jp/wabachi.git", commitSha: revision } as const;

function node(id: string, kind: string): ObservationEntity {
  return { id, kind };
}

function observation(
  predicate: string,
  subject: ObservationEntity,
  object: ObservationEntity | { readonly value: string },
  subjectPath: string,
  objectPath: string,
): FactObservation {
  return {
    schemaVersion: 1,
    subject,
    predicate,
    object,
    provider,
    repository: resolvedRepository,
    source: { path: subjectPath },
    determinism: provider.determinism,
    providerNative: {
      sourceNode: { id: subject.id, path: subjectPath },
      targetNode: typeof object === "object" && "id" in object ? { id: object.id, path: objectPath } : undefined,
    },
  };
}

function context(overrides: Partial<WorkingSetSeedResolutionContext> = {}): WorkingSetSeedResolutionContext {
  return { repository, revision, resolvedRepository, ...overrides };
}

function canon(overrides: Record<string, unknown> = {}) {
  return createArchitectureDocument({
    documentId: "canon",
    root: { id: "architecture" },
    elements: [
      { id: "app", kind: "component" },
      { id: "dependency", kind: "component" },
      { id: "outside", kind: "component" },
      { id: "terminal", kind: "component" },
    ],
    repositoryMappings: [
      { canonId: "app", paths: [{ path: "src/app.ts" }] },
      {
        canonId: "dependency",
        paths: [{ path: "src/dependency.ts" }],
        tests: [{ path: "test/dependency.test.ts", selector: "dependency" }],
      },
      { canonId: "outside", paths: [{ path: "src/outside.ts" }] },
      { canonId: "terminal", paths: [{ path: "src/terminal.ts" }] },
    ],
    ...overrides,
  });
}

function seedResolution(seed: { kind: "architecture-component"; componentId: string }, mappings: readonly unknown[]) {
  return resolveWorkingSetSeeds(
    {
      task: { taskId: "task-139", intent: "implement" },
      repository,
      revision,
      seeds: [seed],
    },
    context({ repositoryMappings: mappings as never }),
  );
}

test("expands only admitted Canon classes, keeps provider evidence supporting, and is byte-stable", () => {
  const seed = seedResolution({ kind: "architecture-component", componentId: "app" }, [
    { canonId: "app", paths: [{ path: "src/app.ts" }] },
    { canonId: "dependency", paths: [{ path: "src/dependency.ts" }] },
  ]);
  const facts = normalizeFacts([
    observation(
      "calls",
      node("appFn", "function"),
      node("dependencyFn", "function"),
      "src/app.ts",
      "src/dependency.ts",
    ),
    observation(
      "extends",
      node("appFn", "function"),
      node("dependencyFn", "function"),
      "src/app.ts",
      "src/dependency.ts",
    ),
  ]);
  const input = {
    seeds: seed,
    providerEvidence: facts,
    canon: canon({ relationships: [{ source: "app", target: "dependency", kind: "calls" }] }),
    workingSetId: "working-set-139",
  };

  const first = deriveCandidateWorkingSet(input);
  const second = deriveCandidateWorkingSet({ ...input, providerEvidence: facts });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.entries.map((entry) => [entry.state, entry.target]),
    [
      ["required", { kind: "file", locator: "src/app.ts" }],
      ["supporting", { kind: "file", locator: "src/dependency.ts" }],
      ["supporting", { kind: "symbol", locator: "src/dependency.ts#dependencyFn" }],
      ["verification", { kind: "test", locator: "test/dependency.test.ts#dependency" }],
    ],
  );
  assert.equal(
    first.entries.some((entry) => entry.target.locator === "src/outside.ts"),
    false,
  );
});

test("keeps a direct required dependency visible while Canon boundaries stop recursive expansion", () => {
  const seed = seedResolution({ kind: "architecture-component", componentId: "app" }, [
    { canonId: "app", paths: [{ path: "src/app.ts" }] },
    { canonId: "dependency", paths: [{ path: "src/dependency.ts" }] },
    { canonId: "outside", paths: [{ path: "src/outside.ts" }] },
  ]);
  const facts = normalizeFacts([]);
  const result = deriveCandidateWorkingSet({
    seeds: seed,
    providerEvidence: facts,
    canon: canon({
      relationships: [
        { source: "app", target: "dependency", kind: "depends-on" },
        { source: "dependency", target: "outside", kind: "depends-on" },
        { source: "outside", target: "terminal", kind: "depends-on" },
      ],
      boundaries: [{ id: "app-boundary", kind: "semantic", memberIds: ["app", "dependency"] }],
    }),
  });

  assert.equal(
    result.entries.some((entry) => entry.state === "required" && entry.target.locator === "src/dependency.ts"),
    true,
  );
  assert.equal(
    result.entries.some((entry) => entry.state === "required" && entry.target.locator === "src/outside.ts"),
    true,
  );
  assert.equal(
    result.entries.some((entry) => entry.target.locator === "src/terminal.ts"),
    false,
  );
});

test("retains provider disagreement and entity ambiguity as unresolved output", () => {
  const seed = seedResolution({ kind: "architecture-component", componentId: "app" }, [
    { canonId: "app", paths: [{ path: "src/app.ts" }] },
  ]);
  const facts = normalizeFacts([
    observation("calls", node("app-a", "function"), node("dep-a", "function"), "src/app.ts", "src/dependency.ts"),
    observation("calls", node("app-a", "function"), node("dep-b", "function"), "src/app.ts", "src/dependency.ts"),
  ]);
  const result = deriveCandidateWorkingSet({
    seeds: seed,
    providerEvidence: facts,
    canon: canon(),
  });

  assert.equal(
    result.entries.some((entry) => entry.state === "unresolved"),
    true,
  );
  assert.equal(
    result.entries.some((entry) => entry.target.locator.includes("provider:calls")),
    true,
  );
  assert.equal(
    result.entries.some((entry) => entry.state === "supporting" && entry.target.locator.includes("dependency")),
    false,
  );

  const singleFact = normalizeFacts([
    observation("calls", node("app-a", "function"), node("dep-a", "function"), "src/app.ts", "src/dependency.ts"),
  ]);
  const ambiguousObject = singleFact.facts[0]?.object;
  assert.ok(ambiguousObject && "nativeId" in ambiguousObject);
  const ambiguousResult = deriveCandidateWorkingSet({
    seeds: seed,
    providerEvidence: {
      ...singleFact,
      facts: [
        {
          ...singleFact.facts[0],
          object: {
            ...ambiguousObject,
            correlationStatus: "ambiguous",
            candidateCanonicalIds: ["candidate-a", "candidate-b"],
          },
        },
      ],
    },
    canon: canon(),
  });
  assert.equal(
    ambiguousResult.entries.some((entry) => entry.state === "unresolved"),
    true,
  );
});

test("classifies mapped tests as verification instead of required execution targets", () => {
  const seed = seedResolution({ kind: "architecture-component", componentId: "dependency" }, [
    {
      canonId: "dependency",
      paths: [{ path: "src/dependency.ts" }],
      tests: [{ path: "test/dependency.test.ts", selector: "dependency" }],
    },
  ]);
  const result = deriveCandidateWorkingSet({
    seeds: seed,
    providerEvidence: normalizeFacts([]),
    canon: canon(),
  });

  assert.deepEqual(
    result.entries.map((entry) => [entry.state, entry.target]),
    [
      ["required", { kind: "file", locator: "src/dependency.ts" }],
      ["verification", { kind: "test", locator: "test/dependency.test.ts#dependency" }],
    ],
  );
});
