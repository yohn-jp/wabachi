import type { ArchitectureDocumentV1, GlobalIdentityNamespace, GlobalIdentityEntry } from "./document.js";
import { validateCodeIntentContract } from "./code-intent-validation.js";

const REGISTRY_NAMESPACES = [
  "architecture",
  "element",
  "interface",
  "responsibility",
  "boundary",
  "flow",
  "decision",
  "reference",
  "code-intent",
] as const satisfies readonly GlobalIdentityNamespace[];

const TARGET_NAMESPACES = [
  "architecture",
  "element",
  "interface",
  "responsibility",
  "boundary",
  "flow",
  "decision",
  "code-intent",
] as const satisfies readonly GlobalIdentityNamespace[];

export const ARCHITECTURE_DIAGNOSTIC_CODES = [
  "identity-registry-mismatch",
  "duplicate-identity-registry-entry",
  "unknown-reference",
  "invalid-reference-kind",
  "invalid-containment-reference",
  "invalid-interface-owner",
  "invalid-relationship-endpoint",
  "invalid-relationship-interface",
  "invalid-responsibility-target",
  "invalid-boundary-member",
  "invalid-authority-target",
  "invalid-constraint-target",
  "invalid-single-authority",
  "invalid-flow-reference",
  "invalid-deployment-reference",
  "invalid-repository-mapping",
  "invalid-decision-target",
  "invalid-decision-reference",
  "invalid-supersession",
  "invalid-view-reference",
  "invalid-view-root",
  "invalid-code-intent",
  "unknown-code-intent-owner",
  "unknown-code-intent-responsibility",
  "unknown-code-intent-decision",
  "unknown-code-intent-source-mapping",
] as const;

export type ArchitectureDiagnosticCode = (typeof ARCHITECTURE_DIAGNOSTIC_CODES)[number];

export interface ArchitectureDiagnostic {
  readonly code: ArchitectureDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface ArchitectureDocumentValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly ArchitectureDiagnostic[];
}

type KnownTargetNamespace = (typeof TARGET_NAMESPACES)[number];

interface CanonIndex {
  readonly registry: ReadonlyMap<string, string>;
  readonly architectureIds: ReadonlySet<string>;
  readonly elementIds: ReadonlySet<string>;
  readonly interfaceIds: ReadonlySet<string>;
  readonly responsibilityIds: ReadonlySet<string>;
  readonly boundaryIds: ReadonlySet<string>;
  readonly flowIds: ReadonlySet<string>;
  readonly decisionIds: ReadonlySet<string>;
  readonly referenceIds: ReadonlySet<string>;
  readonly codeIntentIds: ReadonlySet<string>;
  readonly runtimeEnvironmentIds: ReadonlySet<string>;
  readonly deploymentNodeIds: ReadonlySet<string>;
  readonly deploymentInstanceIds: ReadonlySet<string>;
  readonly infrastructureReferenceIds: ReadonlySet<string>;
  readonly relationshipIds: ReadonlySet<string>;
}

class DiagnosticCollector {
  private readonly values: ArchitectureDiagnostic[] = [];
  private readonly keys = new Set<string>();

