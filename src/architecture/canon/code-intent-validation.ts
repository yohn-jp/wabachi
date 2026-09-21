import type { ArchitectureDocumentV1 } from "./document.js";
import type { RepositoryMapping } from "./repository-mappings.js";
import type { CodeIntent, CodeIntentContract } from "./code-intent-contract.js";
import {
  createCodeIntent,
  createCodeIntentContract,
  type CodeIntentContractInput,
  type CodeIntentInput,
} from "./code-intent.js";

export const CODE_INTENT_DIAGNOSTIC_CODES = [
  "invalid-code-intent",
  "unknown-code-intent-owner",
  "unknown-code-intent-responsibility",
  "unknown-code-intent-decision",
  "unknown-code-intent-source-mapping",
] as const;

export type CodeIntentDiagnosticCode = (typeof CODE_INTENT_DIAGNOSTIC_CODES)[number];

export interface CodeIntentDiagnostic {
  readonly code: CodeIntentDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface CodeIntentValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly CodeIntentDiagnostic[];
}

type IdCollection = readonly string[] | ReadonlySet<string>;
type IdentityRecord = { readonly id: string };
type MappingRecord = { readonly canonId: string };

/** Canon references used to resolve a Code Intent without changing Canon sections. */
export interface CodeIntentValidationContext {
  readonly ownerIds?: IdCollection;
  readonly responsibilityIds?: IdCollection;
  readonly decisionIds?: IdCollection;
  /** Repository mapping canon IDs; a Code Intent id must resolve to one when supplied. */
  readonly sourceMappingIds?: IdCollection;
  readonly owners?: readonly (string | IdentityRecord)[];
  readonly responsibilities?: readonly (string | IdentityRecord)[];
  readonly decisions?: readonly (string | IdentityRecord)[];
  readonly sourceMappings?: readonly (string | RepositoryMapping | MappingRecord)[];
  readonly repositoryMappings?: readonly (string | RepositoryMapping | MappingRecord)[];
}

type ValidationSource = CodeIntentValidationContext | ArchitectureDocumentV1;

function isArchitectureDocument(value: ValidationSource): value is ArchitectureDocumentV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "globalIdentityRegistry" in value &&
    "repositoryMappings" in value &&
    "responsibilities" in value &&
    "decisions" in value
  );
}

function asIds(values: unknown): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  if (values instanceof Set) return new Set(values);
  if (!Array.isArray(values)) throw new TypeError("Code Intent validation references must be arrays or sets");

  const ids = new Set<string>();
  for (const value of values) {
    if (typeof value === "string") {
      ids.add(value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      if ("id" in value && typeof value.id === "string") {
        ids.add(value.id);
        continue;
      }
      if ("canonId" in value && typeof value.canonId === "string") {
        ids.add(value.canonId);
        continue;
      }
    }
    throw new TypeError("Code Intent validation references must contain string IDs");
  }
  return ids;
}

function resolveContext(source: ValidationSource): {
  readonly ownerIds?: ReadonlySet<string>;
  readonly responsibilityIds?: ReadonlySet<string>;
  readonly decisionIds?: ReadonlySet<string>;
  readonly sourceMappingIds?: ReadonlySet<string>;
} {
  if (isArchitectureDocument(source)) {
    return {
      ownerIds: new Set(source.globalIdentityRegistry.entries.map((entry) => entry.id)),
      responsibilityIds: new Set(source.responsibilities.responsibilities.map((entry) => entry.id)),
      decisionIds: new Set(source.decisions.decisions.map((entry) => entry.id)),
      sourceMappingIds: new Set(source.repositoryMappings.map((entry) => entry.canonId)),
    };
  }

  const sourceMappings = source.sourceMappings ?? source.repositoryMappings;
  return {
    ownerIds: asIds(source.ownerIds ?? source.owners),
    responsibilityIds: asIds(source.responsibilityIds ?? source.responsibilities),
    decisionIds: asIds(source.decisionIds ?? source.decisions),
    sourceMappingIds: asIds(source.sourceMappingIds ?? sourceMappings),
  };
}

