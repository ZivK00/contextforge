# Contributing to ContextForge

Thank you for improving ContextForge.

## Before opening a change

- Keep the CLI local-first and dependency-free unless a dependency materially
  improves safety or reproducibility.
- Do not add telemetry, uploads, account requirements, or model-provider keys.
- Never add real secrets or private workspace material to fixtures, examples,
  issues, or commits.
- Prefer small, deterministic changes with an explicit user-facing outcome.

## Pull requests

Describe the problem, safety impact, and how the change was checked. If output
or metric semantics change, update the README and tests in the same pull request.

## Reporting security issues

Do not open a public issue for a suspected data exposure. Follow
[SECURITY.md](SECURITY.md).