  add(code: ArchitectureDiagnosticCode, path: string, message: string): void {
    const key = `${code}\u0000${path}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.values.push(Object.freeze({ code, path, message }));
  }

  finish(): ArchitectureDocumentValidationResult {
    const diagnostics = Object.freeze([...this.values]);
    return Object.freeze({ valid: diagnostics.length === 0, diagnostics });
  }
}

function setOf<T>(values: readonly T[], read: (value: T) => string): ReadonlySet<string> {
  return new Set(values.map(read));
}

function expectedRegistry(document: ArchitectureDocumentV1): ReadonlyMap<string, GlobalIdentityNamespace> {
  const expected = new Map<string, GlobalIdentityNamespace>();
  expected.set(document.root.id, "architecture");
  for (const element of document.elements) expected.set(element.id, "element");
  for (const contract of document.interfaces) expected.set(contract.id, "interface");
  for (const responsibility of document.responsibilities.responsibilities) {
    expected.set(responsibility.id, "responsibility");
  }
  for (const boundary of document.boundaries) expected.set(boundary.id, "boundary");
  for (const flow of document.flows) expected.set(flow.id, "flow");
  for (const decision of document.decisions.decisions) expected.set(decision.id, "decision");
  for (const reference of document.decisions.references) expected.set(reference.id, "reference");
  for (const intent of document.codeIntents?.entries ?? []) expected.set(intent.id, "code-intent");
  return expected;
}

function readRegistry(document: ArchitectureDocumentV1, diagnostics: DiagnosticCollector): ReadonlyMap<string, string> {
  const registry = new Map<string, string>();
  const entries = document.globalIdentityRegistry.entries;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as GlobalIdentityEntry;
    const path = `globalIdentityRegistry.entries[${index}]`;
    if (!REGISTRY_NAMESPACES.includes(entry.namespace as GlobalIdentityNamespace)) {
      diagnostics.add(
        "identity-registry-mismatch",
        path,
        `identity registry entry has unsupported namespace: ${String(entry.namespace)}`,
      );
      continue;
    }
    if (registry.has(entry.id)) {
      diagnostics.add(
        "duplicate-identity-registry-entry",
        path,
        `identity registry contains duplicate id: ${entry.id}`,
      );
      continue;
    }
    registry.set(entry.id, entry.namespace);
  }

  const expected = expectedRegistry(document);
  for (const [id, namespace] of expected) {
    if (registry.get(id) !== namespace) {
      diagnostics.add(
        "identity-registry-mismatch",
        "globalIdentityRegistry.entries",
        `identity registry does not contain ${namespace} identity: ${id}`,
      );
    }
  }
  for (const [id, namespace] of registry) {
    if (expected.get(id) !== namespace) {
      diagnostics.add(
        "identity-registry-mismatch",
        "globalIdentityRegistry.entries",
        `identity registry contains an identity not owned by its section: ${id}`,
      );
    }
  }

  return registry;
}

function createIndex(document: ArchitectureDocumentV1, registry: ReadonlyMap<string, string>): CanonIndex {
  return {
    registry,
    architectureIds: new Set([document.root.id]),
    elementIds: setOf(document.elements, (element) => element.id),
    interfaceIds: setOf(document.interfaces, (contract) => contract.id),
    responsibilityIds: setOf(document.responsibilities.responsibilities, (responsibility) => responsibility.id),
    boundaryIds: setOf(document.boundaries, (boundary) => boundary.id),
    flowIds: setOf(document.flows, (flow) => flow.id),
    decisionIds: setOf(document.decisions.decisions, (decision) => decision.id),
    referenceIds: setOf(document.decisions.references, (reference) => reference.id),
    codeIntentIds: setOf(document.codeIntents?.entries ?? [], (intent) => intent.id),
    runtimeEnvironmentIds: setOf(document.deployment.runtimeEnvironments, (environment) => environment.id),
    deploymentNodeIds: setOf(document.deployment.deploymentNodes, (node) => node.id),
    deploymentInstanceIds: setOf(document.deployment.deploymentInstances, (instance) => instance.id),
    infrastructureReferenceIds: setOf(document.deployment.infrastructureReferences, (reference) => reference.id),
    // RelationshipRecord has no identity field. References are therefore only
    // resolvable for explicitly identity-bearing records supplied at runtime;
    // the canonical relationship shape otherwise fails closed.
    relationshipIds: new Set(
      document.relationships.flatMap((relationship) => {
        const candidate = relationship as unknown as { readonly id?: unknown };
        return typeof candidate.id === "string" ? [candidate.id] : [];
      }),
    ),
  };
}

function sectionIds(index: CanonIndex, namespace: GlobalIdentityNamespace): ReadonlySet<string> {
  switch (namespace) {
    case "architecture":
      return index.architectureIds;
    case "element":
      return index.elementIds;
    case "interface":
      return index.interfaceIds;
    case "responsibility":
      return index.responsibilityIds;
    case "boundary":
      return index.boundaryIds;
    case "flow":
      return index.flowIds;
    case "decision":
      return index.decisionIds;
    case "reference":
      return index.referenceIds;
    case "code-intent":
      return index.codeIntentIds;
  }
}

function hasIdentity(index: CanonIndex, namespace: GlobalIdentityNamespace, id: string): boolean {
  return index.registry.get(id) === namespace && sectionIds(index, namespace).has(id);
}

function validateIdentityReference(
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
  path: string,
  id: string,
  namespace: GlobalIdentityNamespace,
  code: ArchitectureDiagnosticCode,
  label: string,
): boolean {
  const registeredNamespace = index.registry.get(id);
  if (registeredNamespace === undefined) {
    diagnostics.add(code, path, `${label} references unknown ${namespace}: ${id}`);
    return false;
  }
  if (registeredNamespace !== namespace) {
    diagnostics.add(
      "invalid-reference-kind",
      path,
      `${label} references ${id} as ${namespace}, but it is ${registeredNamespace}`,
    );
    return false;
  }
  if (!sectionIds(index, namespace).has(id)) {
    diagnostics.add(code, path, `${label} references an identity missing from its section: ${id}`);
    return false;
  }
  return true;
}

function validateTargetIdentity(
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
  path: string,
  id: string,
  label: string,
  code: ArchitectureDiagnosticCode,
): boolean {
  const namespace = index.registry.get(id);
  if (namespace === undefined || !TARGET_NAMESPACES.includes(namespace as KnownTargetNamespace)) {
    diagnostics.add(code, path, `${label} references an ineligible or unknown Canon identity: ${id}`);
    return false;
  }
  if (!hasIdentity(index, namespace as KnownTargetNamespace, id)) {
    diagnostics.add(code, path, `${label} references an identity missing from its section: ${id}`);
    return false;
  }
  return true;
}

function validateContainment(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let indexInSection = 0; indexInSection < document.elements.length; indexInSection += 1) {
    const element = document.elements[indexInSection];
    if (element.parentId !== undefined) {
      validateIdentityReference(
        index,
        diagnostics,
        `elements[${indexInSection}].parentId`,
        element.parentId,
        "element",
        "invalid-containment-reference",
        "element parent",
      );
    }
  }
}

function validateRelationships(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let indexInSection = 0; indexInSection < document.interfaces.length; indexInSection += 1) {
    const contract = document.interfaces[indexInSection];
    validateIdentityReference(
      index,
      diagnostics,
      `interfaces[${indexInSection}].owner`,
      contract.owner,
      "element",
      "invalid-interface-owner",
      "interface owner",
    );
  }

  for (let indexInSection = 0; indexInSection < document.relationships.length; indexInSection += 1) {
    const relationship = document.relationships[indexInSection];
    validateIdentityReference(
      index,
      diagnostics,
      `relationships[${indexInSection}].source`,
      relationship.source,
      "element",
      "invalid-relationship-endpoint",
      "relationship source",
    );
    validateIdentityReference(
      index,
      diagnostics,
      `relationships[${indexInSection}].target`,
      relationship.target,
      "element",
      "invalid-relationship-endpoint",
      "relationship target",
    );

    if (relationship.interfaceId !== undefined) {
      const knownInterface = validateIdentityReference(
        index,
        diagnostics,
        `relationships[${indexInSection}].interfaceId`,
        relationship.interfaceId,
        "interface",
        "invalid-relationship-interface",
        "relationship interface",
      );
      const contract = document.interfaces.find((candidate) => candidate.id === relationship.interfaceId);
      if (
        knownInterface &&
        contract !== undefined &&
        contract.owner !== relationship.source &&
        contract.owner !== relationship.target
      ) {
        diagnostics.add(
          "invalid-interface-owner",
          `relationships[${indexInSection}].interfaceId`,
          `relationship interface owner is not an endpoint: ${relationship.interfaceId}`,
        );
      }
    }
  }
}

function validateResponsibilities(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (
    let indexInSection = 0;
    indexInSection < document.responsibilities.responsibilities.length;
    indexInSection += 1
  ) {
    const responsibility = document.responsibilities.responsibilities[indexInSection];
    const path = `responsibilities.responsibilities[${indexInSection}].target.id`;
    if (responsibility.target.kind === "architecture") {
      validateIdentityReference(
        index,
        diagnostics,
        path,
        responsibility.target.id,
        "architecture",
        "invalid-responsibility-target",
        "responsibility target",
      );
    } else {
      validateIdentityReference(
        index,
        diagnostics,
        path,
        responsibility.target.id,
        "element",
        "invalid-responsibility-target",
        "responsibility target",
      );
    }
  }
}

function validateBoundaries(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let boundaryIndex = 0; boundaryIndex < document.boundaries.length; boundaryIndex += 1) {
    const boundary = document.boundaries[boundaryIndex];
    for (let memberIndex = 0; memberIndex < boundary.memberIds.length; memberIndex += 1) {
      validateIdentityReference(
        index,
        diagnostics,
        `boundaries[${boundaryIndex}].memberIds[${memberIndex}]`,
        boundary.memberIds[memberIndex],
        "element",
        "invalid-boundary-member",
        "boundary member",
      );
    }
  }
}

function validateAuthorityAndConstraints(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let factIndex = 0; factIndex < document.authority.authority.length; factIndex += 1) {
    const fact = document.authority.authority[factIndex];
    validateIdentityReference(
      index,
      diagnostics,
      `authority.authority[${factIndex}].concern`,
      fact.concern,
      "element",
      "invalid-authority-target",
      "authority concern",
    );
    validateIdentityReference(
      index,
      diagnostics,
      `authority.authority[${factIndex}].owner`,
      fact.owner,
      "element",
      "invalid-authority-target",
      "authority owner",
    );
  }
  for (let factIndex = 0; factIndex < document.authority.ownership.length; factIndex += 1) {
    const fact = document.authority.ownership[factIndex];
    validateIdentityReference(
      index,
      diagnostics,
      `authority.ownership[${factIndex}].resource`,
      fact.resource,
      "element",
      "invalid-authority-target",
      "ownership resource",
    );
    validateIdentityReference(
      index,
      diagnostics,
      `authority.ownership[${factIndex}].owner`,
      fact.owner,
      "element",
      "invalid-authority-target",
      "ownership owner",
    );
  }

  for (let constraintIndex = 0; constraintIndex < document.constraints.length; constraintIndex += 1) {
    const constraint = document.constraints[constraintIndex];
    const path = `constraints[${constraintIndex}]`;
    if (constraint.kind === "single-authority") {
      const validConcern = validateIdentityReference(
        index,
        diagnostics,
        `${path}.concern`,
        constraint.concern,
        "element",
        "invalid-constraint-target",
        "constraint concern",
      );
      if (validConcern) {
        const owners = new Set(
          document.authority.authority.filter((fact) => fact.concern === constraint.concern).map((fact) => fact.owner),
        );
        if (owners.size !== 1) {
          diagnostics.add(
            "invalid-single-authority",
            path,
            `single-authority constraint requires exactly one authority owner for concern: ${constraint.concern}; found ${owners.size}`,
          );
        }
      }
    } else {
      validateIdentityReference(
        index,
        diagnostics,
        `${path}.source`,
        constraint.source,
        "element",
        "invalid-constraint-target",
        "constraint source",
      );
      validateIdentityReference(
        index,
        diagnostics,
        `${path}.target`,
        constraint.target,
        "element",
        "invalid-constraint-target",
        "constraint target",
      );
      if (constraint.kind === "must-go-through") {
        validateIdentityReference(
          index,
          diagnostics,
          `${path}.through`,
          constraint.through,
          "element",
          "invalid-constraint-target",
          "constraint through target",
        );
      }
    }
  }
}

function validateFlows(document: ArchitectureDocumentV1, index: CanonIndex, diagnostics: DiagnosticCollector): void {
  for (let flowIndex = 0; flowIndex < document.flows.length; flowIndex += 1) {
    const flow = document.flows[flowIndex];
    for (let stepIndex = 0; stepIndex < flow.steps.length; stepIndex += 1) {
      const step = flow.steps[stepIndex];
      if (step.relationshipId !== undefined && !index.relationshipIds.has(step.relationshipId)) {
        diagnostics.add(
          "invalid-flow-reference",
          `flows[${flowIndex}].steps[${stepIndex}].relationshipId`,
          `flow step references an unknown relationship: ${step.relationshipId}`,
        );
      }
      if (step.interfaceId !== undefined) {
        validateIdentityReference(
          index,
          diagnostics,
          `flows[${flowIndex}].steps[${stepIndex}].interfaceId`,
          step.interfaceId,
          "interface",
          "invalid-flow-reference",
          "flow step",
        );
      }
    }
  }
}

function validateDeployment(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let nodeIndex = 0; nodeIndex < document.deployment.deploymentNodes.length; nodeIndex += 1) {
    const node = document.deployment.deploymentNodes[nodeIndex];
    if (!index.runtimeEnvironmentIds.has(node.environmentId)) {
      diagnostics.add(
        "invalid-deployment-reference",
        `deployment.deploymentNodes[${nodeIndex}].environmentId`,
        `deployment node references an unknown runtime environment: ${node.environmentId}`,
      );
    }
  }
  for (let instanceIndex = 0; instanceIndex < document.deployment.deploymentInstances.length; instanceIndex += 1) {
    const instance = document.deployment.deploymentInstances[instanceIndex];
    if (!index.deploymentNodeIds.has(instance.nodeId)) {
      diagnostics.add(
        "invalid-deployment-reference",
        `deployment.deploymentInstances[${instanceIndex}].nodeId`,
        `deployment instance references an unknown deployment node: ${instance.nodeId}`,
      );
    }
  }
  for (let mappingIndex = 0; mappingIndex < document.deployment.mappings.length; mappingIndex += 1) {
    const mapping = document.deployment.mappings[mappingIndex];
    validateIdentityReference(
      index,
      diagnostics,
      `deployment.mappings[${mappingIndex}].softwareElementId`,
      mapping.softwareElementId,
      "element",
      "invalid-deployment-reference",
      "deployment mapping",
    );
    if (!index.deploymentInstanceIds.has(mapping.deploymentInstanceId)) {
      diagnostics.add(
        "invalid-deployment-reference",
        `deployment.mappings[${mappingIndex}].deploymentInstanceId`,
        `deployment mapping references an unknown deployment instance: ${mapping.deploymentInstanceId}`,
      );
    }
  }
}

function validateRepositoryMappings(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let mappingIndex = 0; mappingIndex < document.repositoryMappings.length; mappingIndex += 1) {
    const mapping = document.repositoryMappings[mappingIndex];
    validateTargetIdentity(
      index,
      diagnostics,
      `repositoryMappings[${mappingIndex}].canonId`,
      mapping.canonId,
      "repository mapping",
      "invalid-repository-mapping",
    );
  }
}

function validateCodeIntents(document: ArchitectureDocumentV1, diagnostics: DiagnosticCollector): void {
  if (document.codeIntents === undefined) return;
  const result = validateCodeIntentContract(document.codeIntents, document);
  for (const diagnostic of result.diagnostics) {
    diagnostics.add(diagnostic.code, `codeIntents.${diagnostic.path}`, diagnostic.message);
  }
}

function validateDecisions(
  document: ArchitectureDocumentV1,
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
): void {
  for (let decisionIndex = 0; decisionIndex < document.decisions.decisions.length; decisionIndex += 1) {
    const decision = document.decisions.decisions[decisionIndex];
    for (let targetIndex = 0; targetIndex < decision.targetIds.length; targetIndex += 1) {
      validateTargetIdentity(
        index,
        diagnostics,
        `decisions.decisions[${decisionIndex}].targetIds[${targetIndex}]`,
        decision.targetIds[targetIndex],
        "decision target",
        "invalid-decision-target",
      );
    }
    for (let referenceIndex = 0; referenceIndex < decision.referenceIds.length; referenceIndex += 1) {
      validateIdentityReference(
        index,
        diagnostics,
        `decisions.decisions[${decisionIndex}].referenceIds[${referenceIndex}]`,
        decision.referenceIds[referenceIndex],
        "reference",
        "invalid-decision-reference",
        "decision",
      );
    }
    for (let supersededIndex = 0; supersededIndex < decision.supersedes.length; supersededIndex += 1) {
      validateIdentityReference(
        index,
        diagnostics,
        `decisions.decisions[${decisionIndex}].supersedes[${supersededIndex}]`,
        decision.supersedes[supersededIndex],
        "decision",
        "invalid-supersession",
        "decision supersession",
      );
    }
  }

  for (
    let attachmentIndex = 0;
    attachmentIndex < document.decisions.referenceAttachments.length;
    attachmentIndex += 1
  ) {
    const attachment = document.decisions.referenceAttachments[attachmentIndex];
    if (attachment.targetId !== document.documentId) {
      validateTargetIdentity(
        index,
        diagnostics,
        `decisions.referenceAttachments[${attachmentIndex}].targetId`,
        attachment.targetId,
        "reference attachment target",
        "invalid-decision-target",
      );
    }
    for (let referenceIndex = 0; referenceIndex < attachment.referenceIds.length; referenceIndex += 1) {
      validateIdentityReference(
        index,
        diagnostics,
        `decisions.referenceAttachments[${attachmentIndex}].referenceIds[${referenceIndex}]`,
        attachment.referenceIds[referenceIndex],
        "reference",
        "invalid-decision-reference",
        "reference attachment",
      );
    }
  }
}

function validateViewReference(
  index: CanonIndex,
  diagnostics: DiagnosticCollector,
  path: string,
  kind: string,
  id: string,
): void {
  switch (kind) {
    case "element":
      validateIdentityReference(index, diagnostics, path, id, "element", "invalid-view-reference", "view");
      return;
    case "flow":
      validateIdentityReference(index, diagnostics, path, id, "flow", "invalid-view-reference", "view");
      return;
    case "relationship":
      if (!index.relationshipIds.has(id)) {
        diagnostics.add("invalid-view-reference", path, `view references an unknown relationship: ${id}`);
      }
      return;
    case "runtime-environment":
      if (!index.runtimeEnvironmentIds.has(id)) {
        diagnostics.add("invalid-view-reference", path, `view references an unknown runtime environment: ${id}`);
      }
      return;
    case "deployment-node":
      if (!index.deploymentNodeIds.has(id)) {
        diagnostics.add("invalid-view-reference", path, `view references an unknown deployment node: ${id}`);
      }
      return;
    case "deployment-instance":
      if (!index.deploymentInstanceIds.has(id)) {
        diagnostics.add("invalid-view-reference", path, `view references an unknown deployment instance: ${id}`);
      }
      return;
    case "infrastructure-reference":
      if (!index.infrastructureReferenceIds.has(id)) {
        diagnostics.add("invalid-view-reference", path, `view references an unknown infrastructure reference: ${id}`);
      }
      return;
    default:
      diagnostics.add("invalid-view-reference", path, `view references an unsupported kind: ${kind}`);
  }
}

function validateViews(document: ArchitectureDocumentV1, index: CanonIndex, diagnostics: DiagnosticCollector): void {
  for (let viewIndex = 0; viewIndex < document.views.length; viewIndex += 1) {
    const view = document.views[viewIndex];
    if (view.root !== undefined) {
      const path = `views[${viewIndex}].root`;
      if (view.root.kind === "element") {
        if (!index.elementIds.has(view.root.id)) {
          diagnostics.add("invalid-view-root", path, `view root references an unknown element: ${view.root.id}`);
        } else if (view.kind === "deployment") {
          diagnostics.add(
            "invalid-view-root",
            path,
            `deployment view root must reference a runtime environment, not element ${view.root.id}`,
          );
        }
      } else if (view.root.kind === "runtime-environment") {
        if (!index.runtimeEnvironmentIds.has(view.root.id)) {
          diagnostics.add(
            "invalid-view-root",
            path,
            `view root references an unknown runtime environment: ${view.root.id}`,
          );
        } else if (view.kind !== "deployment") {
          diagnostics.add(
            "invalid-view-root",
            path,
            `${view.kind} view root must reference an element, not runtime environment ${view.root.id}`,
          );
        }
      } else {
        diagnostics.add("invalid-view-root", path, `${view.kind} view root kind is incompatible: ${view.root.kind}`);
      }

      for (let referenceIndex = 0; referenceIndex < view.scope.exclude.length; referenceIndex += 1) {
        const reference = view.scope.exclude[referenceIndex];
        if (reference.kind === view.root.kind && reference.id === view.root.id) {
          diagnostics.add(
            "invalid-view-root",
            `views[${viewIndex}].scope.exclude[${referenceIndex}]`,
            `view root cannot be excluded: ${view.root.kind} ${view.root.id}`,
          );
        }
      }
    }
    for (let referenceIndex = 0; referenceIndex < view.scope.include.length; referenceIndex += 1) {
      const reference = view.scope.include[referenceIndex];
      validateViewReference(
        index,
        diagnostics,
        `views[${viewIndex}].scope.include[${referenceIndex}]`,
        reference.kind,
        reference.id,
      );
    }
    for (let referenceIndex = 0; referenceIndex < view.scope.exclude.length; referenceIndex += 1) {
      const reference = view.scope.exclude[referenceIndex];
      validateViewReference(
        index,
        diagnostics,
        `views[${viewIndex}].scope.exclude[${referenceIndex}]`,
        reference.kind,
        reference.id,
      );
    }
  }
}

/** Validate complete-document Canon semantics without mutating the document. */
export function validateArchitectureDocument(document: ArchitectureDocumentV1): ArchitectureDocumentValidationResult {
  const diagnostics = new DiagnosticCollector();
  const registry = readRegistry(document, diagnostics);
  const index = createIndex(document, registry);

  validateContainment(document, index, diagnostics);
  validateRelationships(document, index, diagnostics);
  validateResponsibilities(document, index, diagnostics);
  validateBoundaries(document, index, diagnostics);
  validateAuthorityAndConstraints(document, index, diagnostics);
  validateFlows(document, index, diagnostics);
  validateDeployment(document, index, diagnostics);
  validateRepositoryMappings(document, index, diagnostics);
  validateCodeIntents(document, diagnostics);
  validateDecisions(document, index, diagnostics);
  validateViews(document, index, diagnostics);

  return diagnostics.finish();
}
