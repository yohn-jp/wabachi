import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createActor } from "xstate";
import { parseCanonicalArchitectureDocument } from "../architecture/canon/codec.js";
import type { ArchitectureDocumentV1 } from "../architecture/canon/document.js";
import { architectureCanonDigest } from "./change/diff.js";
import { DesignApplicationService, createDesignApplication } from "./application.js";
import type {
  CanonRevisionReference,
  CertificationEvidence,
  DesignChangeSet,
  DesignChangeLifecycleState,
  DesignIntentLifecycleRecord,
  MachineTransitionContext,
  MachineTransitionEvent,
  MachineTransitionRequest,
  MachineTransitionResult,
  RepositoryRevisionReference,
} from "./contracts.js";
import { parseImplementationLinks, serializeImplementationLinks } from "./linkage/codec.js";
import { createDesignChangeLifecycleMachine, type DesignChangeLifecycleEvent } from "./lifecycle/machine.js";
import { DesignPromotionService, type PromotionArtifact, type PromotionCurrentArtifact } from "./promotion/service.js";
import type { PromotionReceipt } from "./promotion/plan.js";
import {
  createDesignReviewHistory,
  parseDesignReviewHistory,
  recordDesignReviewEvidence,
  serializeDesignReviewHistory,
} from "./review/codec.js";
import {
  DesignReviewService,
  type DesignAmendmentTransaction,
  type DesignReviewTransaction,
  type ProposalRevisionReader,
} from "./review/service.js";
import { DesignStore } from "./storage/store.js";
import { assertNoPendingTransactions, recoverTransaction, type FileDigest } from "./storage/transaction.js";
import { createDesignRepositoryPaths, resolveRepositoryRoot } from "./storage/paths.js";
import type {
  DesignApplicationRecovery,
  DesignApplicationTransaction,
  DesignApplicationTransactionInput,
  DesignLifecycleMachinePort,
} from "./application.js";
import type { DesignIntentPorts, GitPort } from "./ports.js";
import { canonicalizeJson } from "./digest.js";
import { serializeDesignIntentLifecycleRecord, serializeStoredDesignChange } from "./storage/record-codec.js";
import type { PromotionStorePort } from "./promotion/service.js";

const execFileAsync = promisify(execFile);
const CANON_PATH = ".wabachi/architecture.json";

export interface DesignRuntimeOptions {
  readonly repositoryRoot?: string;
  readonly cwd?: string;
}

export interface DesignRuntime {
  readonly repositoryRoot: string;
  readonly ports: DesignIntentPorts;
  readonly application: DesignApplicationService;
}

interface StoredJson<T> {
  readonly value: T;
  readonly bytes: Uint8Array;
  readonly byteDigest: FileDigest;
}

function digestBytes(bytes: Uint8Array): FileDigest {
  return createHash("sha256").update(bytes).digest("hex");
}

function missing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function storedJson<T>(
  repositoryRoot: string,
  filePath: string,
  decode: (source: string) => T,
): Promise<StoredJson<T> | undefined> {
  await assertNoPendingTransactions(repositoryRoot);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  return { value: decode(bytes.toString("utf8")), bytes, byteDigest: digestBytes(bytes) };
}

async function git(repositoryRoot: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd: repositoryRoot, encoding: "utf8" });
  return String(result.stdout);
}

async function head(repositoryRoot: string): Promise<string> {
  return (await git(repositoryRoot, ["rev-parse", "HEAD"])).trim();
}

async function currentCanon(repositoryRoot: string): Promise<StoredJson<ArchitectureDocumentV1>> {
  const paths = createDesignRepositoryPaths(repositoryRoot, "runtime");
  const artifact = await storedJson(repositoryRoot, paths.canon, parseCanonicalArchitectureDocument);
  if (artifact === undefined) throw new Error(`Architecture Canon not found: ${paths.canon}`);
  return artifact;
}

