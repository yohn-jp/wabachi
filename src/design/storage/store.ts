import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { DesignChangeSet, DesignIntentLifecycleRecord } from "../contracts.js";
import type { DesignChangeStorePort, DesignLifecyclePort } from "../ports.js";
import { resolveDesignRepositoryPaths, type DesignRepositoryPaths } from "./paths.js";
import {
  decodeDesignIntentLifecycleRecord,
  parseDesignIntentLifecycleRecord,
  parseStoredDesignChange,
  serializeDesignIntentLifecycleRecord,
  serializeStoredDesignChange,
} from "./record-codec.js";
import {
  assertNoPendingTransactions,
  commitTransaction,
  type FileDigest,
  type TransactionResult,
} from "./transaction.js";

export interface StoredArtifact<T> {
  readonly value: T;
  readonly bytes: Uint8Array;
  readonly byteDigest: FileDigest;
}

/** A byte-CAS preimage and the exact post-image to pass to a transaction. */
export interface StorageWritePlan {
  readonly path: string;
  readonly expectedDigest: FileDigest | null;
  readonly nextBytes: Uint8Array;
}

export interface DesignStoreOptions {
  readonly repositoryRoot?: string;
  readonly cwd?: string;
}

export class StorageReadError extends Error {
  readonly path: string;

  constructor(filePath: string, message: string, options?: ErrorOptions) {
    super(`${message}: ${filePath}`, options);
    this.name = "StorageReadError";
    this.path = filePath;
  }
}

export class UnstableStorageReadError extends StorageReadError {
  constructor(filePath: string) {
    super(filePath, "stored bytes changed during read");
    this.name = "UnstableStorageReadError";
  }
}

