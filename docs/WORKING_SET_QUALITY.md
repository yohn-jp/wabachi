# Candidate Working Set quality measurement

`src/working-set/quality.ts` is a deterministic, offline measurement harness. It evaluates Candidate Working Set artifacts against the pinned corpus in `src/working-set/fixtures/quality-corpus-v1.json`; it does not derive, prune, or rewrite a Candidate Working Set or the Architecture Canon.

## Corpus contract

The corpus is schema version 1 and has one immutable repository revision. Every case repeats that full revision, and its Candidate Working Set must carry the same repository identity and revision. A branch, tag, abbreviated SHA, or mutable ref is invalid.

Each case contains:

- `initialTargets`: the bounded seed set whose unique size is the initial set size.
- `legitimateTargets`: human-labeled context that is expected for the case.
- `expansionTargets`: the subset of legitimate context expected beyond the initial set.
- `candidate`: the artifact being measured.
- optional `verificationTargets`: labeled relevant test targets.
- optional `pruning.beforeTargets` and `pruning.afterTargets`: explicit before/after evidence. The harness observes this evidence; it does not perform pruning.
- optional `behavioralProxies`: tagged observations such as agent reads or expansion history.

Cases are sorted by `caseId`, target lists are unique and sorted, and unknown fields or duplicate labels are rejected. Expansion labels must be legitimate and outside the initial set. Pruning after-targets must be a subset of before-targets.

## Objective metrics

Objective metrics use only the pinned Candidate Working Set artifact and explicit corpus labels. They are reported per case and in the corpus summary:

| Metric                     | Definition                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial set size           | Unique `initialTargets` count.                                                                                                                                                                                  |
| Missing legitimate context | `legitimateTargets - candidate concrete targets`.                                                                                                                                                               |
| Missing expansions         | `expansionTargets - candidate concrete targets`; this is not inferred from observed reads.                                                                                                                      |
| Over-inclusion             | `candidate concrete targets - legitimateTargets`. Unresolved entries are excluded and measured separately.                                                                                                      |
| Unresolved/conflict rate   | Unresolved Candidate Working Set entries divided by all candidate entries.                                                                                                                                      |
| Pruning effect             | Explicit before/after counts, removed targets, and whether removed targets were legitimate or over-included. Unavailable without before/after evidence.                                                         |
| Provider contribution      | Candidate concrete entries with `provider`, `provider-fact`, `provider-correlation`, or `provider-*` evidence, plus their share of concrete candidate entries. Unavailable when no provider attribution exists. |
| Verification relevance     | Precision, recall, missing, and irrelevant counts against optional `verificationTargets`. Unavailable when the case has no verification labels.                                                                 |
| Repeatability              | The normalized corpus is measured twice and the serialized objective/proxy report must be byte-identical.                                                                                                       |

False negatives and over-inclusion remain separate metrics. There is no aggregate quality score that hides that tradeoff.

## Behavioral proxies

Read, expansion, and verification histories are accepted only under `behavioralProxies`. The harness reports their observed counts and overlaps as proxy metrics. They do not alter objective labels, Candidate Working Set entries, Canon data, or any derivation result. A proxy observation can therefore disagree with the artifact without changing the semantic measurement.

The harness does not execute providers, benchmark an LLM, impose an exploration quota, consume live telemetry, or derive future behavior from telemetry.

## Running the measurement

The focused test loads the pinned JSON fixture and exercises the report:

```sh
node --test --import tsx src/working-set/quality.test.ts
```

The normal repository validation remains deterministic and offline:

```sh
pnpm run verify
```

The report contains separate `objective` and `behavioralProxies` sections. Consumers should compare the individual metrics and evidence-availability flags rather than inventing a pass/fail threshold.