function canonRevision(repositoryRevision: string, document: ArchitectureDocumentV1): CanonRevisionReference {
  return { repositoryRevision, canonVersion: document.canonVersion, canonDigest: architectureCanonDigest(document) };
}

function makeCanonPort(repositoryRoot: string) {
  return {
    async readCurrent() {
      const artifact = await currentCanon(repositoryRoot);
      const document = artifact.value;
      return { revision: canonRevision(await head(repositoryRoot), document), document };
    },
    async readAt(reference: CanonRevisionReference) {
      const source = await git(repositoryRoot, ["show", `${reference.repositoryRevision}:${CANON_PATH}`]);
      const document = parseCanonicalArchitectureDocument(source);
      const actual = architectureCanonDigest(document);
      if (actual !== reference.canonDigest || document.canonVersion !== reference.canonVersion) {
        throw new Error("requested Canon revision does not match its digest binding");
      }
      return document;
    },
  };
}

function makeGitPort(repositoryRoot: string): GitPort {
  return {
    async isAncestor(ancestor: RepositoryRevisionReference, descendant: RepositoryRevisionReference): Promise<boolean> {
      try {
        await git(repositoryRoot, ["merge-base", "--is-ancestor", ancestor.revision, descendant.revision]);
        return true;
      } catch (error) {
        if (error !== null && typeof error === "object" && "code" in error && error.code === 1) return false;
        throw error;
      }
    },
  };
}

function readPath(repositoryRoot: string, changeId: string, name: "reviews" | "implementations" | "certification") {
  return createDesignRepositoryPaths(repositoryRoot, changeId)[name];
}

function planJson(relativePath: string, current: StoredJson<unknown> | undefined, value: string) {
  return {
    path: relativePath,
    expectedDigest: current?.byteDigest ?? null,
    nextBytes: Buffer.from(value, "utf8"),
  };
}

function makePorts(repositoryRoot: string, store: DesignStore): DesignIntentPorts {
  return {
    canon: makeCanonPort(repositoryRoot),
    changes: {
      async apply(change, base) {
        const { applyDesignChange } = await import("./change/apply.js");
        return applyDesignChange(change, base);
      },
    },
    changeStore: store.changeStore,
    lifecycle: store.lifecycle,
    reviews: {
      async list(changeId) {
        const file = readPath(repositoryRoot, changeId, "reviews");
        const artifact = await storedJson(repositoryRoot, file, parseDesignReviewHistory);
        return artifact?.value.reviews.filter((review) => review.changeId === changeId) ?? [];
      },
      async record(evidence) {
        const file = readPath(repositoryRoot, evidence.changeId, "reviews");
        const paths = createDesignRepositoryPaths(repositoryRoot, evidence.changeId);
        const current = await storedJson(repositoryRoot, file, parseDesignReviewHistory);
        const history = recordDesignReviewEvidence(current?.value ?? createDesignReviewHistory(), evidence);
        await store.commit([planJson(paths.relative.reviews, current, serializeDesignReviewHistory(history))]);
      },
    },
    implementations: {
      async list(changeId) {
        const file = readPath(repositoryRoot, changeId, "implementations");
        const artifact = await storedJson(repositoryRoot, file, (source) => parseImplementationLinks(source));
        const change = await store.changeStore.read(changeId);
        return (
          artifact?.value.filter(
            (link) => link.changeId === changeId && (change === undefined || link.changeDigest === change.digest),
          ) ?? []
        );
      },
      async record(link) {
        const file = readPath(repositoryRoot, link.changeId, "implementations");
        const paths = createDesignRepositoryPaths(repositoryRoot, link.changeId);
        const current = await storedJson(repositoryRoot, file, (source) => parseImplementationLinks(source));
        const links = [...(current?.value ?? []), link];
        await store.commit([
          planJson(
            paths.relative.implementations,
            current,
            serializeImplementationLinks(links, { changeId: link.changeId, changeDigest: link.changeDigest }),
          ),
        ]);
      },
    },
    certification: {
      async read(changeId) {
        const file = readPath(repositoryRoot, changeId, "certification");
        const artifact = await storedJson(
          repositoryRoot,
          file,
          (source) => JSON.parse(source) as CertificationEvidence,
        );
        return artifact?.value;
      },
      async record(evidence) {
        const file = readPath(repositoryRoot, evidence.changeId, "certification");
        const paths = createDesignRepositoryPaths(repositoryRoot, evidence.changeId);
        const current = await storedJson(repositoryRoot, file, (source) => JSON.parse(source) as unknown);
        await store.commit([planJson(paths.relative.certification, current, canonicalizeJson(evidence))]);
      },
    },
  };
}

