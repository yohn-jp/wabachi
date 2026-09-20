import { createHash } from "node:crypto";

export type JsonPrimitive = null | boolean | number | string;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

declare const digestBrand: unique symbol;

/** A hexadecimal SHA-256 digest of canonical JSON. */
export type Digest = string & { readonly [digestBrand]: never };

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function invalidJsonValue(path: string): TypeError {
  return new TypeError(`${path} must contain only JSON values`);
}

function canonicalValue(value: unknown, path: string, ancestors: WeakSet<object>): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers`);
    }
    return value;
  }

  if (typeof value !== "object" || value === undefined) {
    throw invalidJsonValue(path);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${path} must not contain cyclic references`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
      const ownSymbols = Object.getOwnPropertySymbols(value);
      if (
        ownSymbols.length > 0 ||
        ownNames.length !== value.length ||
        ownNames.some((name, index) => name !== String(index))
      ) {
        throw new TypeError(`${path} must be a dense JSON array`);
      }

      return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidJsonValue(path);
    }

    const ownSymbols = Object.getOwnPropertySymbols(value);
    const ownNames = Object.getOwnPropertyNames(value);
    if (ownSymbols.length > 0) {
      throw invalidJsonValue(path);
    }

    const entries = ownNames.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw invalidJsonValue(`${path}.${key}`);
      }
      return [key, descriptor.value] as const;
    });
    entries.sort(([left], [right]) => compareOrdinal(left, right));

    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, entry] of entries) {
      result[key] = canonicalValue(entry, `${path}.${key}`, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/** Serializes a JSON value with ordinal object-key ordering and preserved array order. */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, "$", new WeakSet<object>()));
}

/** Computes a SHA-256 digest over canonical JSON without including a digest field in the input. */
export function digestJson(value: unknown): Digest {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex") as Digest;
}
