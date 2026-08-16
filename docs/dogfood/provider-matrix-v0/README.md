# Provider Matrix v0: Mottainai dogfood

This directory records the deterministic Provider Matrix v0 experiment against
`yohn-jp/mottainai`. Generated numbers are kept in the run artifacts; the
design discussion is in `design-findings.md`.

## Pinned input

- Source: `https://github.com/yohn-jp/mottainai.git`
- Revision: `e4d559434500e7f0c0d14980fe1c72a40d3ceae7`
- Revision selection: explicit full commit SHA; symbolic refs are rejected by
  the `matrix` workflow.

## Reproduce

Run from the Wabachi repository root with a new, empty output directory:

```bash
pnpm exec tsx src/index.ts matrix \
  https://github.com/yohn-jp/mottainai.git \
  --revision e4d559434500e7f0c0d14980fe1c72a40d3ceae7 \
  --out /tmp/wabachi-mottainai-provider-matrix
```

The command executes the registered deterministic v0 providers once. Provider
availability, versions, execution status, and toolchain versions are recorded
in `manifest.json`; the exact invocation inputs are recorded in `config.json`.
Use a fresh output directory for each run so a prior isolated workspace cannot
affect the experiment.

The same workflow can be replayed from a retained config artifact:

```bash
pnpm exec tsx src/index.ts matrix \
  --config path/to/config.json \
  --out /tmp/wabachi-mottainai-provider-matrix-rerun
```

## Artifact contract

```text
config.json                    # source, pinned SHA, provider set/order
manifest.json                  # resolved revision, status, timing, versions
raw/<provider>/                 # lossless provider-native artifacts
normalized/observations.json   # collected observation envelopes
normalized/correlation.json    # deterministic entity correlation result
normalized/facts.json          # normalized facts + native evidence references
matrix/matrix.json             # complete deterministic matrix
matrix/coverage.json           # coverage and metric definitions
matrix/overlap.json            # pairwise/all-provider overlap
matrix/conflicts.json          # contradiction rows
matrix/unmatched.json          # ambiguous/unmatched/unsupported rows
matrix/information-gain.json   # incremental information gain
report.md                      # deterministic human-readable projection
design-findings.md             # evidence/recommendations, manually authored
```

`matrix/*.json` and `report.md` are generated from the persisted normalized
artifact. They must not be hand-edited to improve presentation or metrics.
