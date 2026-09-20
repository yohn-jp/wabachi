import type { RepositoryPathMapping, RepositorySymbolMapping, RepositoryTestMapping } from "./repository-mappings.js";

export type CodeIntentKind = "purpose" | "responsibility" | "invariant" | "prohibition";

export interface CodeIntentPathTarget {
  readonly kind: "path";
  readonly mapping: RepositoryPathMapping;
}

export interface CodeIntentSymbolTarget {
  readonly kind: "symbol";
  readonly mapping: RepositorySymbolMapping;
}

export interface CodeIntentTestTarget {
  readonly kind: "test";
  readonly mapping: RepositoryTestMapping;
}

export type CodeIntentTarget = CodeIntentPathTarget | CodeIntentSymbolTarget | CodeIntentTestTarget;

/** Canon-owned source-level intent attached to an existing repository mapping. */
export interface CodeIntent {
  readonly id: string;
  readonly kind: CodeIntentKind;
  readonly canonId: string;
  readonly target: CodeIntentTarget;
  readonly statement: string;
  readonly rationale?: string;
}

export interface CodeIntentContract {
  readonly entries: readonly CodeIntent[];
}
