import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const TRANSACTION_DIRECTORY = ".transactions";
const LOCK_FILE = "lock";
const JOURNAL_FILE = "journal.json";
const JOURNAL_VERSION = 1 as const;

export type FileDigest = string;

export interface TransactionTarget {
  /** An absolute path below rootDir, or a path relative to rootDir. */
  readonly path: string;
  readonly content: string | Uint8Array;
  /** null means that the target is expected not to exist. */
  readonly expectedDigest?: FileDigest | null;
}

export interface RenameBoundary {
  readonly transactionId: string;
  readonly index: number;
  readonly targetPath: string;
  readonly phase: "before-rename" | "after-rename";
}

export type RenameFaultInjector = (boundary: RenameBoundary) => void | Promise<void>;

export interface CommitTransactionRequest {
  readonly rootDir: string;
  readonly targets: readonly TransactionTarget[];
  readonly transactionId?: string;
  readonly faultInjector?: RenameFaultInjector;
}

export interface TransactionResult {
  readonly transactionId: string;
  readonly state: "committed";
}

export interface PendingTransaction {
  readonly transactionId: string;
  readonly state: JournalState;
  readonly targetPaths: readonly string[];
}

export type JournalState = "preparing" | "prepared" | "committing" | "committed";

export class DesignTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignTransactionError";
  }
}

export class TransactionBusyError extends DesignTransactionError {
  constructor(rootDir: string) {
    super(`a Design transaction lock is already held for ${rootDir}`);
    this.name = "TransactionBusyError";
  }
}

export class PendingTransactionError extends DesignTransactionError {
  readonly transactions: readonly PendingTransaction[];

  constructor(transactions: readonly PendingTransaction[]) {
    super(
      `pending Design transaction(s) require explicit recovery: ${transactions
        .map((transaction) => transaction.transactionId)
        .join(", ")}`,
    );
    this.name = "PendingTransactionError";
    this.transactions = transactions;
  }
}

export class TransactionConflictError extends DesignTransactionError {
  constructor(message: string) {
    super(message);
    this.name = "TransactionConflictError";
  }
}

interface JournalTarget {
  readonly path: string;
  readonly expectedDigest: FileDigest | null;
  readonly postDigest: FileDigest;
  readonly stage: string;
}

interface Journal {
  readonly version: typeof JOURNAL_VERSION;
  readonly transactionId: string;
  readonly state: JournalState;
  readonly targets: readonly JournalTarget[];
  readonly completed: readonly number[];
}

interface LockHandle {
  readonly file: Awaited<ReturnType<typeof open>>;
  readonly path: string;
  readonly rootDir: string;
}

interface ResolvedTarget extends TransactionTarget {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly bytes: Buffer;
  readonly actualDigest: FileDigest | null;
}

/**
 * Commits a set of repository files as one crash-recoverable filesystem
 * transaction. A transaction is intentionally incomplete until every target
 * has its post-image digest; a journal is retained whenever an error occurs
 * after staging, so callers cannot mistake a partial commit for success.
 */
