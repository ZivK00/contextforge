# Changelog

All notable changes are documented here.

## Unreleased

- **Fixed: a single large file could consume the whole byte budget**, dropping
  relevant files ranked below it — including files small enough to cost almost
  nothing. `compileContextPack` now divides bytes by max-min fair share: files
  are served smallest first, each taking the lesser of what it needs and an equal
  share of what remains. Found by the comparative benchmark on this repository,
  then frozen into the reproducible `generated-prose-heavy` scenario before any
  fix was written. Required-file recall on that scenario: 0.00 to 1.00.
  This cost precision — 1.00 to 0.67 on the `targeted-reduction` fixture, and
  reduction 16.23% to 10.65%. Scoring is unchanged. See BENCHMARK_RESULTS.md.
- Added a comparative benchmark (`npm run benchmark:comparative`) measuring
  ContextForge against five naive selection strategies under an identical budget,
  on deterministic generated corpora of up to 2,400 files and on a real tree.
  It reports required recall, secret leakage, latency and determinism, and
  publishes the scenarios where ContextForge loses.
- Added `.contextforgeignore` covering generated benchmark artifacts, which
  otherwise scored highly against every task they had been run on.
- Added the `build`, `inspect`, and `init` CLI workflow.
- Added local context-pack artifacts, deterministic byte-based token estimates,
  source hashes, and workspace ignore support.

## 0.1.0

- Initial local CLI for explicit file selection, bounded compilation, common
  inline secret redaction, and reproducible byte benchmarks.
