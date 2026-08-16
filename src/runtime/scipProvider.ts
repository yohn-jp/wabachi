import { execFile } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { scip } from "@sourcegraph/scip-typescript/dist/src/scip.js";
import { OBSERVATION_SCHEMA_VERSION, type Observation, type ObservationPredicate } from "./observation.js";
import type { Provider, ProviderContext, ProviderExecutionResult } from "./provider.js";

const execFileAsync = promisify(execFile);

const RAW_INDEX_FILENAME = "index.scip";
const OBSERVATIONS_FILENAME = "observations.json";

const SCIP_TYPESCRIPT_VERSION = "0.4.0";
const DEFINITION_ROLE = 1; // scip.SymbolRole.Definition

export type ScipObservation = Observation;

/**
 * Evidence provider for SCIP / scip-typescript (Issue #8). Runs
 * scip-typescript against the isolated workspace, retains its raw `.scip`
 * protobuf index unmodified, and projects documents/occurrences/symbols
 * into the common observation envelope without discarding or normalizing
 * SCIP-native symbol identities.
 */
export function createScipTypescriptProvider(): Provider {
  return {
    identity: { id: "scip-typescript", version: SCIP_TYPESCRIPT_VERSION, determinism: "deterministic" },

    async isAvailable(): Promise<boolean> {
      try {
        await execFileAsync(process.execPath, [scipTypescriptBin(), "--version"]);
        return true;
      } catch {
        return false;
      }
    },

    async execute(context: ProviderContext): Promise<ProviderExecutionResult> {
      const startedAt = new Date().toISOString();
      const rawIndexPath = path.join(context.workspaceRoot, RAW_INDEX_FILENAME);

      const args = [
        scipTypescriptBin(),
        "index",
        "--cwd",
        context.workspaceRoot,
        "--output",
        rawIndexPath,
        "--infer-tsconfig",
      ];
      await execFileAsync(process.execPath, args, { cwd: context.workspaceRoot, maxBuffer: 1024 * 1024 * 1024 });

      const rawIndexBytes = await readFile(rawIndexPath);
      const retainedIndexPath = path.join(context.artifactRoot, RAW_INDEX_FILENAME);
      await copyFile(rawIndexPath, retainedIndexPath);

      const index = scip.Index.deserializeBinary(rawIndexBytes).toObject();
      const observations = toObservations(index, context);

      const observationsPath = path.join(context.artifactRoot, OBSERVATIONS_FILENAME);
      await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`, "utf8");

      return {
        status: "ok",
        artifacts: [RAW_INDEX_FILENAME, OBSERVATIONS_FILENAME],
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    },
  };
}

function scipTypescriptBin(): string {
  return new URL(import.meta.resolve("@sourcegraph/scip-typescript")).pathname;
}

function toObservations(index: scip.IndexObject, context: ProviderContext): ScipObservation[] {
  const provider = {
    id: "scip-typescript",
    version: index.metadata?.tool_info?.version ?? SCIP_TYPESCRIPT_VERSION,
    determinism: "deterministic" as const,
  };
  const repository = { source: context.repository.source, commitSha: context.repository.commitSha };
  const observations: ScipObservation[] = [];

  for (const document of index.documents) {
    for (const occurrence of document.occurrences) {
      if (occurrence.symbol.length === 0) continue;

      const span = toSpan(occurrence.range);
      const isDefinition = (occurrence.symbol_roles & DEFINITION_ROLE) === DEFINITION_ROLE;

      observations.push({
        schemaVersion: OBSERVATION_SCHEMA_VERSION,
        subject: { kind: "symbol", id: occurrence.symbol },
        predicate: isDefinition ? "defines" : "references",
        object: { value: document.relative_path },
        provider,
        repository,
        source: { path: document.relative_path, span },
        determinism: "deterministic",
        providerNative: occurrence,
      });
    }

    for (const symbolInfo of document.symbols) {
      const definitionOccurrence = document.occurrences.find(
        (occurrence) =>
          occurrence.symbol === symbolInfo.symbol && (occurrence.symbol_roles & DEFINITION_ROLE) === DEFINITION_ROLE,
      );
      const span = definitionOccurrence ? toSpan(definitionOccurrence.range) : undefined;

      for (const relationship of symbolInfo.relationships) {
        const predicate: ObservationPredicate | undefined = relationship.is_implementation
          ? "implements"
          : relationship.is_type_definition
            ? "type-of"
            : undefined;
        if (predicate === undefined) continue;

        observations.push({
          schemaVersion: OBSERVATION_SCHEMA_VERSION,
          subject: { kind: "symbol", id: symbolInfo.symbol },
          predicate,
          object: { kind: "symbol", id: relationship.symbol },
          provider,
          repository,
          source: { path: document.relative_path, span },
          determinism: "deterministic",
          providerNative: relationship,
        });
      }
    }
  }

  return observations;
}

/** Encodes a SCIP packed range (`[line, startChar, endChar]` or `[startLine, startChar, endLine, endChar]`) as `line:col-line:col`. */
function toSpan(range: readonly number[]): string {
  if (range.length === 4) {
    const [startLine, startCharacter, endLine, endCharacter] = range as [number, number, number, number];
    return `${startLine}:${startCharacter}-${endLine}:${endCharacter}`;
  }
  const [line, startCharacter, endCharacter] = range as [number, number, number];
  return `${line}:${startCharacter}-${line}:${endCharacter}`;
}
