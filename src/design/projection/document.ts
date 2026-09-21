import { projectArchitectureDocument } from "../../architecture/documentation/project.js";
import type { DocumentationModel } from "../../architecture/documentation/model.js";
import type { DesignIntentCanonView, DesignIntentLifecycleRecord } from "../contracts.js";

export interface DesignIntentDocumentationInput {
  readonly view: DesignIntentCanonView;
  readonly lifecycle?: DesignIntentLifecycleRecord;
}

function attachContext(
  current: DocumentationModel,
  proposed: DocumentationModel | undefined,
  lifecycle: DesignIntentLifecycleRecord | undefined,
): DocumentationModel {
  if (proposed === undefined && lifecycle === undefined) return current;

  return Object.freeze({
    ...current,
    designIntent: Object.freeze({
      ...(proposed === undefined ? {} : { proposed }),
      ...(lifecycle === undefined ? {} : { lifecycle }),
    }),
  });
}

/**
 * Project a Design Intent view into one read-only documentation model.
 *
 * Current and proposed Canons are projected independently. Lifecycle facts are
 * carried as evidence context and never become Architecture Canon sections.
 */
export function projectDesignIntentDocumentation(
  view: DesignIntentCanonView,
  lifecycle?: DesignIntentLifecycleRecord,
): DocumentationModel {
  const current = projectArchitectureDocument(view.current, { codeIntent: view.codeIntent });
  const proposed =
    view.proposed === undefined
      ? undefined
      : projectArchitectureDocument(view.proposed, { codeIntent: view.codeIntent });
  return attachContext(current, proposed, lifecycle);
}

/** Object-form adapter for callers that already have a named read context. */
export function projectDesignIntentDocument(input: DesignIntentDocumentationInput): DocumentationModel {
  return projectDesignIntentDocumentation(input.view, input.lifecycle);
}

/** Descriptive alias for consumers that use the Canon-view terminology. */
export const projectDocumentation = projectDesignIntentDocumentation;
