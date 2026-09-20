import {
  createRepositoryMapping,
  normalizeRepositoryPath,
  type RepositoryMapping,
  type RepositoryMappingInput,
} from "../architecture/canon/repository-mappings.js";
import type { CanonicalEntity, CanonicalEntityMember, CorrelationResult } from "../runtime/correlation.js";
import type { ResolvedRepository } from "../runtime/provider.js";
import type { RepositoryIdentity, WorkingSetEvidenceReference, WorkingSetTarget } from "./model.js";

/** Version of the bounded task and entrypoint seed contract. */
export const WORKING_SET_SEED_SCHEMA_VERSION = 1 as const;
export type WorkingSetSeedSchemaVersion = typeof WORKING_SET_SEED_SCHEMA_VERSION;

export const WORKING_SET_SEED_KIND = "working-set-seeds" as const;
export const WORKING_SET_SEED_RESOLUTION_KIND = "working-set-seed-resolution" as const;

export const WORKING_SET_SEED_KINDS = ["path", "symbol-export", "architecture-component"] as const;
export type WorkingSetSeedKind = (typeof WORKING_SET_SEED_KINDS)[number];

/** V1 intent metadata is an identifier, not a task description or authority. */
export const WORKING_SET_TASK_INTENTS = ["implement", "investigate", "verify"] as const;
export type WorkingSetTaskIntent = (typeof WORKING_SET_TASK_INTENTS)[number];

export const WORKING_SET_SEED_LIMITS = Object.freeze({
  maxSeeds: 128,
  maxTaskIdLength: 128,
  maxRepositoryFieldLength: 256,
  maxRevisionLength: 64,
  maxPathLength: 1024,
  maxSymbolLength: 512,
  maxExportNameLength: 512,
  maxComponentIdLength: 512,
  maxResolutionCandidates: 64,
  maxResolutionEvidence: 64,
});

export interface WorkingSetTaskMetadata {
  /** Stable caller-owned task identity; it carries no execution authority. */
  readonly taskId: string;
  readonly intent: WorkingSetTaskIntent;
}

export interface WorkingSetPathSeed {
  readonly kind: "path";
  readonly path: string;
}

export interface WorkingSetSymbolExportSeed {
  readonly kind: "symbol-export";
  readonly path: string;
  readonly symbol: string;
  readonly exportName?: string;
}

export interface WorkingSetArchitectureComponentSeed {
  readonly kind: "architecture-component";
  readonly componentId: string;
}

export type WorkingSetSeed = WorkingSetPathSeed | WorkingSetSymbolExportSeed | WorkingSetArchitectureComponentSeed;

export interface WorkingSetPathSeedInput {
  readonly kind: "path";
  readonly path: string;
}

export interface WorkingSetSymbolExportSeedInput {
  readonly kind: "symbol-export";
  readonly path: string;
  readonly symbol: string;
  readonly exportName?: string;
}

export interface WorkingSetArchitectureComponentSeedInput {
  readonly kind: "architecture-component";
  readonly componentId: string;
}

export type WorkingSetSeedInput =
  WorkingSetPathSeedInput | WorkingSetSymbolExportSeedInput | WorkingSetArchitectureComponentSeedInput;

export interface WorkingSetSeedDocument {
  readonly kind: typeof WORKING_SET_SEED_KIND;
  readonly schemaVersion: WorkingSetSeedSchemaVersion;
  readonly task: WorkingSetTaskMetadata;
  readonly repository: RepositoryIdentity;
  /** Full immutable revision identifier; mutable refs are rejected. */
  readonly revision: string;
  readonly seeds: readonly WorkingSetSeed[];
}

export interface WorkingSetSeedDocumentInput {
  readonly kind?: typeof WORKING_SET_SEED_KIND;
  readonly schemaVersion?: WorkingSetSeedSchemaVersion;
  readonly task: WorkingSetTaskMetadata;
  readonly repository: RepositoryIdentity;
  readonly revision: string;
  readonly seeds: readonly WorkingSetSeedInput[];
}

export type WorkingSetSeedResolutionStatus = "resolved" | "unresolved";
export type WorkingSetSeedUnresolvedReason = "repository-mismatch" | "missing" | "ambiguous";

