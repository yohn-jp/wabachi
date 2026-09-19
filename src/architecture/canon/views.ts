import { normalizeIdentityId, type ObjectId } from "./identity.js";
import type {
  DeploymentInstanceId,
  DeploymentNodeId,
  InfrastructureReferenceId,
  RuntimeEnvironmentId,
} from "./deployment.js";
import type { FlowId } from "./flows.js";

declare const viewIdentityBrand: unique symbol;

/** A projection identity, deliberately separate from canonical object IDs. */
export type ViewId = string & { readonly [viewIdentityBrand]: never };
export type ViewKey = ViewId;

export const VIEW_KINDS = ["structural", "dynamic", "deployment"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_REFERENCE_KINDS = [
  "element",
  "relationship",
  "flow",
  "runtime-environment",
  "deployment-node",
  "deployment-instance",
  "infrastructure-reference",
] as const;
export type ViewReferenceKind = (typeof VIEW_REFERENCE_KINDS)[number];

export interface ViewReferenceInput {
  readonly kind: ViewReferenceKind;
  /** An opaque Canon identity; complete-document validation resolves it. */
  readonly id: string;
}

export type ViewReference =
  | { readonly kind: "element"; readonly id: ObjectId }
  | { readonly kind: "relationship"; readonly id: string }
  | { readonly kind: "flow"; readonly id: FlowId }
  | { readonly kind: "runtime-environment"; readonly id: RuntimeEnvironmentId }
  | { readonly kind: "deployment-node"; readonly id: DeploymentNodeId }
  | { readonly kind: "deployment-instance"; readonly id: DeploymentInstanceId }
  | { readonly kind: "infrastructure-reference"; readonly id: InfrastructureReferenceId };

export interface ViewScopeInput {
  readonly include?: readonly ViewReferenceInput[];
  readonly exclude?: readonly ViewReferenceInput[];
}

export interface ViewScope {
  readonly include: readonly ViewReference[];
  readonly exclude: readonly ViewReference[];
}

/** Renderer-neutral hints. They never participate in Canon identity or scope. */
export interface ViewPresentationHintsInput {
  readonly layout?: string;
  readonly direction?: string;
  readonly grouping?: string;
}

export interface ViewPresentationHints {
  readonly layout?: string;
  readonly direction?: string;
  readonly grouping?: string;
}

export interface ViewInput {
  readonly key: string;
  readonly kind: ViewKind;
  readonly scope: ViewScopeInput;
  readonly order?: number;
  readonly title?: string;
  readonly presentation?: ViewPresentationHintsInput;
}

export interface ViewSpec {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly scope: ViewScope;
  readonly order?: number;
  readonly title?: string;
  readonly presentation?: ViewPresentationHints;
}

export interface StructuralViewInput extends ViewInput {
  readonly kind: "structural";
}

export interface StructuralView extends ViewSpec {
  readonly kind: "structural";
}

export interface DynamicViewInput extends ViewInput {
  readonly kind: "dynamic";
}

export interface DynamicView extends ViewSpec {
  readonly kind: "dynamic";
}

export interface DeploymentViewInput extends ViewInput {
  readonly kind: "deployment";
}

export interface DeploymentView extends ViewSpec {
  readonly kind: "deployment";
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

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function readViewKind(value: unknown): ViewKind {
  if (typeof value !== "string" || !(VIEW_KINDS as readonly string[]).includes(value)) {
    throw new TypeError(`view kind is unsupported: ${String(value)}`);
  }
  return value as ViewKind;
}

function normalizeOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("view order must be a finite number");
  }
  return Object.is(value, -0) ? 0 : value;
}

function readReferenceKind(value: unknown): ViewReferenceKind {
  if (typeof value !== "string" || !(VIEW_REFERENCE_KINDS as readonly string[]).includes(value)) {
    throw new TypeError(`view reference kind is unsupported: ${String(value)}`);
  }
  return value as ViewReferenceKind;
}

function normalizeReference(input: unknown): ViewReference {
  assertRecord(input, "view reference");
  const kind = readReferenceKind(input.kind);
  const id = normalizeIdentityId(input.id as string);

  return Object.freeze({ kind, id }) as ViewReference;
}

function referenceKey(reference: ViewReference): string {
  return `${reference.kind}\u0000${reference.id}`;
}

