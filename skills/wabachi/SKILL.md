---
name: wabachi
description: |
  Use Wabachi for deterministic repository analysis, provider matrices, and
  Architecture Canon validation or rendering. Resolve current workflows and
  exact syntax through the live CLI.
---

# Wabachi

This bundled Skill is a routing entrypoint. The installed CLI is the authority
for command syntax and operational playbooks; this file intentionally does not
duplicate flags or workflow details.

Start with:

```bash
wabachi skill
wabachi --help
```

Then choose a bounded intent with `wabachi skill <scenario>`. Resolve exact
syntax for each command through its progressive help pointer, for example:

```bash
wabachi architecture --help
wabachi architecture example
wabachi architecture validate
wabachi architecture render --out ./artifacts/site
```

Omitted-file validation and rendering use `.wabachi/architecture.json` only.
Pass an explicit Canon path to either command when overriding that default.

Architecture rendering is npm-native and uses the bundled React Flow + ELK
renderer. The default render path does not require Java, Docker, Chromium,
Structurizr, CDN, or network access.

Use `--json` on `skill` or help when a machine-readable projection is needed.