export async function commitTransaction(request: CommitTransactionRequest): Promise<TransactionResult> {
  const rootDir = path.resolve(request.rootDir);
  const transactionId = request.transactionId ?? randomUUID();
  assertTransactionId(transactionId);
  const targets = await resolveTargets(rootDir, request.targets);
  if (targets.length === 0) return { transactionId, state: "committed" };

  const lock = await acquireLock(rootDir);
  let transactionDirectory: string | undefined;
  try {
    await assertNoPendingTransactions(rootDir);
    transactionDirectory = path.join(rootDir, TRANSACTION_DIRECTORY, transactionId);
    await mkdir(path.join(transactionDirectory, "stage"), { recursive: true });

    const journalTargets: JournalTarget[] = targets.map((target, index) => ({
      path: target.relativePath,
      expectedDigest: target.expectedDigest ?? target.actualDigest,
      postDigest: digestBytes(target.bytes),
      stage: path.join("stage", `${index}.stage`),
    }));
    const journalPath = path.join(transactionDirectory, JOURNAL_FILE);
    await writeJournal(journalPath, {
      version: JOURNAL_VERSION,
      transactionId,
      state: "preparing",
      targets: journalTargets,
      completed: [],
    });

    for (const [index, target] of targets.entries()) {
      const stagePath = path.join(transactionDirectory, journalTargets[index].stage);
      await writeDurableFile(stagePath, target.bytes);
    }
    await writeJournal(journalPath, {
      version: JOURNAL_VERSION,
      transactionId,
      state: "prepared",
      targets: journalTargets,
      completed: [],
    });

    let completed: number[] = [];
    for (const [index, target] of targets.entries()) {
      const journalTarget = journalTargets[index];
      const currentDigest = await digestFile(target.absolutePath);
      if (currentDigest !== journalTarget.expectedDigest) {
        throw new TransactionConflictError(
          `target ${journalTarget.path} changed before rename; refusing to overwrite it`,
        );
      }

      await invokeFaultInjector(request.faultInjector, {
        transactionId,
        index,
        targetPath: journalTarget.path,
        phase: "before-rename",
      });
      await mkdir(path.dirname(target.absolutePath), { recursive: true });
      await rename(path.join(transactionDirectory, journalTarget.stage), target.absolutePath);
      await syncDirectory(path.dirname(target.absolutePath));
      await invokeFaultInjector(request.faultInjector, {
        transactionId,
        index,
        targetPath: journalTarget.path,
        phase: "after-rename",
      });
      completed = addCompleted(completed, index);
      await writeJournal(journalPath, {
        version: JOURNAL_VERSION,
        transactionId,
        state: "committing",
        targets: journalTargets,
        completed,
      });
    }

    await verifyPostImages(rootDir, journalTargets);
    await writeJournal(journalPath, {
      version: JOURNAL_VERSION,
      transactionId,
      state: "committed",
      targets: journalTargets,
      completed,
    });
    await removeTransactionDirectory(transactionDirectory);
    return { transactionId, state: "committed" };
  } finally {
    await releaseLock(lock);
  }
}

export interface RecoverTransactionOptions {
  readonly transactionId?: string;
  /** Explicitly take over a lock left by a terminated writer. */
  readonly force?: boolean;
}

/**
 * Explicitly rolls a pending transaction forward. Recovery first checks every
 * target against its expected pre- or post-image, so a third-party mutation
 * cannot be overwritten by a recovery rename.
 */
export async function recoverTransaction(
  rootDirInput: string,
  options: RecoverTransactionOptions = {},
): Promise<TransactionResult> {
  const rootDir = path.resolve(rootDirInput);
  const pending = await listPendingTransactions(rootDir);
  const selected = selectPendingTransaction(pending, options.transactionId);
  if (selected === undefined) {
    throw new DesignTransactionError(`no pending Design transaction found for ${rootDir}`);
  }
  assertTransactionId(selected.transactionId);

  const lock = await acquireLock(rootDir, options.force === true);
  try {
    const transactionDirectory = path.join(rootDir, TRANSACTION_DIRECTORY, selected.transactionId);
    const journalPath = path.join(transactionDirectory, JOURNAL_FILE);
    const journal = await readJournal(journalPath, selected.transactionId);
    await validateRecoveryImages(rootDir, transactionDirectory, journal);

    let completed = [...journal.completed];
    for (const [index, target] of journal.targets.entries()) {
      const currentDigest = await digestFile(path.join(rootDir, target.path));
      if (currentDigest === target.postDigest) {
        completed = addCompleted(completed, index);
        continue;
      }
      if (currentDigest !== target.expectedDigest) {
        throw new TransactionConflictError(`target ${target.path} changed during recovery`);
      }

      const stagePath = resolveInsideRoot(transactionDirectory, target.stage);
      if (!(await isPresent(stagePath))) {
        throw new TransactionConflictError(`post-image for ${target.path} is no longer staged`);
      }
      const targetPath = resolveInsideRoot(rootDir, target.path);
      await rename(stagePath, targetPath);
      await syncDirectory(path.dirname(targetPath));
      completed = addCompleted(completed, index);
      await writeJournal(journalPath, {
        version: JOURNAL_VERSION,
        transactionId: journal.transactionId,
        state: "committing",
        targets: journal.targets,
        completed,
      });
    }

    await verifyPostImages(rootDir, journal.targets);
    await writeJournal(journalPath, {
      version: JOURNAL_VERSION,
      transactionId: journal.transactionId,
      state: "committed",
      targets: journal.targets,
      completed,
    });
    await removeTransactionDirectory(transactionDirectory);
    return { transactionId: journal.transactionId, state: "committed" };
  } finally {
    await releaseLock(lock);
  }
}