function makeMachine(): DesignLifecycleMachinePort {
  return {
    initialState: () => {
      const actor = createActor(createDesignChangeLifecycleMachine(), { input: undefined });
      actor.start();
      const state = actor.getSnapshot().value;
      actor.stop();
      if (typeof state !== "string") throw new Error("lifecycle machine returned a non-string initial state");
      return state as DesignChangeLifecycleState;
    },
    transition(
      requestOrState: MachineTransitionRequest | DesignChangeLifecycleState,
      event?: MachineTransitionEvent,
      context?: MachineTransitionContext,
    ): MachineTransitionResult {
      const request =
        typeof requestOrState === "object"
          ? requestOrState
          : {
              state: requestOrState,
              event: event as MachineTransitionEvent,
              context: context as MachineTransitionContext,
            };
      const input = {
        changeId: request.context.changeId,
        changeDigest: request.context.proposalDigest,
        ...(request.context.proposalRevision === undefined
          ? {}
          : { proposalRevision: request.context.proposalRevision }),
        ...(request.context.review === undefined ? {} : { review: request.context.review }),
        implementations: request.context.implementations,
        ...(request.context.certification === undefined ? {} : { certification: request.context.certification }),
        initialState: request.state,
      };
      const actor = createActor(createDesignChangeLifecycleMachine(input), { input });
      actor.start();
      actor.send(request.event as DesignChangeLifecycleEvent);
      const snapshot = actor.getSnapshot();
      actor.stop();
      if (snapshot.context.lastError !== undefined) {
        throw new Error(`illegal lifecycle transition: ${snapshot.context.lastError.event}`);
      }
      if (typeof snapshot.value !== "string") throw new Error("lifecycle machine returned a non-string state");
      return { state: snapshot.value as DesignChangeLifecycleState };
    },
  };
}

function makeRecovery(repositoryRoot: string): DesignApplicationRecovery {
  return {
    async recover(changeId) {
      return recoverTransaction(repositoryRoot, { ...(changeId === undefined ? {} : { transactionId: changeId }) });
    },
  };
}

function makePromotionStore(repositoryRoot: string, store: DesignStore): PromotionStorePort {
  return {
    async readCurrent(): Promise<PromotionCurrentArtifact> {
      const artifact = await currentCanon(repositoryRoot);
      const document = artifact.value;
      return {
        revision: canonRevision(await head(repositoryRoot), document),
        document,
        bytes: artifact.bytes,
      };
    },
    readChangeArtifact: (changeId) => store.changeStore.readChangeArtifact(changeId),
    readLifecycleArtifact: (changeId) => store.lifecycle.readLifecycleArtifact(changeId),
    async readReceiptArtifact(changeId): Promise<PromotionArtifact<PromotionReceipt> | undefined> {
      const paths = createDesignRepositoryPaths(repositoryRoot, changeId);
      const file = path.join(path.dirname(paths.lifecycle), "promotion-receipt.json");
      return storedJson(repositoryRoot, file, (source) => JSON.parse(source) as PromotionReceipt);
    },
    commit: (plans) => store.commit(plans),
    paths: (changeId) => {
      const paths = createDesignRepositoryPaths(repositoryRoot, changeId);
      return {
        currentCanon: paths.relative.canon,
        lifecycle: paths.relative.lifecycle,
        receipt: path.join(path.dirname(paths.relative.lifecycle), "promotion-receipt.json"),
      };
    },
  };
}

