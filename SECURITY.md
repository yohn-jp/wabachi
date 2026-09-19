# Security Policy

## Supported Versions

This project is pre-1.0 (`0.x`). There is no long-term support branch yet —
security fixes land on `main` and the latest `0.x` release only.

| Version    | Supported |
| ---------- | --------- |
| latest 0.x | ✅        |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via
[GitHub Security Advisories](../../security/advisories/new) on this
repository rather than opening a public issue. If that path is unavailable to
you, open an issue with minimal detail and ask a maintainer to follow up
through a private channel.

Include, where possible:

- A description of the issue and its impact
- Steps or a minimal reproduction
- Affected version/commit

We aim to acknowledge reports within 5 business days. This is a small,
independently maintained project without a dedicated security team, so
response times are best-effort.

## Trust boundaries

Wabachi analyzes repository content and can generate retained analysis or
architecture-rendering artifacts under explicit run/output locations. Treat
repositories and Architecture Canon documents as untrusted input, review the
requested source and output paths before execution, and run Wabachi with the
least filesystem and network privileges needed for the analysis.

Wabachi does not define a general-purpose shell-command surface. Registered
providers and architecture adapters own their bounded execution contracts;
security-sensitive changes to those boundaries should be reviewed as code,
not supplied as arbitrary runtime commands.
