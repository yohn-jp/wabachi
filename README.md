<p align="center">
  <img src="./docs/assets/readme/wabachi-hero.webp" alt="WABACHI — Repository Semantic Authority." width="100%">
</p>

<p align="center">
  <a href="https://github.com/yohn-jp/wabachi/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yohn-jp/wabachi/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/wabachi"><img alt="npm" src="https://img.shields.io/npm/v/wabachi"></a>
  <a href="https://www.npmjs.com/package/wabachi"><img alt="Node" src="https://img.shields.io/node/v/wabachi"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/wabachi"></a>
</p>

# Wabachi

**Repository analysis and Architecture Canon tooling**

Wabachi provides deterministic repository-analysis workflows for codebase understanding. It can resolve a repository and revision, execute registered analysis providers, generate auditable provider matrices, and validate or render an explicit Architecture Canon.

## Quick start

Requires Node.js 24 or newer.

```bash
npm install --global wabachi

wabachi --version
wabachi --help
```

For an ephemeral invocation:

```bash
npx --yes wabachi --help
```

## Commands

Run the registered repository-analysis providers:

```bash
wabachi run <repository> [--revision <ref>] [--out <dir>]
```

Run the provider matrix and retain its auditable artifacts:

```bash
wabachi matrix <repository> --revision <sha> --out <dir>
```

Validate an Architecture Canon document:

```bash
wabachi architecture validate <file>
```

Render an Architecture Canon site:

```bash
wabachi architecture render <file> --out <dir>
```

Use `wabachi --help` for the installed command surface.

## Analysis model

Wabachi keeps repository facts and architecture declarations explicit. Repository analysis is performed by registered providers, while Architecture Canon input is supplied as an explicit document and validated before rendering.

The matrix workflow emits retained artifacts so provider output, correlations, and reports can be inspected rather than treated as opaque agent context.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`pnpm run verify` is the repository's authoritative local verification entry point. `pnpm run test:package` builds, packs, installs, and executes the npm package in an isolated smoke-test environment.

## Security

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
