import { createSemanticEntryKey, type SemanticEntryKey } from "../entry-key.js";
import type { ArchitectureDocumentV1 } from "../../architecture/canon/document.js";
import type { ArchitectureConstraint } from "../../architecture/canon/constraints.js";
import type { RepositoryMapping, RepositorySymbolMapping } from "../../architecture/canon/repository-mappings.js";
import type { CodeIntent } from "../../architecture/canon/code-intent-contract.js";
import {
  factEqualityKey,
  isFactEnvelope,
  type FactEntityReference,
  type FactEnvelope,
  type FactObject,
} from "../../runtime/facts.js";
import type { RepositoryRevisionReference } from "../contracts.js";
import type { CertificationCheck, CertificationFinding } from "../contracts.js";
import {
  admitRepositoryEvidence,
  type AdmittedRepositoryEvidence,
  type EvidenceCompleteness,
  type RepositoryEvidenceInput,
} from "./evidence.js";

/** Predicates for which a Canon must-not-depend-on constraint has a direct fact mapping. */
export const SUPPORTED_FORBIDDEN_DEPENDENCY_PREDICATES = ["depends-on", "imports", "references", "calls"] as const;

export interface MachineCheckInput {
  readonly document?: ArchitectureDocumentV1;
  readonly canon?: ArchitectureDocumentV1;
  readonly codeIntent?: readonly CodeIntent[];
  readonly evidence?: AdmittedRepositoryEvidence | RepositoryEvidenceInput | unknown;
  readonly repository?: RepositoryRevisionReference;
  readonly expectedRepository?: RepositoryRevisionReference;
  readonly facts?: readonly unknown[];
  readonly tree?: unknown;
  readonly treePaths?: readonly string[];
  readonly treeCompleteness?: EvidenceCompleteness;
  readonly treeComplete?: boolean;
  readonly factsCompleteness?: EvidenceCompleteness;
  readonly factsComplete?: boolean;
  readonly complete?: boolean;
  readonly [key: string]: unknown;
}

export interface MachineCheckResult {
  readonly result: CertificationFinding;
  readonly checks: readonly CertificationCheck[];
  readonly evidence: AdmittedRepositoryEvidence;
}

interface MappingIndex {
  readonly byCanonId: ReadonlyMap<string, RepositoryMapping>;
  readonly ambiguousCanonIds: ReadonlySet<string>;
}

interface PathCheckContext {
  readonly evidence: AdmittedRepositoryEvidence;
  readonly mapping: RepositoryMapping;
}

