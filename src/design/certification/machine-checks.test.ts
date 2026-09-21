import assert from "node:assert/strict";
import test from "node:test";
import { createArchitectureDocument } from "../../architecture/canon/document.js";
import { normalizeFacts, type FactEnvelope, type FactObservation } from "../../runtime/facts.js";
import type { ProviderIdentity } from "../../runtime/provider.js";
import { runMachineChecks } from "./machine-checks.js";

const repository = { source: "https://example.test/wabachi.git", commitSha: "a".repeat(40) };
const revision = { repository: repository.source, revision: repository.commitSha };
const provider: ProviderIdentity = { id: "typescript", version: "6.0.3", determinism: "deterministic" };

function makeFact(
  predicate: FactObservation["predicate"],
  subject: { id: string; kind: string },
  object: FactObservation["object"],
  path: string,
): FactEnvelope {
  const result = normalizeFacts([
    {
      schemaVersion: 1,
      subject,
      predicate,
      object,
      provider,
      repository,
      source: { path, span: "L1" },
      determinism: provider.determinism,
      providerNative: { predicate, subject, object },
    },
  ]);
  const value = result.facts[0];
  assert.ok(value);
  return value;
}

function mappedFact(fact: FactEnvelope, subjectId: string, objectId?: string): FactEnvelope {
  return {
    ...fact,
    subject: {
      ...fact.subject,
      canonicalId: subjectId,
      candidateCanonicalIds: [],
      correlationStatus: "matched",
    },
    ...(objectId === undefined || !("provider" in fact.object)
      ? {}
      : {
          object: {
            ...fact.object,
            canonicalId: objectId,
            candidateCanonicalIds: [],
            correlationStatus: "matched",
          },
        }),
  };
}

function document() {
  return createArchitectureDocument({
    documentId: "certification",
    root: { id: "architecture" },
    repositoryMappings: [
      { canonId: "service", paths: ["src/service.ts"], symbols: [{ path: "src/service.ts", symbol: "Service" }] },
      { canonId: "billing", paths: ["src/billing.ts"] },
    ],
    constraints: [{ kind: "must-not-depend-on", source: "service", target: "billing" }],
  });
}

function evidence(
  facts: readonly FactEnvelope[] = [],
  treePaths: readonly string[] = ["src/service.ts", "src/billing.ts"],
) {
  return {
    repository: revision,
    provider,
    facts,
    factsComplete: true,
    tree: { paths: treePaths, complete: true },
  };
}

test("detects deleted paths and an unambiguous missing symbol", () => {
  const result = runMachineChecks({
    document: document(),
    evidence: evidence([], ["src/billing.ts"]),
  });
  assert.equal(result.result, "mismatch");
  assert.equal(result.checks.find((check) => check.checkId === "path:service:src/service.ts:file")?.result, "mismatch");
  assert.equal(
    result.checks.find((check) => check.checkId === "symbol:service:src/service.ts:Service")?.result,
    "mismatch",
  );
});

test("reports a forbidden dependency as mismatch and partial absence as unresolved", () => {
  const forbidden = mappedFact(
    makeFact("depends-on", { id: "service", kind: "module" }, { id: "billing", kind: "module" }, "src/service.ts"),
    "service",
    "billing",
  );
  const mismatch = runMachineChecks({ document: document(), evidence: evidence([forbidden]) });
  assert.equal(mismatch.result, "mismatch");
  assert.equal(
    mismatch.checks.find((check) => check.checkId === "forbidden-dependency:service:billing")?.result,
    "mismatch",
  );

  const unresolved = runMachineChecks({
    document: document(),
    evidence: { ...evidence(), factsComplete: false },
  });
  assert.equal(
    unresolved.checks.find((check) => check.checkId === "forbidden-dependency:service:billing")?.result,
    "unresolved",
  );
});

test("accepts only unambiguous defines evidence for a symbol", () => {
  const defines = mappedFact(
    makeFact("defines", { id: "Service", kind: "class" }, { value: "src/service.ts" }, "src/service.ts"),
    "service",
  );
  const result = runMachineChecks({ document: document(), evidence: evidence([defines]) });
  assert.equal(
    result.checks.find((check) => check.checkId === "symbol:service:src/service.ts:Service")?.result,
    "match",
  );
});

test("never turns ambiguous endpoint evidence into a forbidden-edge absence match", () => {
  const ambiguousBase = mappedFact(
    makeFact("depends-on", { id: "service", kind: "module" }, { id: "billing", kind: "module" }, "src/service.ts"),
    "service",
    "billing",
  );
  const ambiguous = {
    ...ambiguousBase,
    subject: {
      ...ambiguousBase.subject,
      canonicalId: undefined,
      correlationStatus: "ambiguous" as const,
      candidateCanonicalIds: ["service", "other"],
    },
  };
  const result = runMachineChecks({ document: document(), evidence: evidence([ambiguous]) });
  assert.equal(
    result.checks.find((check) => check.checkId === "forbidden-dependency:service:billing")?.result,
    "unresolved",
  );
});