/** Returns pending journals without changing repository state. */
export async function listPendingTransactions(rootDirInput: string): Promise<readonly PendingTransaction[]> {
  const rootDir = path.resolve(rootDirInput);
  const directory = path.join(rootDir, TRANSACTION_DIRECTORY);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, "ENOENT")) return [];
    throw error;
  }

  const pending: PendingTransaction[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transactionId = entry.name;
    const journalPath = path.join(directory, transactionId, JOURNAL_FILE);
    if (!(await isPresent(journalPath))) continue;
    const journal = await readJournal(journalPath, transactionId);
    if (journal.state !== "committed") {
      pending.push({
        transactionId,
        state: journal.state,
        targetPaths: journal.targets.map((target) => target.path),
      });
    }
  }
  return pending.sort((left, right) => compareOrdinal(left.transactionId, right.transactionId));
}

/** Normal reads and mutations should call this guard before using Design state. */
export async function assertNoPendingTransactions(rootDir: string): Promise<void> {
  const pending = await listPendingTransactions(rootDir);
  if (pending.length > 0) throw new PendingTransactionError(pending);
}

export async function hasPendingTransactions(rootDir: string): Promise<boolean> {
  return (await listPendingTransactions(rootDir)).length > 0;
}

async function resolveTargets(rootDir: string, targets: readonly TransactionTarget[]): Promise<ResolvedTarget[]> {
  const resolved = await Promise.all(
    targets.map(async (target) => {
      const absolutePath = resolveInsideRoot(rootDir, target.path);
      const relativePath = path.relative(rootDir, absolutePath);
      if (relativePath === TRANSACTION_DIRECTORY || relativePath.startsWith(`${TRANSACTION_DIRECTORY}${path.sep}`)) {
        throw new DesignTransactionError("transaction metadata cannot be a transaction target");
      }
      const bytes =
        typeof target.content === "string" ? Buffer.from(target.content, "utf8") : Buffer.from(target.content);
      const actualDigest = await digestFile(absolutePath);
      const expectedDigest = target.expectedDigest;
      if (expectedDigest !== undefined && expectedDigest !== actualDigest) {
        throw new TransactionConflictError(`target ${relativePath} does not match its expected digest`);
      }
      return { ...target, absolutePath, relativePath, bytes, actualDigest };
    }),
  );
  resolved.sort((left, right) => compareOrdinal(left.relativePath, right.relativePath));
  for (let index = 1; index < resolved.length; index += 1) {
    if (resolved[index - 1].relativePath === resolved[index].relativePath) {
      throw new DesignTransactionError(`duplicate transaction target ${resolved[index].relativePath}`);
    }
  }
  return resolved;
}

function resolveInsideRoot(rootDir: string, targetPath: string): string {
  const absolutePath = path.resolve(rootDir, targetPath);
  const relativePath = path.relative(rootDir, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new DesignTransactionError(`transaction target is outside rootDir: ${targetPath}`);
  }
  return absolutePath;
}

async function acquireLock(rootDir: string, force = false): Promise<LockHandle> {
  const transactionDirectory = path.join(rootDir, TRANSACTION_DIRECTORY);
  await mkdir(transactionDirectory, { recursive: true });
  const lockPath = path.join(transactionDirectory, LOCK_FILE);
  let file;
  try {
    file = await open(lockPath, "wx");
  } catch (error) {
    if (!isErrno(error, "EEXIST") || !force) throw new TransactionBusyError(rootDir);
    await unlink(lockPath);
    file = await open(lockPath, "wx");
  }
  await file.writeFile(
    JSON.stringify({ pid: process.pid, transactionStartedAt: new Date().toISOString() }) + "\n",
    "utf8",
  );
  await file.sync();
  return { file, path: lockPath, rootDir };
}

async function releaseLock(lock: LockHandle): Promise<void> {
  await lock.file.close();
  await removeIfPresent(lock.path);
  await syncDirectory(path.dirname(lock.path));
}

async function writeDurableFile(filePath: string, content: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  const file = await open(filePath, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(path.dirname(filePath));
}

async function writeJournal(journalPath: string, journal: Journal): Promise<void> {
  const temporaryPath = `${journalPath}.tmp-${randomUUID()}`;
  await writeDurableFile(temporaryPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, "utf8"));
  await rename(temporaryPath, journalPath);
  await syncDirectory(path.dirname(journalPath));
}