function isNotFound(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function digestBytes(bytes: Uint8Array): FileDigest {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

async function stableBytes(filePath: string): Promise<Uint8Array | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let before;
    try {
      before = await lstat(filePath);
      if (!before.isFile()) throw new StorageReadError(filePath, "stored artifact is not a regular file");
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    let first: Buffer;
    let second: Buffer;
    try {
      first = await readFile(filePath);
      second = await readFile(filePath);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw new StorageReadError(filePath, "stored artifact could not be read", { cause: error });
    }
    let after;
    try {
      after = await lstat(filePath);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    if (
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      sameBytes(first, second)
    ) {
      return cloneBytes(first);
    }
  }
  throw new UnstableStorageReadError(filePath);
}

async function artifact<T>(filePath: string, decode: (source: string) => T): Promise<StoredArtifact<T> | undefined> {
  const bytes = await stableBytes(filePath);
  if (bytes === undefined) return undefined;
  let value: T;
  try {
    value = decode(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new StorageReadError(filePath, error instanceof Error ? error.message : String(error), { cause: error });
  }
  return Object.freeze({ value, bytes, byteDigest: digestBytes(bytes) });
}

function plan(
  filePath: string,
  relativePath: string,
  current: StoredArtifact<unknown> | undefined,
  nextBytes: Uint8Array,
): StorageWritePlan {
  return Object.freeze({
    path: relativePath,
    expectedDigest: current?.byteDigest ?? null,
    nextBytes: cloneBytes(nextBytes),
  });
}

/** Repository-resident Design Change storage with strict reads and byte CAS plans. */
class RepositoryStorage {
  private readonly options: DesignStoreOptions;

  constructor(options: DesignStoreOptions = {}) {
    this.options = Object.freeze({ ...options });
  }

  private async paths(changeId: string): Promise<DesignRepositoryPaths> {
    return resolveDesignRepositoryPaths({ ...this.options, changeId });
  }

  async readChangeArtifact(changeId: string): Promise<StoredArtifact<DesignChangeSet> | undefined> {
    const paths = await this.paths(changeId);
    await assertNoPendingTransactions(paths.repositoryRoot);
    const result = await artifact(paths.change, parseStoredDesignChange);
    if (result !== undefined && result.value.changeId !== changeId) {
      throw new StorageReadError(paths.change, "stored Design Change does not match its path");
    }
    return result;
  }

  async readLifecycleArtifact(changeId: string): Promise<StoredArtifact<DesignIntentLifecycleRecord> | undefined> {
    const paths = await this.paths(changeId);
    await assertNoPendingTransactions(paths.repositoryRoot);
    const result = await artifact(paths.lifecycle, parseDesignIntentLifecycleRecord);
    if (result === undefined) return undefined;
    if (result.value.changeId !== changeId) {
      throw new StorageReadError(paths.lifecycle, "stored lifecycle record does not match its path");
    }
    const change = await this.readChangeArtifact(changeId);
    if (change === undefined || change.value.digest !== result.value.changeDigest) {
      throw new StorageReadError(
        paths.lifecycle,
        "stored lifecycle record is from a different Design Change generation",
      );
    }
    return result;
  }

  async readChange(changeId: string): Promise<DesignChangeSet | undefined> {
    return (await this.readChangeArtifact(changeId))?.value;
  }

  async readLifecycle(changeId: string): Promise<DesignIntentLifecycleRecord | undefined> {
    return (await this.readLifecycleArtifact(changeId))?.value;
  }

  async readRecord(changeId: string): Promise<DesignIntentLifecycleRecord | undefined> {
    return this.readLifecycle(changeId);
  }

  async planChangeWrite(change: DesignChangeSet): Promise<StorageWritePlan> {
    const paths = await this.paths(change.changeId);
    const current = await this.readChangeArtifact(change.changeId);
    const nextBytes = Buffer.from(serializeStoredDesignChange(change), "utf8");
    return plan(paths.change, paths.relative.change, current, nextBytes);
  }

  async planLifecycleWrite(record: DesignIntentLifecycleRecord): Promise<StorageWritePlan> {
    const paths = await this.paths(record.changeId);
    const current = await this.readLifecycleArtifact(record.changeId);
    const nextBytes = Buffer.from(serializeDesignIntentLifecycleRecord(record), "utf8");
    return plan(paths.lifecycle, paths.relative.lifecycle, current, nextBytes);
  }

  async planRecordWrite(record: DesignIntentLifecycleRecord): Promise<StorageWritePlan> {
    return this.planLifecycleWrite(record);
  }

  async writeChange(change: DesignChangeSet): Promise<void> {
    await this.commit([await this.planChangeWrite(change)]);
  }

  async writeLifecycle(record: DesignIntentLifecycleRecord): Promise<void> {
    await this.commit([await this.planLifecycleWrite(record)]);
  }

  async writeRecord(record: DesignIntentLifecycleRecord): Promise<void> {
    return this.writeLifecycle(record);
  }

  /** Commits one or more plans using the crash-safe transaction primitive. */
  async commit(plans: readonly StorageWritePlan[]): Promise<TransactionResult> {
    const root = await this.repositoryRoot();
    return commitTransaction({
      rootDir: root,
      targets: plans.map((entry) => ({
        path: entry.path,
        content: entry.nextBytes,
        expectedDigest: entry.expectedDigest,
      })),
    });
  }

  protected async repositoryRoot(): Promise<string> {
    const paths = await resolveDesignRepositoryPaths({ ...this.options, changeId: "storage-root" });
    return path.resolve(paths.repositoryRoot);
  }
}

/** Storage adapter for the semantic Design Change Set port. */
export class DesignChangeStore extends RepositoryStorage implements DesignChangeStorePort {
  async read(changeId: string): Promise<DesignChangeSet | undefined> {
    return this.readChange(changeId);
  }

  async write(change: DesignChangeSet): Promise<void> {
    return this.writeChange(change);
  }
}

/** Storage adapter for the cached lifecycle record port. */
export class DesignLifecycleStore extends RepositoryStorage implements DesignLifecyclePort {
  async read(changeId: string): Promise<DesignIntentLifecycleRecord | undefined> {
    return this.readLifecycle(changeId);
  }

  async write(record: DesignIntentLifecycleRecord): Promise<void> {
    return this.writeLifecycle(record);
  }
}

/** Convenience composition for callers that need both repository adapters. */
export class DesignStore extends RepositoryStorage {
  readonly changeStore: DesignChangeStore;
  readonly lifecycle: DesignLifecycleStore;

  constructor(options: DesignStoreOptions = {}) {
    super(options);
    this.changeStore = new DesignChangeStore(options);
    this.lifecycle = new DesignLifecycleStore(options);
  }
}

export function createDesignStore(options: DesignStoreOptions = {}): DesignStore {
  return new DesignStore(options);
}

export const RepositoryDesignStore = DesignStore;
export const FileDesignStore = DesignStore;

/** Validates a record before callers create a byte-CAS plan. */
export function validateStoredLifecycleRecord(record: DesignIntentLifecycleRecord): DesignIntentLifecycleRecord {
  return decodeDesignIntentLifecycleRecord(record);
}
