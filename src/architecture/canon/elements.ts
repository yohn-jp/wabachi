import { createObjectId, normalizeIdentityId, type ObjectId } from "./identity.js";

/** The canonical kinds supported by an Architecture Canon element record. */
export const ELEMENT_KINDS = ["actor", "system", "service", "component", "data-store", "external-system"] as const;

export type ElementKind = (typeof ELEMENT_KINDS)[number];

export interface ElementInput {
  readonly id: string;
  readonly kind: ElementKind;
  readonly displayName?: string;
  readonly technology?: string;
  readonly tags?: readonly string[];
  readonly properties?: Readonly<Record<string, string>>;
  readonly parentId?: string;
}

export interface ElementRecord {
  readonly id: ObjectId;
  readonly kind: ElementKind;
  readonly displayName?: string;
  readonly technology?: string;
  readonly tags?: readonly string[];
  readonly properties?: Readonly<Record<string, string>>;
  readonly parentId?: ObjectId;
}

function normalizeText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if ((!allowEmpty && normalized.length === 0) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }
  return normalized;
}

function normalizeTags(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("element tags must be an array");
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError("element tags must not contain sparse entries");
  }
  const tags = value.map((tag) => normalizeText(tag, "element tag")).sort();
  for (let index = 1; index < tags.length; index += 1) {
    if (tags[index - 1] === tags[index]) throw new Error(`duplicate element tag: ${tags[index]}`);
  }
  return Object.freeze(tags);
}

function normalizeProperties(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("element properties must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("element properties must be a plain object");
  }
  const properties: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeText(rawKey, "element property key");
    if (Object.hasOwn(properties, key)) throw new Error(`duplicate element property: ${key}`);
    properties[key] = normalizeText(rawValue, `element property ${key}`, true);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(properties).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
}

function assertRecordInput(input: unknown): asserts input is ElementInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("element must be an object");
  }

  const candidate = input as {
    id?: unknown;
    kind?: unknown;
    displayName?: unknown;
    technology?: unknown;
    tags?: unknown;
    properties?: unknown;
    parentId?: unknown;
  };

  normalizeIdentityId(candidate.id as string);
  if (!ELEMENT_KINDS.includes(candidate.kind as ElementKind)) {
    throw new TypeError(`element kind is unsupported: ${String(candidate.kind)}`);
  }
  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    throw new TypeError("element displayName must be a string");
  }
  if (candidate.technology !== undefined && typeof candidate.technology !== "string") {
    throw new TypeError("element technology must be a string");
  }
  if (candidate.parentId !== undefined) {
    normalizeIdentityId(candidate.parentId as string);
  }
}

/** Create one canonical record; display names are deliberately not semantic identity. */
export function createElement(input: ElementInput): ElementRecord {
  assertRecordInput(input);

  const displayName =
    input.displayName === undefined ? undefined : normalizeText(input.displayName, "element displayName");
  const technology = input.technology === undefined ? undefined : normalizeText(input.technology, "element technology");
  const tags = normalizeTags(input.tags);
  const properties = normalizeProperties(input.properties);

  const record: ElementRecord = {
    id: createObjectId(input.id),
    kind: input.kind,
    ...(displayName === undefined ? {} : { displayName }),
    ...(technology === undefined ? {} : { technology }),
    ...(tags === undefined ? {} : { tags }),
    ...(properties === undefined ? {} : { properties }),
  };

  if (input.parentId !== undefined) {
    return Object.freeze({ ...record, parentId: createObjectId(input.parentId) });
  }

  return Object.freeze(record);
}

function compareElements(left: ElementRecord, right: ElementRecord): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function assertContainmentIsValid(elements: readonly ElementRecord[]): void {
  const byId = new Map<string, ElementRecord>();

  for (const element of elements) {
    if (byId.has(element.id)) {
      throw new Error(`duplicate element id: ${element.id}`);
    }
    byId.set(element.id, element);
  }

  for (const element of elements) {
    if (element.parentId !== undefined && !byId.has(element.parentId)) {
      throw new Error(`unknown parent id: ${element.parentId}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (element: ElementRecord): void => {
    if (visited.has(element.id)) return;
    if (visiting.has(element.id)) {
      throw new Error(`containment cycle detected at: ${element.id}`);
    }

    visiting.add(element.id);
    if (element.parentId !== undefined) {
      visit(byId.get(element.parentId) as ElementRecord);
    }
    visiting.delete(element.id);
    visited.add(element.id);
  };

  for (const element of elements) visit(element);
}

/** Normalize records into a frozen, deterministic, validated containment set. */
export function normalizeElements(inputs: readonly ElementInput[]): readonly ElementRecord[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("elements must be an array");
  }

  const elements = inputs.map(createElement);
  assertContainmentIsValid(elements);
  elements.sort(compareElements);

  return Object.freeze(elements);
}

/** Validate an already-created record set without changing its order. */
export function validateContainment(elements: readonly ElementRecord[]): void {
  if (!Array.isArray(elements)) {
    throw new TypeError("elements must be an array");
  }
  assertContainmentIsValid(elements);
}