function addReferenceDiagnostic(
  diagnostics: CodeIntentDiagnostic[],
  set: ReadonlySet<string> | undefined,
  value: string,
  code: CodeIntentDiagnosticCode,
  path: string,
  label: string,
): void {
  if (set !== undefined && !set.has(value)) {
    diagnostics.push(Object.freeze({ code, path, message: `${label} references unknown identity: ${value}` }));
  }
}

function normalizeContractInput(
  contract: CodeIntentContract | CodeIntent | readonly CodeIntentInput[],
): CodeIntentContract {
  if (Array.isArray(contract)) return createCodeIntentContract(contract);
  if ("id" in contract && "ownerId" in contract) return createCodeIntentContract({ entries: [contract] });
  return createCodeIntentContract(contract as CodeIntentContractInput);
}

/**
 * Validate Code Intent references against an explicitly supplied Canon context.
 * Omitting a context leaves that reference namespace unresolved, matching the
 * leaf boundary used by the other Canon section constructors.
 */
export function validateCodeIntentContract(
  contract: CodeIntentContract | CodeIntent | readonly CodeIntentInput[],
  context: ValidationSource = {},
): CodeIntentValidationResult {
  const diagnostics: CodeIntentDiagnostic[] = [];
  let normalized: CodeIntentContract;
  try {
    normalized = normalizeContractInput(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([Object.freeze({ code: "invalid-code-intent" as const, path: "entries", message })]),
    });
  }

  let references: ReturnType<typeof resolveContext>;
  try {
    references = resolveContext(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([Object.freeze({ code: "invalid-code-intent" as const, path: "context", message })]),
    });
  }

  const ids = new Set<string>();
  for (let intentIndex = 0; intentIndex < normalized.entries.length; intentIndex += 1) {
    const intent = normalized.entries[intentIndex];
    const intentPath = `entries[${intentIndex}]`;
    if (ids.has(intent.id)) {
      diagnostics.push(
        Object.freeze({
          code: "invalid-code-intent",
          path: `${intentPath}.id`,
          message: `duplicate code intent id: ${intent.id}`,
        }),
      );
    }
    ids.add(intent.id);

    addReferenceDiagnostic(
      diagnostics,
      references.ownerIds,
      intent.ownerId,
      "unknown-code-intent-owner",
      `${intentPath}.ownerId`,
      "code intent owner",
    );
    addReferenceDiagnostic(
      diagnostics,
      references.sourceMappingIds,
      intent.id,
      "unknown-code-intent-source-mapping",
      `${intentPath}.id`,
      "code intent source mapping",
    );

    for (const [field, values, code, label] of [
      [
        "responsibilityIds",
        intent.responsibilityIds,
        "unknown-code-intent-responsibility",
        "code intent responsibility",
      ],
      ["decisionIds", intent.decisionIds, "unknown-code-intent-decision", "code intent decision"],
    ] as const) {
      for (let referenceIndex = 0; referenceIndex < values.length; referenceIndex += 1) {
        addReferenceDiagnostic(
          diagnostics,
          code === "unknown-code-intent-responsibility" ? references.responsibilityIds : references.decisionIds,
          values[referenceIndex],
          code,
          `${intentPath}.${field}[${referenceIndex}]`,
          label,
        );
      }
    }
  }

  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

/** Validate one normalized intent against an explicit Canon context. */
export function validateCodeIntent(
  intent: CodeIntent | CodeIntentInput,
  context: ValidationSource = {},
): CodeIntentValidationResult {
  return validateCodeIntentContract(createCodeIntent(intent as CodeIntentInput), context);
}

/** Throwing boundary for callers that require fail-closed construction. */
export function assertValidCodeIntentContract(
  contract: CodeIntentContract | CodeIntent | readonly CodeIntentInput[],
  context: ValidationSource = {},
): void {
  const result = validateCodeIntentContract(contract, context);
  if (!result.valid) {
    const first = result.diagnostics[0];
    throw new Error(`${first?.path ?? "code intent"}: ${first?.message ?? "invalid code intent"}`);
  }
}

export const validateCodeIntents = validateCodeIntentContract;
export const assertValidCodeIntents = assertValidCodeIntentContract;
