import {
  CANDIDATE_WORKING_SET_KIND,
  createCandidateWorkingSet,
  validateCandidateWorkingSet,
  type CandidateWorkingSet,
  type CandidateWorkingSetInput,
} from "./model.js";

function canonicalDocument(workingSet: CandidateWorkingSet): CandidateWorkingSet {
  return {
    kind: CANDIDATE_WORKING_SET_KIND,
    schemaVersion: workingSet.schemaVersion,
    workingSetId: workingSet.workingSetId,
    repository: {
      repositoryHost: workingSet.repository.repositoryHost,
      repositoryId: workingSet.repository.repositoryId,
      repository: workingSet.repository.repository,
    },
    revision: workingSet.revision,
    entries: workingSet.entries.map((entry) => ({
      state: entry.state,
      target: {
        kind: entry.target.kind,
        locator: entry.target.locator,
      },
      reason: {
        id: entry.reason.id,
        summary: entry.reason.summary,
      },
      evidence: entry.evidence.map((reference) => ({
        artifact: reference.artifact,
        reference: reference.reference,
      })),
    })),
  };
}

/** Deterministic JSON serialization of the canonical artifact shape. */
export function serializeCandidateWorkingSet(input: CandidateWorkingSetInput | CandidateWorkingSet): string {
  const workingSet = validateCandidateWorkingSet({
    ...createCandidateWorkingSet(input),
    schemaVersion: 1,
  });
  return JSON.stringify(canonicalDocument(workingSet));
}

/** Parses JSON and rejects malformed or unsupported artifacts before semantic use. */
export function parseCandidateWorkingSet(serialized: string): CandidateWorkingSet {
  if (typeof serialized !== "string") throw new TypeError("candidate working set serialization must be a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("candidate working set serialization is malformed");
  }
  return validateCandidateWorkingSet(parsed);
}

/** Alias for callers that need validation without parsing a JSON string. */
export const decodeCandidateWorkingSet = parseCandidateWorkingSet;
