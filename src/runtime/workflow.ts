import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline as pipelineCallback } from "node:stream";
import { createGzip } from "node:zlib";
import { promisify } from "node:util";
import {
  FACT_SCHEMA_VERSION,
  normalizeFacts,
  validateObservationEnvelope,
  type FactObservation,
  type FactNormalizationResult,
} from "./facts.js";
import {
  buildProviderMatrix,
  writeNormalizedFactsArtifact,
  writeProviderMatrixArtifacts,
  type ProviderMatrix,
  type ProviderMatrixArtifactPaths,
} from "./matrix.js";
import type { CorrelationResult } from "./correlation.js";
import { OBSERVATION_SCHEMA_VERSION } from "./observation.js";
import type { Provider, ProviderIdentity } from "./provider.js";
import type { ManifestProviderEntry, RunManifest } from "./manifest.js";
import { writeManifest } from "./manifest.js";
import { run, type RunResult } from "./run.js";

const pipeline = promisify(pipelineCallback);

export const MATRIX_WORKFLOW_SCHEMA_VERSION = 1 as const;

export interface MatrixWorkflowOptions {
  readonly source: string;
  /** A full, explicit commit SHA; symbolic refs are deliberately rejected. */
  readonly revision: string;
  readonly runRoot: string;
  readonly providers: readonly Provider[];
  readonly additionOrder?: readonly ProviderIdentity[];
}

export interface MatrixWorkflowResult extends RunResult {
  readonly observationPath: string;
  readonly normalizedFactsPath: string;
  readonly correlationPath: string;
  readonly matrix: ProviderMatrix;
  readonly matrixPaths: ProviderMatrixArtifactPaths;
}

/**
 * Executes providers once, then builds every downstream artifact exclusively
 * from the persisted observation/fact artifacts. No model or provider is
 * consulted during matrix generation.
 */
export async function runProviderMatrix(options: MatrixWorkflowOptions): Promise<MatrixWorkflowResult> {
  assertCommitSha(options.revision);
  const runRoot = path.resolve(options.runRoot);
  const providerIdentities = options.providers.map((provider) => provider.identity);
  const additionOrder = options.additionOrder ?? providerIdentities;
  await mkdir(runRoot, { recursive: true });
  await writeJson(path.join(runRoot, "config.json"), {
    schemaVersion: MATRIX_WORKFLOW_SCHEMA_VERSION,
    command: "matrix",
    source: options.source,
    revision: options.revision.toLowerCase(),
    nodeOptions: process.env.NODE_OPTIONS ?? "default",
    providers: providerIdentities.map((provider) => provider.id),
    additionOrder: additionOrder.map((provider) => provider.id),
  });

  const runResult = await run({
    source: options.source,
    revision: options.revision.toLowerCase(),
    runRoot,
    providers: options.providers,
  });
  if (runResult.manifest.repository.commitSha !== options.revision.toLowerCase()) {
    throw new Error(
      `resolved commit ${runResult.manifest.repository.commitSha} does not equal requested SHA ${options.revision}`,
    );
  }

  const observations = await readObservationArtifacts(runRoot, runResult);
  const observationPath = path.join(runRoot, "normalized", "observations.json");
  await writeJson(observationPath, {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    repository: runResult.manifest.repository,
    observations,
  });

  const normalized = normalizeFacts(observations, {
    providers: runResult.manifest.providers.map((entry) => entry.identity),
    includeComparisons: false,
  });
  const normalizedFactsPath = path.join(runRoot, "normalized", "facts.json");
  await writeNormalizedFactsArtifact(normalizedFactsPath, normalized);

  const correlationPath = path.join(runRoot, "normalized", "correlation.json");
  await writeJson(correlationPath, {
    schemaVersion: 1,
    inputFactSchemaVersion: FACT_SCHEMA_VERSION,
    repository: runResult.manifest.repository,
    providers: runResult.manifest.providers.map((entry) => entry.identity),
    correlation: normalized.correlation,
  });

  const matrix = buildProviderMatrix(normalized, {
    providers: runResult.manifest.providers.map((entry) => entry.identity),
    additionOrder,
  });
  const matrixPaths = await writeProviderMatrixArtifacts(runRoot, matrix);
  const retainedManifest = await retainRawProviderArtifacts(runRoot, runResult.manifest);
  await writeManifest(runRoot, retainedManifest);
  return {
    ...runResult,
    manifest: retainedManifest,
    observationPath,
    normalizedFactsPath,
    correlationPath,
    matrix,
    matrixPaths,
  };
}

/**
 * Raw provider output can exceed ordinary repository file limits. gzip is
 * lossless, keeps the original relative path in the suffix, and is recorded
 * in the manifest rather than silently replacing evidence.
 */
async function retainRawProviderArtifacts(runRoot: string, manifest: RunManifest): Promise<RunManifest> {
  const providers: ManifestProviderEntry[] = [];
  for (const entry of manifest.providers) {
    if (entry.result.status !== "ok") {
      providers.push(entry);
      continue;
    }
    const retainedArtifacts: string[] = [];
    for (const relativePath of entry.result.artifacts) {
      const sourcePath = path.join(runRoot, "raw", entry.identity.id, relativePath);
      const retainedPath = `${relativePath}.gz`;
      const destinationPath = path.join(runRoot, "raw", entry.identity.id, retainedPath);
      await pipeline(createReadStream(sourcePath), createGzip(), createWriteStream(destinationPath));
      await unlink(sourcePath);
      retainedArtifacts.push(retainedPath);
    }
    providers.push({
      ...entry,
      result: { ...entry.result, retainedArtifacts },
    });
  }
  return { ...manifest, providers };
}

async function readObservationArtifacts(runRoot: string, result: RunResult): Promise<FactObservation[]> {
  const observations: FactObservation[] = [];
  for (const entry of result.manifest.providers) {
    if (entry.result.status !== "ok") continue;
    for (const relativePath of entry.result.observationArtifacts ?? []) {
      if (path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) {
        throw new Error(`provider ${entry.identity.id} returned an unsafe observation artifact path`);
      }
      const filePath = path.join(runRoot, "raw", entry.identity.id, relativePath);
      const content = await readFile(filePath, "utf8");
      const values: unknown[] = relativePath.endsWith(".jsonl")
        ? content
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as unknown)
        : (JSON.parse(content) as unknown[]);
      if (!Array.isArray(values)) throw new Error(`observation artifact is not an array: ${filePath}`);
      for (const value of values) {
        const validation = validateObservationEnvelope(value);
        const structuralErrors = validation.errors.filter(
          (error) => error !== "predicate is not a supported observation predicate",
        );
        if (structuralErrors.length > 0) {
          throw new Error(`invalid observation in ${filePath}: ${structuralErrors.join("; ")}`);
        }
        observations.push(value as FactObservation);
      }
    }
  }
  return observations;
}

function assertCommitSha(value: string): void {
  if (!/^[0-9a-f]{40}$/iu.test(value)) {
    throw new Error("matrix requires an explicit 40-character commit SHA via --revision");
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Public type anchor for callers that persist the result for later review. */
export type MatrixNormalizationResult = FactNormalizationResult;
export type MatrixCorrelation = CorrelationResult;
