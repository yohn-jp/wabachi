# Design lifecycle dogfood

`scripts/certify-design-dogfood.mjs` runs one real Design Intent change
through the installed, production Wabachi package: `design create` →
`design submit` → `design review` → `design start` → `design link` →
production machine checks → `application.certify()` → `preflightPromotion()`
→ `application.promote()` → `design render`. It does not fabricate a result;
every step is the same production code path a real proposal takes, run
against a real `git clone` so review, certification, and promotion bindings
are immutable repository revisions rather than fixture values.

This document draws the line between two things that live side by side in
this repository and must not be confused with each other.

## Historical evidence (checked in, immutable)

- `.wabachi/changes/wabachi-code-intent-bootstrap/change.json`
- `.wabachi/changes/wabachi-code-intent-bootstrap/record.json`
- the current `.wabachi/architecture.json`

These are the artifacts a real, successful dogfood run produced. `change.json`
is the `DesignChangeSet` proposal Wabachi's own `design create` authored;
`record.json` is the resulting `DesignIntentLifecycleRecord` (the same shape
production storage calls `lifecycle.json` — this repository names the
checked-in copy `record.json` to distinguish it from a live, mutable storage
artifact) after certification and promotion, ending in `state: "promoted"`.
`.wabachi/architecture.json` carries the one Code Intent invariant text
change that run promoted, with a Canon digest that matches
`record.json`'s certification binding exactly.

They are evidence, not a fixture and not a regression target. Their Git
revisions (`base.repositoryRevision`, `review.proposalRevision`, the
certification's `implementationRevision`) point into the temporary clone the
dogfood run used, not into this repository's own history — do not expect
`git show <revision>` to resolve them here. Do not hand-edit these files to
make a future check pass; if the dogfood run's shape changes, regenerate them
by running the script and checking in its result again.

## Current regression (re-run every verify)

`pnpm run verify` (via `scripts/run-package-suite.mjs`) executes
`scripts/certify-design-dogfood.mjs` itself, end to end, against the
currently installed package build. This is what actually proves the
production Design lifecycle — including promotion's certification
validation — still succeeds on today's code. It is intentionally the same
script that produced the checked-in evidence above, so a regression here
means the historical evidence is no longer reproducible with the current
production code.

`scripts/certify-design-dogfood.test.mjs` is the fast harness test
(`node --test scripts/certify-design-dogfood.test.mjs`). It does not re-run
the full lifecycle (that belongs to the regression step above, which needs a
built package and a real Git clone); instead it checks the bounded contract
of a dogfood result (`validateDogfoodResult`) and that the checked-in
historical evidence is internally consistent and still promoted.

## Running it yourself

```bash
pnpm run build
node scripts/certify-design-dogfood.mjs
```

The script installs the packed tarball into a temporary consumer directory,
clones this repository into a temporary working tree, and runs the full
lifecycle there. It prints a JSON summary (`changeId`, the four Git
revisions, `certificationResult`, `promotionOk`, `lifecycleState`, and the
rendered documentation files) and exits non-zero if any production step
rejects the proposal.
