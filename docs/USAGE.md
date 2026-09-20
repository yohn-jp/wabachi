# Wabachi usage

Wabachi is a deterministic repository-analysis and Architecture Canon CLI.
This manual explains the normal workflows for people. The installed command
contract is authoritative: use `wabachi --help`, progressive command help, and
`wabachi skill` for the exact current syntax.

## Install and discover

Wabachi requires Node.js 24 or newer.

```bash
npm install --global wabachi
wabachi --version
wabachi --help
```

For an ephemeral run, use `npx --yes wabachi --help`. Agents can begin with
`wabachi skill` and then request one bounded playbook with
`wabachi skill <scenario>`. Add `--json` to skill or help when consuming the
projection from a script.

## Analyze a repository

`run` resolves a repository and executes the registered analysis providers. It
can use the default revision resolution or an explicit revision, and writes a
manifest plus provider output under a temporary directory unless `--out` is
provided.

```bash
wabachi run .
wabachi run . --revision HEAD --out ./artifacts/run
```

Use a commit SHA or another stable ref when the result will be compared or
reviewed. The command prints the manifest path. Keep the directory named by
`--out` if downstream work needs the facts or provider outputs.

## Build a provider matrix

`matrix` runs the matrix workflow for one revision and requires retained output
artifacts. A full 40-character commit SHA is the safest input for reproducible
evidence.

```bash
wabachi matrix . --revision 0123456789abcdef0123456789abcdef01234567 --out ./artifacts/matrix
```

The command prints the report path. The output directory also contains the
supporting facts and correlation artifacts used to produce the report. For a
configured provider workflow, pass a JSON configuration file with the source,
revision, provider IDs, and addition order:

```bash
wabachi matrix --config ./matrix-workflow.json
```

The configured provider set must match the providers registered by the
installed Wabachi version.

## Architecture Canon

Architecture Canon authoring is an explicit file-editing step. Wabachi does
not provide an init or edit command. Create or revise the Canon document using
the repository's documented schema, then validate it before rendering.

```bash
wabachi architecture validate ./architecture.json
wabachi architecture validate ./architecture.json --json
```

Rendering uses the bundled React Flow + ELK renderer and requires only the
supported Node.js/npm environment. No Java, Docker, Chromium, Structurizr,
CDN, or network access is required by the render command. Wabachi writes the
generated documentation and local static diagrams beneath the directory passed
to `--out`:

```bash
wabachi architecture render ./architecture.json --out ./artifacts/site
```

The normal documentation path is: author the explicit Canon, validate that
same file, then render it into a retained site. The matching live playbook is
`wabachi skill architecture-documentation`.

## Common failures and recovery

- If a repository cannot be resolved, confirm the path or remote and retry
  `run` with an explicit revision. Preserve the printed diagnostic when the
  failure needs investigation.
- If `matrix` rejects a revision, use a full commit SHA and provide `--out`.
  If a configuration is rejected, compare its provider IDs and addition order
  with the installed provider set.
- If Canon validation fails, fix the reported document issue and validate the
  same file again before rendering. `--json` is useful for automation.
- If rendering fails, validate the Canon and inspect the bounded output
  directory. The render command does not invoke an external diagram executable.
- If syntax is uncertain, stop relying on a copied example and resolve the
  current contract with `wabachi architecture --help` or the relevant leaf
  help. Unsupported commands fail closed.

Generated outputs are ordinary retained files; Wabachi does not publish them
or activate an agent plugin as a side effect of npm installation.