export interface WorkingSetSeedResolutionContext {
  /** Identity and revision that the analysis run has explicitly pinned. */
  readonly repository: RepositoryIdentity;
  readonly revision: string;
  /** Existing Canon repository mappings; no mapping is inferred from a seed. */
  readonly repositoryMappings?: readonly (RepositoryMapping | RepositoryMappingInput)[];
  /** Existing provider correlation evidence; no provider scan is started here. */
  readonly correlation?: CorrelationResult;
  /** Optional runtime source form when correlation evidence uses a URL/path. */
  readonly resolvedRepository?: ResolvedRepository;
}

export interface WorkingSetSeedTarget extends WorkingSetTarget {
  readonly kind: "file" | "symbol" | "test";
}

export interface ResolvedWorkingSetSeed {
  readonly status: "resolved";
  readonly seed: WorkingSetSeed;
  readonly targets: readonly WorkingSetSeedTarget[];
  readonly evidence: readonly WorkingSetEvidenceReference[];
}

export interface UnresolvedWorkingSetSeed {
  readonly status: "unresolved";
  readonly seed: WorkingSetSeed;
  readonly reason: WorkingSetSeedUnresolvedReason;
  /** Candidate IDs or locators are retained only when bounded evidence exists. */
  readonly candidates: readonly string[];
  readonly evidence: readonly WorkingSetEvidenceReference[];
}

export type WorkingSetSeedResolution = ResolvedWorkingSetSeed | UnresolvedWorkingSetSeed;

export interface WorkingSetSeedResolutionResult {
  readonly kind: typeof WORKING_SET_SEED_RESOLUTION_KIND;
  readonly schemaVersion: WorkingSetSeedSchemaVersion;
  readonly task: WorkingSetTaskMetadata;
  readonly repository: RepositoryIdentity;
  readonly revision: string;
  readonly binding: "matched" | "mismatch";
  readonly resolutions: readonly WorkingSetSeedResolution[];
}

const seedKindOrder: Readonly<Record<WorkingSetSeedKind, number>> = Object.freeze({
  path: 0,
  "symbol-export": 1,
  "architecture-component": 2,
});