interface FactCandidate {
  readonly fact: FactEnvelope;
  readonly ambiguity: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortChecks(checks: readonly CertificationCheck[]): readonly CertificationCheck[] {
  return Object.freeze([...checks].sort((left, right) => compareStrings(left.checkId, right.checkId)));
}

function aggregate(checks: readonly CertificationCheck[]): CertificationFinding {
  if (checks.some((check) => check.result === "mismatch")) return "mismatch";
  if (checks.some((check) => check.result === "unresolved")) return "unresolved";
  return "match";
}

function safeEntryKey(
  collection: Parameters<typeof createSemanticEntryKey>[0]["collection"],
  identity: string[],
): SemanticEntryKey | undefined {
  try {
    return createSemanticEntryKey({ collection, identity });
  } catch {
    return undefined;
  }
}

function check(
  checkId: string,
  result: CertificationFinding,
  detail: string,
  targetEntryKey?: SemanticEntryKey,
): CertificationCheck {
  return {
    checkId,
    ...(targetEntryKey === undefined ? {} : { targetEntryKey }),
    result,
    detail,
  };
}

function mappingIndex(document: ArchitectureDocumentV1): MappingIndex {
  const byCanonId = new Map<string, RepositoryMapping>();
  const ambiguous = new Set<string>();
  for (const mapping of document.repositoryMappings) {
    if (byCanonId.has(mapping.canonId)) {
      ambiguous.add(mapping.canonId);
      continue;
    }
    byCanonId.set(mapping.canonId, mapping);
  }
  return { byCanonId, ambiguousCanonIds: ambiguous };
}

function pathExists(evidence: AdmittedRepositoryEvidence, path: string, scope: "file" | "directory"): boolean {
  return evidence.treePaths.some((candidate) =>
    scope === "file" ? candidate === path : candidate === path || candidate.startsWith(`${path}/`),
  );
}

function pathCheck(context: PathCheckContext): CertificationCheck[] {
  const { evidence, mapping } = context;
  const checks: CertificationCheck[] = [];
  for (const pathMapping of mapping.paths) {
    const target = safeEntryKey("repository-mapping", [mapping.canonId, pathMapping.path, pathMapping.scope]);
    const id = `path:${mapping.canonId}:${pathMapping.path}:${pathMapping.scope}`;
    if (evidence.treeCompleteness !== "complete") {
      checks.push(check(id, "unresolved", `repository tree evidence is ${evidence.treeCompleteness}`, target));
    } else if (pathExists(evidence, pathMapping.path, pathMapping.scope)) {
      checks.push(check(id, "match", `required ${pathMapping.scope} exists in the repository tree`, target));
    } else {
      checks.push(check(id, "mismatch", `required ${pathMapping.scope} is absent from the repository tree`, target));
    }
  }
  return checks;
}

function factSourcePath(fact: FactEnvelope): string | undefined {
  if (fact.predicate !== "defines" || !isValueObject(fact.object)) return undefined;
  return fact.object.value;
}

function isValueObject(value: FactObject): value is { readonly value: string } {
  return "value" in value;
}

function factEntityIsAmbiguous(entity: FactEntityReference): boolean {
  return entity.correlationStatus === "ambiguous" || entity.candidateCanonicalIds.length > 1;
}

function factSubjectMatchesMapping(
  fact: FactEnvelope,
  mapping: RepositoryMapping,
  symbol: RepositorySymbolMapping,
): boolean {
  if (fact.predicate !== "defines") return false;
  const sourcePath = factSourcePath(fact);
  if (sourcePath !== symbol.path) return false;
  if (fact.subject.canonicalId === mapping.canonId) return true;
  if (fact.subject.path !== symbol.path) return false;

  // The TypeScript provider uses the compiler's fully-qualified symbol as the
  // normalized subject nativeId (for example,
  // `"/workspace/src/service".Service`). The repository mapping stores the
  // source-level symbol name, so compare the exact terminal identity while
  // retaining the exact mapped source path above. A canonicalId produced by
  // correlation is not the repository mapping's canonId and must not prevent
  // this provider-native match.
  const separator = fact.subject.nativeId.lastIndexOf(".");
  const providerSymbol = separator < 0 ? fact.subject.nativeId : fact.subject.nativeId.slice(separator + 1);
  return providerSymbol === symbol.symbol;
}

function symbolCandidates(
  facts: readonly FactEnvelope[],
  mapping: RepositoryMapping,
  symbol: RepositorySymbolMapping,
): readonly FactCandidate[] {
  const candidates: FactCandidate[] = [];
  for (const fact of facts) {
    if (!factSubjectMatchesMapping(fact, mapping, symbol)) continue;
    candidates.push({ fact, ambiguity: factEntityIsAmbiguous(fact.subject) });
  }
  return candidates;
}

function symbolCheck(evidence: AdmittedRepositoryEvidence, mapping: RepositoryMapping): CertificationCheck[] {
  const checks: CertificationCheck[] = [];
  for (const symbol of mapping.symbols) {
    const target = safeEntryKey("repository-mapping", [
      mapping.canonId,
      symbol.path,
      symbol.symbol,
      symbol.exportName ?? "",
    ]);
    const id = `symbol:${mapping.canonId}:${symbol.path}:${symbol.symbol}${symbol.exportName === undefined ? "" : `:${symbol.exportName}`}`;
    const candidates = symbolCandidates(evidence.facts, mapping, symbol);
    const unique = new Map<string, FactCandidate>();
    for (const candidate of candidates) unique.set(factEqualityKey(candidate.fact), candidate);
    const values = [...unique.values()];
    if (values.some((candidate) => candidate.ambiguity) || values.length > 1) {
      checks.push(check(id, "unresolved", "defines evidence is ambiguous for the mapped symbol", target));
    } else if (values.length === 1) {
      checks.push(check(id, "match", "an unambiguous defines fact proves the mapped symbol", target));
    } else if (evidence.factsCompleteness === "complete") {
      checks.push(check(id, "mismatch", "no defines fact proves the mapped symbol", target));
    } else {
      checks.push(check(id, "unresolved", "fact evidence is partial; absence cannot prove a missing symbol", target));
    }
  }
  return checks;
}

function factEndpointMatches(entity: FactEntityReference, canonId: string, mapping: RepositoryMapping): boolean {
  if (entity.canonicalId === canonId) return true;
  if (entity.canonicalId !== undefined || factEntityIsAmbiguous(entity)) return false;
  return mapping.paths.some((path) => entity.path === path.path);
}

function objectEndpointMatches(object: FactObject, canonId: string, mapping: RepositoryMapping): boolean {
  if (!("provider" in object)) return false;
  return factEndpointMatches(object, canonId, mapping);
}

function dependencyPredicates(constraint: ArchitectureConstraint): readonly string[] {
  if (constraint.kind !== "must-not-depend-on") return [];
  return SUPPORTED_FORBIDDEN_DEPENDENCY_PREDICATES;
}

function dependencyCheck(
  evidence: AdmittedRepositoryEvidence,
  constraint: Extract<ArchitectureConstraint, { readonly kind: "must-not-depend-on" }>,
  sourceMapping: RepositoryMapping,
  targetMapping: RepositoryMapping,
): CertificationCheck {
  const target = safeEntryKey("constraint", [constraint.kind, constraint.source, constraint.target]);
  const id = `forbidden-dependency:${constraint.source}:${constraint.target}`;
  const relevant = evidence.facts.filter((fact) => dependencyPredicates(constraint).includes(fact.predicate));
  const ambiguous = relevant.some(
    (fact) => factEntityIsAmbiguous(fact.subject) || ("provider" in fact.object && factEntityIsAmbiguous(fact.object)),
  );
  const observed = relevant.some(
    (fact) =>
      factEndpointMatches(fact.subject, constraint.source, sourceMapping) &&
      objectEndpointMatches(fact.object, constraint.target, targetMapping),
  );
  if (observed) {
    return check(id, "mismatch", "a provider fact observes a forbidden dependency edge", target);
  }
  if (ambiguous) {
    return check(id, "unresolved", "dependency evidence contains an ambiguous endpoint", target);
  }
  if (evidence.factsCompleteness !== "complete") {
    return check(id, "unresolved", "fact evidence is partial; absence cannot prove a forbidden edge is absent", target);
  }
  return check(id, "match", "complete fact evidence contains no forbidden dependency edge", target);
}

function codeIntentChecks(
  evidence: AdmittedRepositoryEvidence,
  mappings: MappingIndex,
  codeIntent: readonly CodeIntent[] | undefined,
  constraints: readonly ArchitectureConstraint[],
): CertificationCheck[] {
  if (codeIntent === undefined) return [];
  const checks: CertificationCheck[] = [];
  for (const intent of codeIntent) {
    const mapping = mappings.byCanonId.get(intent.ownerId);
    if (mapping === undefined || mappings.ambiguousCanonIds.has(intent.ownerId)) {
      checks.push(
        check(
          `code-intent:${intent.id}:owner`,
          "unresolved",
          "Code Intent owner has no unambiguous repository mapping",
        ),
      );
      continue;
    }
    for (const obligation of intent.verificationObligations) {
      const target = safeEntryKey("code-intent", [intent.id, obligation.id]);
      const mode = typeof obligation.mode === "string" ? obligation.mode.trim().toLowerCase() : "";
      const predicate = typeof obligation.predicate === "string" ? obligation.predicate.trim().toLowerCase() : "";

      // Review obligations require human review and must never be admitted as
      // machine evidence. Predicate selection is deliberately independent of
      // mode: mode only determines whether this machine checker may handle it.
      if (mode !== "machine") {
        checks.push(
          check(
            `code-intent:${intent.id}:${obligation.id}`,
            "unresolved",
            mode === "review"
              ? "Code Intent review obligation is not machine-checkable"
              : "unsupported Code Intent verification mode",
            target,
          ),
        );
        continue;
      }

      if (predicate === "path-exists" || predicate === "path" || predicate === "repository-path") {
        const results = pathCheck({ evidence, mapping });
        if (results.length === 0) {
          checks.push(
            check(
              `code-intent:${intent.id}:${obligation.id}`,
              "unresolved",
              "Code Intent path obligation has no mapped path",
              target,
            ),
          );
        } else {
          checks.push(
            check(
              `code-intent:${intent.id}:${obligation.id}`,
              aggregate(results),
              `Code Intent path obligation: ${results.map((result) => result.result).join(", ")}`,
              target,
            ),
          );
        }
      } else if (predicate === "defines" || predicate === "symbol-exists" || predicate === "symbol") {
        const results = symbolCheck(evidence, mapping);
        if (results.length === 0) {
          checks.push(
            check(
              `code-intent:${intent.id}:${obligation.id}`,
              "unresolved",
              "Code Intent symbol obligation has no mapped symbol",
              target,
            ),
          );
        } else {
          checks.push(
            check(
              `code-intent:${intent.id}:${obligation.id}`,
              aggregate(results),
              `Code Intent symbol obligation: ${results.map((result) => result.result).join(", ")}`,
              target,
            ),
          );
        }
      } else if (predicate === "must-not-depend-on") {
        const dependencyResults = constraints
          .filter(
            (constraint): constraint is Extract<ArchitectureConstraint, { readonly kind: "must-not-depend-on" }> =>
              constraint.kind === "must-not-depend-on" && constraint.source === intent.ownerId,
          )
          .map((constraint) => {
            const source = mappings.byCanonId.get(constraint.source);
            const targetMapping = mappings.byCanonId.get(constraint.target);
            if (
              source === undefined ||
              targetMapping === undefined ||
              mappings.ambiguousCanonIds.has(constraint.source) ||
              mappings.ambiguousCanonIds.has(constraint.target)
            ) {
              return check(
                `forbidden-dependency:${constraint.source}:${constraint.target}`,
                "unresolved",
                "forbidden dependency has no unambiguous source and target repository mapping",
                safeEntryKey("constraint", [constraint.kind, constraint.source, constraint.target]),
              );
            }
            return dependencyCheck(evidence, constraint, source, targetMapping);
          });
        checks.push(
          check(
            `code-intent:${intent.id}:${obligation.id}`,
            dependencyResults.length === 0 ? "unresolved" : aggregate(dependencyResults),
            dependencyResults.length === 0
              ? "Code Intent forbidden-dependency obligation has no mapped constraint"
              : `Code Intent forbidden-dependency obligation: ${dependencyResults.map((result) => result.result).join(", ")}`,
            target,
          ),
        );
      } else {
        checks.push(
          check(
            `code-intent:${intent.id}:${obligation.id}`,
            "unresolved",
            `unsupported verification predicate: ${obligation.predicate}`,
            target,
          ),
        );
      }
    }
  }
  return checks;
}

function evidenceInput(input: Record<string, unknown>, evidence: unknown): AdmittedRepositoryEvidence {
  const candidate = asRecord(evidence);
  if (candidate !== undefined) {
    return admitRepositoryEvidence({
      ...candidate,
      expectedRepository: candidate.expectedRepository ?? input.expectedRepository ?? input.repository,
    });
  }
  return admitRepositoryEvidence({
    ...input,
    expectedRepository: input.expectedRepository ?? input.repository,
  });
}

/**
 * Run the bounded, repository-backed checks that can be proven without
 * generating a Provider Matrix. Every absence check requires complete
 * evidence; partial or ambiguous observations remain unresolved.
 */
export function runMachineChecks(input: MachineCheckInput | unknown): MachineCheckResult {
  const inputRecord = asRecord(input) ?? {};
  const document = (inputRecord.document ?? inputRecord.canon) as ArchitectureDocumentV1 | undefined;
  const evidence = evidenceInput(inputRecord, inputRecord.evidence);
  const checks: CertificationCheck[] = [];

  if (document === undefined || !Array.isArray(document.repositoryMappings) || !Array.isArray(document.constraints)) {
    checks.push(check("canon-validity", "unresolved", "Architecture Canon document is missing or malformed"));
    return { result: aggregate(checks), checks: sortChecks(checks), evidence };
  }

  if (evidence.accepted && evidence.repository !== undefined) {
    checks.push(
      check(
        "evidence-admission",
        "match",
        "all supplied FactEnvelope records are bound to the requested revision and provider",
      ),
    );
  } else if (
    evidence.rejectedFacts.some(
      (rejection) => rejection.reason === "repository-mismatch" || rejection.reason === "provider-mismatch",
    )
  ) {
    checks.push(
      check(
        "evidence-admission",
        "mismatch",
        "one or more FactEnvelope records were rejected as stale or provider-mismatched",
      ),
    );
  } else {
    checks.push(
      check("evidence-admission", "unresolved", evidence.reasons.join("; ") || "evidence admission is incomplete"),
    );
  }

  const mappings = mappingIndex(document);
  for (const mapping of document.repositoryMappings) {
    checks.push(...pathCheck({ evidence, mapping }));
    checks.push(...symbolCheck(evidence, mapping));
  }

  for (const constraint of document.constraints) {
    if (constraint.kind !== "must-not-depend-on") continue;
    const source = mappings.byCanonId.get(constraint.source);
    const target = mappings.byCanonId.get(constraint.target);
    if (
      source === undefined ||
      target === undefined ||
      mappings.ambiguousCanonIds.has(constraint.source) ||
      mappings.ambiguousCanonIds.has(constraint.target)
    ) {
      checks.push(
        check(
          `forbidden-dependency:${constraint.source}:${constraint.target}`,
          "unresolved",
          "forbidden dependency has no unambiguous source and target repository mapping",
          safeEntryKey("constraint", [constraint.kind, constraint.source, constraint.target]),
        ),
      );
    } else {
      checks.push(dependencyCheck(evidence, constraint, source, target));
    }
  }

  checks.push(
    ...codeIntentChecks(
      evidence,
      mappings,
      inputRecord.codeIntent as readonly CodeIntent[] | undefined,
      document.constraints,
    ),
  );
  const ordered = sortChecks(checks);
  return { result: aggregate(ordered), checks: ordered, evidence };
}

/** Alias matching the terminology used by certification callers. */
export const evaluateMachineChecks = runMachineChecks;
