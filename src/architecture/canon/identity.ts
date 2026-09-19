const CANON_VERSION = 1 as const;

declare const architectureIdBrand: unique symbol;
declare const objectIdBrand: unique symbol;
declare const documentIdBrand: unique symbol;

export type CanonVersion = typeof CANON_VERSION;
export type ArchitectureId = string & { readonly [architectureIdBrand]: never };
export type ObjectId = string & { readonly [objectIdBrand]: never };
export type DocumentId = string & { readonly [documentIdBrand]: never };

export interface IdentityInput {
  readonly id: string;
  readonly displayName?: string;
}

export interface ArchitectureIdentity {
  readonly kind: "architecture";
  readonly id: ArchitectureId;
}

export interface ObjectIdentity {
  readonly kind: "object";
  readonly id: ObjectId;
}

export interface ArchitectureCanonEnvelopeInput {
  readonly documentId: string;
  readonly root: IdentityInput;
  readonly objects?: readonly IdentityInput[];
}

export interface ArchitectureCanonEnvelope {
  readonly canonVersion: CanonVersion;
  readonly documentId: DocumentId;
  readonly root: ArchitectureIdentity;
  readonly objects: readonly ObjectIdentity[];
}

export { CANON_VERSION };

function normalizeId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.normalize("NFC");
  if (normalized.length === 0 || /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${label} is malformed`);
  }

  return normalized;
}

function validateIdentityInput(input: unknown): asserts input is IdentityInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("identity must be an object");
  }

  const candidate = input as { id?: unknown; displayName?: unknown };
  normalizeId(candidate.id, "identity id");
  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    throw new TypeError("identity displayName must be a string");
  }
}

export function normalizeIdentityId(value: string): string {
  return normalizeId(value, "identity id");
}

export function createArchitectureId(value: string): ArchitectureId {
  return normalizeIdentityId(value) as ArchitectureId;
}

export function createObjectId(value: string): ObjectId {
  return normalizeIdentityId(value) as ObjectId;
}

export function createDocumentId(value: string): DocumentId {
  return normalizeId(value, "document id") as DocumentId;
}

export function createArchitectureIdentity(input: IdentityInput): ArchitectureIdentity {
  validateIdentityInput(input);

  return Object.freeze({
    kind: "architecture" as const,
    id: createArchitectureId(input.id),
  });
}

export function createObjectIdentity(input: IdentityInput): ObjectIdentity {
  validateIdentityInput(input);

  return Object.freeze({
    kind: "object" as const,
    id: createObjectId(input.id),
  });
}

export function createArchitectureCanonEnvelope(input: ArchitectureCanonEnvelopeInput): ArchitectureCanonEnvelope {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("canon envelope must be an object");
  }

  const candidate = input as {
    documentId?: unknown;
    root?: unknown;
    objects?: unknown;
  };
  const documentId = createDocumentId(candidate.documentId as string);
  const root = createArchitectureIdentity(candidate.root as IdentityInput);

  if (
    candidate.objects !== undefined &&
    (!Array.isArray(candidate.objects) ||
      candidate.objects.some((object) => object === null || typeof object !== "object"))
  ) {
    throw new TypeError("canon envelope objects must be an array of identities");
  }

  const objects = (candidate.objects ?? []).map((object) => createObjectIdentity(object as IdentityInput));
  const objectIds = new Set<string>();
  for (const object of objects) {
    if (objectIds.has(object.id)) {
      throw new Error(`duplicate object id: ${object.id}`);
    }
    objectIds.add(object.id);
  }

  objects.sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });

  return Object.freeze({
    canonVersion: CANON_VERSION,
    documentId,
    root,
    objects: Object.freeze(objects),
  });
}
