export interface CodeIntentStatement {
  readonly id: string;
  readonly text: string;
}

/** A provider-neutral obligation associated with one invariant or prohibition statement. */
export interface CodeIntentVerificationObligation {
  readonly id: string;
  readonly statementId: string;
  readonly mode: string;
  readonly predicate: string;
}

/** Canon-owned source-level intent that reuses existing Canon identities and mappings. */
export interface CodeIntent {
  readonly id: string;
  readonly ownerId: string;
  readonly responsibilityIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly invariants: readonly CodeIntentStatement[];
  readonly prohibitions: readonly CodeIntentStatement[];
  readonly verificationObligations: readonly CodeIntentVerificationObligation[];
}

export interface CodeIntentContract {
  readonly entries: readonly CodeIntent[];
}
