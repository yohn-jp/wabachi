import { assign, setup } from "xstate";

import type {
  CertificationEvidence,
  DesignChangeLifecycleState,
  DesignReviewEvidence,
  ImplementationLink,
} from "../contracts.js";
import type { Digest } from "../digest.js";

/** The resolved repository facts consumed by lifecycle guards. */
export interface DesignChangeLifecycleFacts {
  readonly changeId: string;
  readonly changeDigest: Digest;
  /** Immutable Git revision at which the proposal was resolved. */
  readonly proposalRevision?: string;
  readonly review?: DesignReviewEvidence;
  readonly implementations: readonly ImplementationLink[];
  readonly certification?: CertificationEvidence;
}

/** Input used to create an actor. `initialState` is useful when projecting a persisted record. */
export interface DesignChangeLifecycleInput extends DesignChangeLifecycleFacts {
  readonly initialState?: DesignChangeLifecycleState;
}

export interface LifecycleTransitionError {
  readonly code: "illegal-transition";
  readonly event: string;
}

export interface DesignChangeLifecycleContext extends DesignChangeLifecycleFacts {
  readonly lastError?: LifecycleTransitionError;
}

export type DesignChangeLifecycleEvent =
  | { readonly type: "SUBMIT_FOR_DESIGN_REVIEW" }
  | { readonly type: "DESIGN_REVIEW_APPROVED" }
  | { readonly type: "DESIGN_REVIEW_REWORK" }
  | { readonly type: "START_IMPLEMENTATION" }
  | { readonly type: "SUBMIT_FOR_CERTIFICATION" }
  | { readonly type: "CERTIFICATION_REWORK" }
  | { readonly type: "AMEND" }
  | { readonly type: "PROMOTE" };

export const DESIGN_CHANGE_LIFECYCLE_EVENT = {
  submitForDesignReview: "SUBMIT_FOR_DESIGN_REVIEW",
  designReviewApproved: "DESIGN_REVIEW_APPROVED",
  designReviewRework: "DESIGN_REVIEW_REWORK",
  startImplementation: "START_IMPLEMENTATION",
  submitForCertification: "SUBMIT_FOR_CERTIFICATION",
  certificationRework: "CERTIFICATION_REWORK",
  amend: "AMEND",
  promote: "PROMOTE",
} as const satisfies Record<string, DesignChangeLifecycleEvent["type"]>;

const emptyDigest = "" as Digest;

const defaultFacts: DesignChangeLifecycleFacts = {
  changeId: "",
  changeDigest: emptyDigest,
  implementations: [],
};

function factsFromInput(input: DesignChangeLifecycleInput | undefined): DesignChangeLifecycleContext {
  return {
    ...defaultFacts,
    ...input,
    lastError: undefined,
  };
}

function reviewMatches(context: DesignChangeLifecycleContext, decision: DesignReviewEvidence["decision"]): boolean {
  return (
    context.proposalRevision !== undefined &&
    context.review?.changeId === context.changeId &&
    context.review.proposalDigest === context.changeDigest &&
    context.review.proposalRevision === context.proposalRevision &&
    context.review.decision === decision
  );
}

function implementationMatches(context: DesignChangeLifecycleContext): boolean {
  return context.implementations.some(
    (implementation) =>
      implementation.changeId === context.changeId && implementation.changeDigest === context.changeDigest,
  );
}

function certificationMatches(context: DesignChangeLifecycleContext, result: CertificationEvidence["result"]): boolean {
  return (
    context.certification?.changeId === context.changeId &&
    context.certification.changeDigest === context.changeDigest &&
    context.certification.result === result
  );
}

const lifecycleSetup = setup({
  types: {
    context: {} as DesignChangeLifecycleContext,
    events: {} as DesignChangeLifecycleEvent,
    input: {} as DesignChangeLifecycleInput | undefined,
  },
  guards: {
    designReviewApproved: ({ context }) => reviewMatches(context, "approved"),
    designReviewNeedsRework: ({ context }) =>
      reviewMatches(context, "changes-requested") || reviewMatches(context, "rejected"),
    implementationLinked: ({ context }) => implementationMatches(context),
    certificationMatched: ({ context }) => implementationMatches(context) && certificationMatches(context, "match"),
    certificationNeedsRework: ({ context }) =>
      implementationMatches(context) &&
      (certificationMatches(context, "mismatch") || certificationMatches(context, "unresolved")),
  },
  actions: {
    clearError: assign({ lastError: () => undefined }),
    rejectIllegalTransition: assign({
      lastError: ({ event }) => ({ code: "illegal-transition", event: event.type }),
    }),
    invalidateEvidence: assign({
      review: () => undefined,
      implementations: () => [],
      certification: () => undefined,
      lastError: () => undefined,
    }),
  },
});

function definition(initial: DesignChangeLifecycleState) {
  return {
    id: "design-change-lifecycle",
    initial,
    context: ({ input }: { input: DesignChangeLifecycleInput | undefined }) => factsFromInput(input),
    states: {
      draft: {
        on: {
          SUBMIT_FOR_DESIGN_REVIEW: { target: "design-review", actions: "clearError" },
          AMEND: { target: "draft", actions: "invalidateEvidence" },
          "*": { actions: "rejectIllegalTransition" },
        },
      },
      "design-review": {
        on: {
          DESIGN_REVIEW_APPROVED: {
            target: "approved",
            guard: "designReviewApproved",
            actions: "clearError",
          },
          DESIGN_REVIEW_REWORK: {
            target: "draft",
            guard: "designReviewNeedsRework",
            actions: "clearError",
          },
          AMEND: { target: "draft", actions: "invalidateEvidence" },
          "*": { actions: "rejectIllegalTransition" },
        },
      },
      approved: {
        on: {
          START_IMPLEMENTATION: {
            target: "implementing",
            guard: "designReviewApproved",
            actions: "clearError",
          },
          AMEND: { target: "draft", actions: "invalidateEvidence" },
          "*": { actions: "rejectIllegalTransition" },
        },
      },
      implementing: {
        on: {
          SUBMIT_FOR_CERTIFICATION: {
            target: "certification-review",
            guard: "implementationLinked",
            actions: "clearError",
          },
          AMEND: { target: "draft", actions: "invalidateEvidence" },
          "*": { actions: "rejectIllegalTransition" },
        },
      },
      "certification-review": {
        on: {
          PROMOTE: {
            target: "promoted",
            guard: "certificationMatched",
            actions: "clearError",
          },
          CERTIFICATION_REWORK: {
            target: "implementing",
            guard: "certificationNeedsRework",
            actions: "clearError",
          },
          AMEND: { target: "draft", actions: "invalidateEvidence" },
          "*": { actions: "rejectIllegalTransition" },
        },
      },
      promoted: {
        on: {
          "*": { actions: "rejectIllegalTransition" },
        },
      },
    },
  } as const;
}

/**
 * Creates a lifecycle machine whose initial state is derived from repository state.
 * The machine itself only performs pure state transitions; persistence remains outside it.
 */
export function createDesignChangeLifecycleMachine(input?: DesignChangeLifecycleInput) {
  return lifecycleSetup.createMachine({
    ...definition(input?.initialState ?? "draft"),
    context: ({ input: actorInput }) => factsFromInput(actorInput ?? input),
  });
}

/** The default projection for a new Change Set, which starts in `draft`. */
export const designChangeLifecycleMachine = createDesignChangeLifecycleMachine();
