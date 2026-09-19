import { normalizeIdentityId } from "./identity.js";

export type RepositoryPathScope = "file" | "directory";

export interface RepositoryPathMapping {
  readonly path: string;
  readonly scope: RepositoryPathScope;
}

export type RepositoryPathInput =
  | string
  | {
      readonly path: string;
      readonly scope?: RepositoryPathScope;
    };

export interface RepositorySymbolMapping {
  readonly path: string;
  readonly symbol: string;
  readonly exportName?: string;
}

export interface RepositorySymbolInput {
  readonly path: string;
  readonly symbol: string;
  readonly exportName?: string;
}

export interface RepositoryTestMapping {
  readonly path: string;
  readonly selector: string;
}

export interface RepositoryTestInput {
  readonly path: string;
  readonly selector: string;
}

export interface RepositoryMappingInput {
  readonly canonId: string;
  readonly paths?: readonly RepositoryPathInput[];
  readonly symbols?: readonly RepositorySymbolInput[];
  readonly tests?: readonly RepositoryTestInput[];
}

export interface RepositoryMapping {
  readonly canonId: string;
  readonly paths: readonly RepositoryPathMapping[];
  readonly symbols: readonly RepositorySymbolMapping[];
  readonly tests: readonly RepositoryTestMapping[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }

  return normalized;
}

/**
 * Normalizes a declaration path without consulting the repository.
 *
 * Backslashes and dot segments are normalized so equivalent declarations
 * serialize identically. Parent segments are rejected instead of resolved;
 * this keeps the declaration rooted even when its starting path is unknown.
 */
export function normalizeRepositoryPath(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("repository path must be a string");
  }

  const normalized = value.normalize("NFC").replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:($|\/)/u.test(normalized) ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)
  ) {
    throw new TypeError("repository path must be relative to the repository root");
  }

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw new TypeError("repository path cannot escape the repository root");
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new TypeError("repository path must identify a repository-relative path");
  }

  return segments.join("/");
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function comparePaths(left: RepositoryPathMapping, right: RepositoryPathMapping): number {
  return compareStrings(left.path, right.path) || compareStrings(left.scope, right.scope);
}

function compareSymbols(left: RepositorySymbolMapping, right: RepositorySymbolMapping): number {
  return (
    compareStrings(left.path, right.path) ||
    compareStrings(left.symbol, right.symbol) ||
    compareStrings(left.exportName ?? "", right.exportName ?? "")
  );
}

function compareTests(left: RepositoryTestMapping, right: RepositoryTestMapping): number {
  return compareStrings(left.path, right.path) || compareStrings(left.selector, right.selector);
}

function normalizePathMapping(input: RepositoryPathInput): RepositoryPathMapping {
  const pathInput = typeof input === "string" ? { path: input } : input;
  assertRecord(pathInput, "repository path mapping");
  const scope = pathInput.scope ?? "file";
  if (scope !== "file" && scope !== "directory") {
    throw new TypeError("repository path mapping scope must be file or directory");
  }

  return Object.freeze({
    path: normalizeRepositoryPath(pathInput.path),
    scope,
  });
}

function normalizeSymbolMapping(input: RepositorySymbolInput): RepositorySymbolMapping {
  assertRecord(input, "repository symbol mapping");
  const exportName =
    input.exportName === undefined ? undefined : normalizeText(input.exportName, "repository export name");

  return Object.freeze({
    path: normalizeRepositoryPath(input.path),
    symbol: normalizeText(input.symbol, "repository symbol"),
    ...(exportName === undefined ? {} : { exportName }),
  });
}

function normalizeTestMapping(input: RepositoryTestInput): RepositoryTestMapping {
  assertRecord(input, "repository test mapping");

  return Object.freeze({
    path: normalizeRepositoryPath(input.path),
    selector: normalizeText(input.selector, "repository test selector"),
  });
}

export function createRepositoryMapping(input: RepositoryMappingInput): RepositoryMapping {
  assertRecord(input, "repository mapping");
  if (input.paths !== undefined && !Array.isArray(input.paths)) {
    throw new TypeError("repository mapping paths must be an array");
  }
  if (input.symbols !== undefined && !Array.isArray(input.symbols)) {
    throw new TypeError("repository mapping symbols must be an array");
  }
  if (input.tests !== undefined && !Array.isArray(input.tests)) {
    throw new TypeError("repository mapping tests must be an array");
  }

  const paths = [...(input.paths ?? [])].map(normalizePathMapping).sort(comparePaths);
  const symbols = [...(input.symbols ?? [])].map(normalizeSymbolMapping).sort(compareSymbols);
  const tests = [...(input.tests ?? [])].map(normalizeTestMapping).sort(compareTests);

  return Object.freeze({
    canonId: normalizeIdentityId(input.canonId),
    paths: Object.freeze(paths),
    symbols: Object.freeze(symbols),
    tests: Object.freeze(tests),
  });
}

export function createRepositoryMappings(inputs: readonly RepositoryMappingInput[]): readonly RepositoryMapping[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("repository mappings must be an array");
  }

  const mappings = inputs
    .map(createRepositoryMapping)
    .sort((left, right) => compareStrings(left.canonId, right.canonId));
  for (let index = 1; index < mappings.length; index += 1) {
    if (mappings[index - 1].canonId === mappings[index].canonId) {
      throw new Error(`duplicate repository mapping canon id: ${mappings[index].canonId}`);
    }
  }

  return Object.freeze(mappings);
}

/** Serializes declarations in canonical order; no repository access occurs. */
export function serializeRepositoryMappings(mappings: readonly RepositoryMappingInput[]): string {
  return JSON.stringify(createRepositoryMappings(mappings));
}