function compareReferences(left: ViewReference, right: ViewReference): number {
  return compareOrdinal(referenceKey(left), referenceKey(right));
}

function normalizeReferenceList(value: unknown, label: "include" | "exclude"): readonly ViewReference[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError(`view scope ${label} must be an array`);
  }

  const references = value.map(normalizeReference);
  const seen = new Set<string>();
  for (const reference of references) {
    const key = referenceKey(reference);
    if (seen.has(key)) {
      throw new Error(`duplicate view ${label} reference: ${reference.kind} ${reference.id}`);
    }
    seen.add(key);
  }

  references.sort(compareReferences);
  return Object.freeze(references);
}

function normalizeScope(input: unknown): ViewScope {
  assertRecord(input, "view scope");
  const include = normalizeReferenceList(input.include, "include");
  const exclude = normalizeReferenceList(input.exclude, "exclude");
  const included = new Set(include.map(referenceKey));

  for (const reference of exclude) {
    if (included.has(referenceKey(reference))) {
      throw new Error(`view reference cannot be both included and excluded: ${reference.kind} ${reference.id}`);
    }
  }

  return Object.freeze({ include, exclude });
}

function normalizePresentation(value: unknown): ViewPresentationHints | undefined {
  if (value === undefined) return undefined;
  assertRecord(value, "view presentation");

  const layout = value.layout === undefined ? undefined : normalizeText(value.layout, "view presentation layout");
  const direction =
    value.direction === undefined ? undefined : normalizeText(value.direction, "view presentation direction");
  const grouping =
    value.grouping === undefined ? undefined : normalizeText(value.grouping, "view presentation grouping");

  if (layout === undefined && direction === undefined && grouping === undefined) {
    return Object.freeze({});
  }

  return Object.freeze({
    ...(layout === undefined ? {} : { layout }),
    ...(direction === undefined ? {} : { direction }),
    ...(grouping === undefined ? {} : { grouping }),
  });
}

function normalizeView(input: ViewInput): ViewSpec {
  assertRecord(input, "view");
  const key = normalizeIdentityId(input.key) as ViewKey;
  const kind = readViewKind(input.kind);
  const scope = normalizeScope(input.scope);
  const order = normalizeOrder(input.order);
  const title = input.title === undefined ? undefined : normalizeText(input.title, "view title");
  const presentation = normalizePresentation(input.presentation);

  return Object.freeze({
    key,
    kind,
    scope,
    ...(order === undefined ? {} : { order }),
    ...(title === undefined ? {} : { title }),
    ...(presentation === undefined ? {} : { presentation }),
  });
}

export function createView(input: ViewInput): ViewSpec {
  return normalizeView(input);
}

export function createStructuralView(input: StructuralViewInput): StructuralView {
  const view = normalizeView(input);
  if (view.kind !== "structural") {
    throw new TypeError("view kind must be structural");
  }
  return view as StructuralView;
}

export function createDynamicView(input: DynamicViewInput): DynamicView {
  const view = normalizeView(input);
  if (view.kind !== "dynamic") {
    throw new TypeError("view kind must be dynamic");
  }
  return view as DynamicView;
}

export function createDeploymentView(input: DeploymentViewInput): DeploymentView {
  const view = normalizeView(input);
  if (view.kind !== "deployment") {
    throw new TypeError("view kind must be deployment");
  }
  return view as DeploymentView;
}

function compareViews(left: ViewSpec, right: ViewSpec): number {
  if (left.order !== undefined || right.order !== undefined) {
    if (left.order === undefined) return 1;
    if (right.order === undefined) return -1;
    const order = left.order - right.order;
    if (order !== 0) return order;
  }
  return compareOrdinal(left.key, right.key);
}

/** Normalize view identity order without resolving references into architecture facts. */
export function normalizeViews(inputs: readonly ViewInput[]): readonly ViewSpec[] {
  if (!Array.isArray(inputs)) {
    throw new TypeError("views must be an array");
  }

  const views = inputs.map(normalizeView);
  const seen = new Set<string>();
  for (const view of views) {
    if (seen.has(view.key)) {
      throw new Error(`duplicate view key: ${view.key}`);
    }
    seen.add(view.key);
  }

  views.sort(compareViews);
  return Object.freeze(views);
}

export const createViews = normalizeViews;
