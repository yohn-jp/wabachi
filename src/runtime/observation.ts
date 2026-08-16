import type { DeterminismClass, ProviderIdentity, ResolvedRepository } from "./provider.js";

/** Version of the provider observation interchange envelope. */
export const OBSERVATION_SCHEMA_VERSION = 1 as const;
export type ObservationSchemaVersion = typeof OBSERVATION_SCHEMA_VERSION;

/**
 * Minimal common interchange envelope for comparing provider evidence
 * (Wabachi Issue #5). This is intentionally not the final semantic fact
 * schema — only the smallest shape needed to express a subject/predicate/
 * object observation while retaining provenance and the provider's native
 * payload so no information is discarded during normalization.
 */

/** Predicates multiple providers can realistically expose, per Issue #5. */
export type ObservationPredicate =
  | "defines"
  | "references"
  | "calls"
  | "imports"
  | "exports"
  | "extends"
  | "implements"
  | "type-of"
  | "reads"
  | "writes"
  | "flows-to"
  | "depends-on";

export interface ObservationEntity {
  readonly id: string;
  readonly kind: string;
}

export interface SourceEvidence {
  readonly path: string;
  readonly span?: string;
}

export interface Observation {
  /** Optional for backwards-compatible in-memory callers; providers must emit it. */
  readonly schemaVersion?: ObservationSchemaVersion;
  readonly subject: ObservationEntity;
  readonly predicate: ObservationPredicate;
  readonly object: ObservationEntity | { readonly value: string };
  readonly provider: ProviderIdentity;
  readonly repository: ResolvedRepository;
  readonly source: SourceEvidence;
  readonly determinism: DeterminismClass;
  /** Original provider-native record this observation was adapted from, so nothing is lost. */
  readonly providerNative: unknown;
}