const targetKindOrder: Readonly<Record<WorkingSetSeedTarget["kind"], number>> = Object.freeze({
  file: 0,
  symbol: 1,
  test: 2,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field: ${key}`);
  }
}

function normalizeIdentifier(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)
  ) {
    throw new TypeError(`${label} is malformed or exceeds its bound`);
  }
  return normalized;
}

function normalizeRepositoryField(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > WORKING_SET_SEED_LIMITS.maxRepositoryFieldLength ||
    /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)
  ) {
    throw new TypeError(`${label} is malformed or exceeds its bound`);
  }
  return normalized;
}

function normalizeRevision(value: unknown): string {
  const revision = normalizeIdentifier(value, "revision", WORKING_SET_SEED_LIMITS.maxRevisionLength);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(revision)) {
    throw new TypeError("revision must be a full immutable hexadecimal revision");
  }
  return revision.toLowerCase();
}

function normalizeRepository(value: unknown): RepositoryIdentity {
  if (!isRecord(value)) throw new TypeError("repository must be an object");
  assertAllowedKeys(value, ["repositoryHost", "repositoryId", "repository"], "repository");
  return Object.freeze({
    repositoryHost: normalizeRepositoryField(value.repositoryHost, "repository repositoryHost"),
    repositoryId: normalizeRepositoryField(value.repositoryId, "repository repositoryId"),
    repository: normalizeRepositoryField(value.repository, "repository repository"),
  });
}

function normalizeTask(value: unknown): WorkingSetTaskMetadata {
  if (!isRecord(value)) throw new TypeError("task must be an object");
  assertAllowedKeys(value, ["taskId", "intent"], "task");
  if (!WORKING_SET_TASK_INTENTS.includes(value.intent as WorkingSetTaskIntent)) {
    throw new TypeError("task intent is unsupported");
  }
  return Object.freeze({
    taskId: normalizeIdentifier(value.taskId, "task taskId", WORKING_SET_SEED_LIMITS.maxTaskIdLength),
    intent: value.intent as WorkingSetTaskIntent,
  });
}

function normalizeSeedPath(value: unknown): string {
  if (typeof value !== "string" || value.length > WORKING_SET_SEED_LIMITS.maxPathLength) {
    throw new TypeError("seed path is malformed or exceeds its bound");
  }
  return normalizeRepositoryPath(value);
}

function normalizeSeed(value: unknown): WorkingSetSeed {
  if (!isRecord(value)) throw new TypeError("working-set seed must be an object");
  if (!WORKING_SET_SEED_KINDS.includes(value.kind as WorkingSetSeedKind)) {
    throw new TypeError("working-set seed kind is unsupported");
  }

  switch (value.kind as WorkingSetSeedKind) {
    case "path":
      assertAllowedKeys(value, ["kind", "path"], "path seed");
      return Object.freeze({ kind: "path", path: normalizeSeedPath(value.path) });
    case "symbol-export":
      assertAllowedKeys(value, ["kind", "path", "symbol", "exportName"], "symbol-export seed");
      return Object.freeze({
        kind: "symbol-export",
        path: normalizeSeedPath(value.path),
        symbol: normalizeIdentifier(value.symbol, "symbol-export seed symbol", WORKING_SET_SEED_LIMITS.maxSymbolLength),
        ...(value.exportName === undefined
          ? {}
          : {
              exportName: normalizeIdentifier(
                value.exportName,
                "symbol-export seed exportName",
                WORKING_SET_SEED_LIMITS.maxExportNameLength,
              ),
            }),
      });
    case "architecture-component":
      assertAllowedKeys(value, ["kind", "componentId"], "architecture-component seed");
      return Object.freeze({
        kind: "architecture-component",
        componentId: normalizeIdentifier(
          value.componentId,
          "architecture-component seed componentId",
          WORKING_SET_SEED_LIMITS.maxComponentIdLength,
        ),
      });
  }
}

function compareSeeds(left: WorkingSetSeed, right: WorkingSetSeed): number {
  const kind = seedKindOrder[left.kind] - seedKindOrder[right.kind];
  if (kind !== 0) return kind;
  if (left.kind === "path" && right.kind === "path") return left.path.localeCompare(right.path);
  if (left.kind === "architecture-component" && right.kind === "architecture-component") {
    return left.componentId.localeCompare(right.componentId);
  }
  if (left.kind !== "symbol-export" || right.kind !== "symbol-export") return 0;
  return (
    left.path.localeCompare(right.path) ||
    left.symbol.localeCompare(right.symbol) ||
    (left.exportName ?? "").localeCompare(right.exportName ?? "")
  );
}

function seedKey(seed: WorkingSetSeed): string {
  if (seed.kind === "path") return `path\u0000${seed.path}`;
  if (seed.kind === "architecture-component") return `architecture-component\u0000${seed.componentId}`;
  return `symbol-export\u0000${seed.path}\u0000${seed.symbol}\u0000${seed.exportName ?? ""}`;
}

function normalizeInput(input: unknown, requireVersion: boolean): WorkingSetSeedDocument {
  if (!isRecord(input)) throw new TypeError("working-set seed document must be an object");
  assertAllowedKeys(
    input,
    ["kind", "schemaVersion", "task", "repository", "revision", "seeds"],
    "working-set seed document",
  );
  if (input.kind !== undefined && input.kind !== WORKING_SET_SEED_KIND) {
    throw new TypeError("working-set seed document kind is unsupported");
  }
  if (requireVersion && input.schemaVersion !== WORKING_SET_SEED_SCHEMA_VERSION) {
    throw new TypeError("working-set seed schema version is unsupported");
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== WORKING_SET_SEED_SCHEMA_VERSION) {
    throw new TypeError("working-set seed schema version is unsupported");
  }
  if (!Array.isArray(input.seeds)) throw new TypeError("working-set seeds must be an array");
  if (input.seeds.length > WORKING_SET_SEED_LIMITS.maxSeeds) {
    throw new TypeError("working-set seeds exceed their bound");
  }

  const unique = new Map<string, WorkingSetSeed>();
  for (const value of input.seeds) {
    const seed = normalizeSeed(value);
    unique.set(seedKey(seed), seed);
  }
  const seeds = [...unique.values()].sort(compareSeeds);
  return Object.freeze({
    kind: WORKING_SET_SEED_KIND,
    schemaVersion: WORKING_SET_SEED_SCHEMA_VERSION,
    task: normalizeTask(input.task),
    repository: normalizeRepository(input.repository),
    revision: normalizeRevision(input.revision),
    seeds: Object.freeze(seeds),
  });
}

/** Creates and canonicalizes a bounded structured task/seed document. */
export function createWorkingSetSeeds(input: WorkingSetSeedDocumentInput): WorkingSetSeedDocument {
  return normalizeInput(input, false);
}

/** Validates a serialized-shape seed document before semantic use. */
export function validateWorkingSetSeeds(input: unknown): WorkingSetSeedDocument {
  return normalizeInput(input, true);
}

function canonicalDocument(document: WorkingSetSeedDocument): WorkingSetSeedDocument {
  return {
    kind: WORKING_SET_SEED_KIND,
    schemaVersion: WORKING_SET_SEED_SCHEMA_VERSION,
    task: { taskId: document.task.taskId, intent: document.task.intent },
    repository: {
      repositoryHost: document.repository.repositoryHost,
      repositoryId: document.repository.repositoryId,
      repository: document.repository.repository,
    },
    revision: document.revision,
    seeds: document.seeds.map((seed) => {
      if (seed.kind === "path") return { kind: "path", path: seed.path };
      if (seed.kind === "architecture-component") {
        return { kind: "architecture-component", componentId: seed.componentId };
      }
      return {
        kind: "symbol-export",
        path: seed.path,
        symbol: seed.symbol,
        ...(seed.exportName === undefined ? {} : { exportName: seed.exportName }),
      };
    }),
  };
}

/** Deterministic JSON serialization of the bounded seed contract. */
export function serializeWorkingSetSeeds(input: WorkingSetSeedDocumentInput | WorkingSetSeedDocument): string {
  const document = validateWorkingSetSeeds({ ...createWorkingSetSeeds(input), schemaVersion: 1 });
  return JSON.stringify(canonicalDocument(document));
}

/** Parses JSON and rejects malformed or unsupported seed documents. */
export function parseWorkingSetSeeds(serialized: string): WorkingSetSeedDocument {
  if (typeof serialized !== "string") throw new TypeError("working-set seed serialization must be a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("working-set seed serialization is malformed");
  }
  return validateWorkingSetSeeds(parsed);
}

export const decodeWorkingSetSeeds = parseWorkingSetSeeds;

function compareEvidence(left: WorkingSetEvidenceReference, right: WorkingSetEvidenceReference): number {
  return left.artifact.localeCompare(right.artifact) || left.reference.localeCompare(right.reference);
}

function canonicalEvidence(references: readonly WorkingSetEvidenceReference[]): readonly WorkingSetEvidenceReference[] {
  const unique = new Map<string, WorkingSetEvidenceReference>();
  for (const reference of references) unique.set(`${reference.artifact}\u0000${reference.reference}`, reference);
  return Object.freeze(
    [...unique.values()]
      .sort(compareEvidence)
      .slice(0, WORKING_SET_SEED_LIMITS.maxResolutionEvidence)
      .map((reference) => Object.freeze({ artifact: reference.artifact, reference: reference.reference })),
  );
}

function compareTargets(left: WorkingSetSeedTarget, right: WorkingSetSeedTarget): number {
  return targetKindOrder[left.kind] - targetKindOrder[right.kind] || left.locator.localeCompare(right.locator);
}

function canonicalTargets(targets: readonly WorkingSetSeedTarget[]): readonly WorkingSetSeedTarget[] {
  const unique = new Map<string, WorkingSetSeedTarget>();
  for (const target of targets) unique.set(`${target.kind}\u0000${target.locator}`, target);
  return Object.freeze(
    [...unique.values()]
      .sort(compareTargets)
      .map((target) => Object.freeze({ kind: target.kind, locator: target.locator })),
  );
}

function unresolved(
  seed: WorkingSetSeed,
  reason: WorkingSetSeedUnresolvedReason,
  candidates: readonly string[] = [],
  evidence: readonly WorkingSetEvidenceReference[] = [],
): UnresolvedWorkingSetSeed {
  return Object.freeze({
    status: "unresolved",
    seed,
    reason,
    candidates: Object.freeze(
      [...new Set(candidates)].sort().slice(0, WORKING_SET_SEED_LIMITS.maxResolutionCandidates),
    ),
    evidence: canonicalEvidence(evidence),
  });
}

function resolved(
  seed: WorkingSetSeed,
  targets: readonly WorkingSetSeedTarget[],
  evidence: readonly WorkingSetEvidenceReference[],
): ResolvedWorkingSetSeed | UnresolvedWorkingSetSeed {
  const canonical = canonicalTargets(targets);
  return canonical.length === 0
    ? unresolved(seed, "missing", [], evidence)
    : Object.freeze({
        status: "resolved",
        seed,
        targets: canonical,
        evidence: canonicalEvidence(evidence),
      });
}

function compareRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return (
    left.repositoryHost === right.repositoryHost &&
    left.repositoryId === right.repositoryId &&
    left.repository === right.repository
  );
}

function normalizeContext(context: WorkingSetSeedResolutionContext): {
  repository: RepositoryIdentity;
  revision: string;
  source: string;
  valid: boolean;
} {
  const repository = normalizeRepository(context.repository);
  const revision = normalizeRevision(context.revision);
  const resolvedRepository = context.resolvedRepository;
  if (resolvedRepository === undefined) {
    return { repository, revision, source: repository.repository, valid: true };
  }
  if (typeof resolvedRepository.source !== "string" || resolvedRepository.source.length === 0) {
    throw new TypeError("resolved repository source is malformed");
  }
  const resolvedRevision = normalizeRevision(resolvedRepository.commitSha);
  return {
    repository,
    revision,
    source: resolvedRepository.source,
    valid: resolvedRevision === revision,
  };
}

function normalizedMappings(
  inputs: readonly (RepositoryMapping | RepositoryMappingInput)[] | undefined,
): readonly RepositoryMapping[] {
  if (inputs === undefined) return [];
  if (!Array.isArray(inputs)) throw new TypeError("repository mappings must be an array");
  return Object.freeze(
    inputs
      .map((input) => createRepositoryMapping(input))
      .sort(
        (left, right) =>
          left.canonId.localeCompare(right.canonId) || JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
  );
}

function mappingEvidence(mapping: RepositoryMapping, kind: string, locator: string): WorkingSetEvidenceReference {
  return { artifact: "canon", reference: `${mapping.canonId}:${kind}:${locator}` };
}

function symbolLocator(path: string, symbol: string, exportName: string | undefined): string {
  return `${path}#${symbol}${exportName === undefined ? "" : `@${exportName}`}`;
}

function testLocator(path: string, selector: string): string {
  return `${path}#${selector}`;
}

function entityMatchesBinding(entity: CanonicalEntity, source: string, revision: string): boolean {
  return entity.repository.source === source && entity.repository.commitSha.toLowerCase() === revision;
}

function memberMatchesSymbol(member: CanonicalEntityMember, seed: WorkingSetSymbolExportSeed): boolean {
  const symbolValues = [member.nativeId, member.name, member.qualifiedName, ...member.aliases].filter(
    (value): value is string => value !== undefined,
  );
  if (!symbolValues.includes(seed.symbol)) return false;
  if (seed.exportName === undefined) return true;
  return symbolValues.includes(seed.exportName);
}

function resolvePathSeed(seed: WorkingSetPathSeed, mappings: readonly RepositoryMapping[]): WorkingSetSeedResolution {
  const evidence: WorkingSetEvidenceReference[] = [{ artifact: "repository-binding", reference: `path:${seed.path}` }];
  for (const mapping of mappings) {
    for (const path of mapping.paths) {
      if (path.path === seed.path) evidence.push(mappingEvidence(mapping, "path", path.path));
    }
  }
  return resolved(seed, [{ kind: "file", locator: seed.path }], evidence);
}

function resolveSymbolSeed(
  seed: WorkingSetSymbolExportSeed,
  mappings: readonly RepositoryMapping[],
  correlation: CorrelationResult | undefined,
  source: string,
  revision: string,
): WorkingSetSeedResolution {
  const mappingMatches = mappings.flatMap((mapping) =>
    mapping.symbols
      .filter(
        (symbol) =>
          symbol.path === seed.path &&
          symbol.symbol === seed.symbol &&
          (symbol.exportName ?? "") === (seed.exportName ?? ""),
      )
      .map((symbol) => ({ mapping, symbol })),
  );
  const evidence: WorkingSetEvidenceReference[] = mappingMatches.map(({ mapping, symbol }) =>
    mappingEvidence(mapping, "symbol", symbolLocator(symbol.path, symbol.symbol, symbol.exportName)),
  );
  const candidates = new Map<string, CanonicalEntity>();
  for (const entity of correlation?.canonicalEntities ?? []) {
    if (!entityMatchesBinding(entity, source, revision)) continue;
    if (entity.members.some((member) => member.path === seed.path && memberMatchesSymbol(member, seed))) {
      candidates.set(entity.canonicalId, entity);
    }
  }
  const candidateIds = [...candidates.keys()].sort();
  for (const canonicalId of candidateIds) {
    evidence.push({ artifact: "provider-correlation", reference: canonicalId });
  }

  const hasAmbiguousEntity = [...candidates.values()].some(
    (entity) => entity.status === "ambiguous" || entity.candidateCanonicalIds.length > 0,
  );
  if (mappingMatches.length > 1 || candidateIds.length > 1 || hasAmbiguousEntity) {
    return unresolved(seed, "ambiguous", candidateIds, evidence);
  }
  if (mappingMatches.length === 0 && candidateIds.length === 0) return unresolved(seed, "missing");
  const exportName = seed.exportName ?? mappingMatches[0]?.symbol.exportName;
  return resolved(seed, [{ kind: "symbol", locator: symbolLocator(seed.path, seed.symbol, exportName) }], evidence);
}

function resolveComponentSeed(
  seed: WorkingSetArchitectureComponentSeed,
  mappings: readonly RepositoryMapping[],
): WorkingSetSeedResolution {
  const matches = mappings.filter((mapping) => mapping.canonId === seed.componentId);
  const evidence: WorkingSetEvidenceReference[] = matches.map((mapping) => ({
    artifact: "canon",
    reference: mapping.canonId,
  }));
  if (matches.length === 0) return unresolved(seed, "missing");
  if (matches.length > 1)
    return unresolved(
      seed,
      "ambiguous",
      matches.map((mapping) => mapping.canonId),
      evidence,
    );

  const [mapping] = matches;
  const targets: WorkingSetSeedTarget[] = [
    ...mapping.paths.map((path) => ({ kind: "file" as const, locator: path.path })),
    ...mapping.symbols.map((symbol) => ({
      kind: "symbol" as const,
      locator: symbolLocator(symbol.path, symbol.symbol, symbol.exportName),
    })),
    ...mapping.tests.map((test) => ({ kind: "test" as const, locator: testLocator(test.path, test.selector) })),
  ];
  return resolved(
    seed,
    targets,
    evidence.concat(
      mapping.paths.map((path) => mappingEvidence(mapping, "path", path.path)),
      mapping.symbols.map((symbol) =>
        mappingEvidence(mapping, "symbol", symbolLocator(symbol.path, symbol.symbol, symbol.exportName)),
      ),
      mapping.tests.map((test) => mappingEvidence(mapping, "test", testLocator(test.path, test.selector))),
    ),
  );
}

function resolveSeed(
  seed: WorkingSetSeed,
  mappings: readonly RepositoryMapping[],
  context: { source: string; revision: string },
  correlation: CorrelationResult | undefined,
): WorkingSetSeedResolution {
  if (seed.kind === "path") return resolvePathSeed(seed, mappings);
  if (seed.kind === "symbol-export") {
    return resolveSymbolSeed(seed, mappings, correlation, context.source, context.revision);
  }
  return resolveComponentSeed(seed, mappings);
}

/**
 * Resolves only the supplied bounded seeds against the pinned repository,
 * existing Canon mappings, and supplied correlation evidence. It never scans
 * the repository or treats seed metadata as execution authority.
 */
export function resolveWorkingSetSeeds(
  input: WorkingSetSeedDocumentInput | WorkingSetSeedDocument,
  context: WorkingSetSeedResolutionContext,
): WorkingSetSeedResolutionResult {
  const document = createWorkingSetSeeds(input);
  const normalizedContext = normalizeContext(context);
  const mappings = normalizedMappings(context.repositoryMappings);
  const binding =
    normalizedContext.valid &&
    compareRepository(document.repository, normalizedContext.repository) &&
    document.revision === normalizedContext.revision;
  const resolutions = document.seeds.map((seed) =>
    binding
      ? resolveSeed(
          seed,
          mappings,
          { source: normalizedContext.source, revision: normalizedContext.revision },
          context.correlation,
        )
      : unresolved(seed, "repository-mismatch"),
  );
  return Object.freeze({
    kind: WORKING_SET_SEED_RESOLUTION_KIND,
    schemaVersion: WORKING_SET_SEED_SCHEMA_VERSION,
    task: document.task,
    repository: document.repository,
    revision: document.revision,
    binding: binding ? "matched" : "mismatch",
    resolutions: Object.freeze(resolutions),
  });
}

/** Resolves one already-canonical seed with the same bounded rules. */
export function resolveWorkingSetSeed(
  seed: WorkingSetSeedInput,
  context: WorkingSetSeedResolutionContext,
): WorkingSetSeedResolution {
  const document = createWorkingSetSeeds({
    task: { taskId: "single-seed", intent: "investigate" },
    repository: context.repository,
    revision: context.revision,
    seeds: [seed],
  });
  return resolveWorkingSetSeeds(document, context).resolutions[0] ?? unresolved(document.seeds[0], "missing");
}