async function readJournal(journalPath: string, expectedId: string): Promise<Journal> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    throw new DesignTransactionError(`cannot read transaction journal ${journalPath}: ${error}`);
  }
  if (!isRecord(parsed) || parsed.version !== JOURNAL_VERSION || parsed.transactionId !== expectedId) {
    throw new DesignTransactionError(`invalid transaction journal ${journalPath}`);
  }
  if (
    parsed.state !== "preparing" &&
    parsed.state !== "prepared" &&
    parsed.state !== "committing" &&
    parsed.state !== "committed"
  ) {
    throw new DesignTransactionError(`invalid transaction state in ${journalPath}`);
  }
  if (!Array.isArray(parsed.targets) || !Array.isArray(parsed.completed)) {
    throw new DesignTransactionError(`invalid transaction targets in ${journalPath}`);
  }
  const targets: JournalTarget[] = [];
  for (const target of parsed.targets) {
    if (
      !isRecord(target) ||
      typeof target.path !== "string" ||
      (target.expectedDigest !== null && typeof target.expectedDigest !== "string") ||
      typeof target.postDigest !== "string" ||
      typeof target.stage !== "string"
    ) {
      throw new DesignTransactionError(`invalid transaction target in ${journalPath}`);
    }
    targets.push({
      path: target.path,
      expectedDigest: target.expectedDigest,
      postDigest: target.postDigest,
      stage: target.stage,
    });
  }
  const completed = parsed.completed.filter((value): value is number => Number.isInteger(value));
  return {
    version: JOURNAL_VERSION,
    transactionId: parsed.transactionId,
    state: parsed.state,
    targets,
    completed,
  };
}

async function validateRecoveryImages(rootDir: string, transactionDirectory: string, journal: Journal): Promise<void> {
  for (const target of journal.targets) {
    const targetPath = resolveInsideRoot(rootDir, target.path);
    const actualDigest = await digestFile(targetPath);
    if (actualDigest !== target.expectedDigest && actualDigest !== target.postDigest) {
      throw new TransactionConflictError(`target ${target.path} is neither its expected pre-image nor post-image`);
    }
    if (actualDigest === target.expectedDigest) {
      const stagePath = resolveInsideRoot(transactionDirectory, target.stage);
      if (!(await isPresent(stagePath)) || (await digestFile(stagePath)) !== target.postDigest) {
        throw new TransactionConflictError(`post-image for ${target.path} is unavailable for recovery`);
      }
    }
  }
}

async function verifyPostImages(rootDir: string, targets: readonly JournalTarget[]): Promise<void> {
  for (const target of targets) {
    const actualDigest = await digestFile(resolveInsideRoot(rootDir, target.path));
    if (actualDigest !== target.postDigest) {
      throw new TransactionConflictError(`target ${target.path} does not match its committed post-image`);
    }
  }
}

function selectPendingTransaction(
  pending: readonly PendingTransaction[],
  transactionId: string | undefined,
): PendingTransaction | undefined {
  if (transactionId !== undefined) {
    return pending.find((transaction) => transaction.transactionId === transactionId);
  }
  if (pending.length !== 1) {
    if (pending.length === 0) return undefined;
    throw new DesignTransactionError("multiple pending Design transactions require an explicit transactionId");
  }
  return pending[0];
}

async function removeTransactionDirectory(transactionDirectory: string): Promise<void> {
  await rm(transactionDirectory, { recursive: true, force: true });
  await syncDirectory(path.dirname(transactionDirectory));
}

async function digestFile(filePath: string): Promise<FileDigest | null> {
  try {
    return digestBytes(await readFile(filePath));
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

function digestBytes(bytes: Uint8Array): FileDigest {
  return createHash("sha256").update(bytes).digest("hex");
}

async function isPresent(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function addCompleted(completed: readonly number[], index: number): number[] {
  return [...new Set([...completed, index])].sort((left, right) => left - right);
}

async function invokeFaultInjector(injector: RenameFaultInjector | undefined, boundary: RenameBoundary): Promise<void> {
  await injector?.(boundary);
}

function assertTransactionId(transactionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(transactionId) || transactionId === "." || transactionId === "..") {
    throw new DesignTransactionError(`invalid transaction id: ${transactionId}`);
  }
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