function makeTransaction(repositoryRoot: string, store: DesignStore): DesignApplicationTransaction {
  return {
    async commit(input: DesignApplicationTransactionInput): Promise<void> {
      const plans = [];
      if (input.implementation !== undefined) {
        const link = input.implementation;
        const paths = createDesignRepositoryPaths(repositoryRoot, link.changeId);
        const file = paths.implementations;
        const current = await storedJson(repositoryRoot, file, (source) => parseImplementationLinks(source));
        plans.push(
          planJson(
            paths.relative.implementations,
            current,
            serializeImplementationLinks([...(current?.value ?? []), link], {
              changeId: link.changeId,
              changeDigest: link.changeDigest,
            }),
          ),
        );
      }
      if (input.certification !== undefined) {
        const certification = input.certification;
        const paths = createDesignRepositoryPaths(repositoryRoot, certification.changeId);
        const file = paths.certification;
        const current = await storedJson(repositoryRoot, file, (source) => JSON.parse(source) as unknown);
        plans.push(planJson(paths.relative.certification, current, canonicalizeJson(certification)));
      }
      if (input.lifecycle !== undefined) {
        plans.push(await store.planLifecycleWrite(input.lifecycle));
      }
      if (input.change !== undefined) {
        plans.push(await store.planChangeWrite(input.change));
      }
      if (plans.length > 0) await store.commit(plans);
    },
  };
}

export async function createDesignRuntime(options: DesignRuntimeOptions = {}): Promise<DesignRuntime> {
  const repositoryRoot = options.repositoryRoot ?? (await resolveRepositoryRoot(options.cwd));
  const store = new DesignStore({ repositoryRoot });
  const ports = makePorts(repositoryRoot, store);
  const amendmentTransaction: DesignAmendmentTransaction = {
    async commit(change, lifecycle, event) {
      const paths = createDesignRepositoryPaths(repositoryRoot, change.changeId);
      const eventPath = path.join(path.dirname(paths.lifecycle), "events.json");
      const current = await storedJson(repositoryRoot, eventPath, (source) => JSON.parse(source) as readonly unknown[]);
      const events = [...(current?.value ?? []), event];
      await store.commit([
        await store.planChangeWrite(change),
        await store.planLifecycleWrite(lifecycle),
        planJson(path.join(path.dirname(paths.relative.lifecycle), "events.json"), current, canonicalizeJson(events)),
      ]);
    },
  };
  const reviewTransaction: DesignReviewTransaction = {
    async commit(evidence, lifecycle) {
      const paths = createDesignRepositoryPaths(repositoryRoot, evidence.changeId);
      const current = await storedJson(repositoryRoot, paths.reviews, parseDesignReviewHistory);
      const history = recordDesignReviewEvidence(current?.value ?? createDesignReviewHistory(), evidence);
      await store.commit([
        planJson(paths.relative.reviews, current, serializeDesignReviewHistory(history)),
        await store.planLifecycleWrite(lifecycle),
      ]);
    },
  };
  const proposalRevisions: ProposalRevisionReader = {
    async read(changeId, revision) {
      const relative = createDesignRepositoryPaths(repositoryRoot, changeId).relative.change;
      try {
        return JSON.parse(await git(repositoryRoot, ["show", `${revision}:${relative}`])) as DesignChangeSet;
      } catch {
        return undefined;
      }
    },
  };
  const review = new DesignReviewService(ports, { proposalRevisions, amendmentTransaction, reviewTransaction });
  const promotion = new DesignPromotionService(makePromotionStore(repositoryRoot, store));
  const application = createDesignApplication(ports, {
    review,
    amendmentTransaction,
    transaction: makeTransaction(repositoryRoot, store),
    promotion,
    recovery: makeRecovery(repositoryRoot),
    git: makeGitPort(repositoryRoot),
    machine: makeMachine(),
  });
  return { repositoryRoot, ports, application };
}

export const createProductionDesignRuntime = createDesignRuntime;
