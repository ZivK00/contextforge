# ContextForge

ContextForge is a local-first context compiler for coding agents. It selects,
explains, and packages the smallest reviewable set of repository files for a
task, under an explicit budget.

It is intentionally not an agent, hosted service, or automatic uploader.
Nothing leaves your machine unless you choose to send the generated file. It
does not replace human review, guarantee lower costs, or prove that a pack
contains no sensitive data.

## What it does

- `build` ranks bounded text files for a task and writes a complete local
  `.contextforge/` evidence pack.
- `select` and `compile` remain available when an explicit file plan is
  preferable.
- Each emitted file has a SHA-256 source hash, an explicit reason, redaction
  count, byte metrics, and clearly labelled token *estimates*.
- Default exclusions cover `.env`, VCS metadata, dependencies, build output,
  caches, temporary folders, archives, `.contextforge/`, and paths in
  `.gitignore` / `.contextforgeignore`.

The report distinguishes source bytes from output bytes. Estimated tokens are
`ceil(UTF-8 bytes / 4)`: a deterministic planning approximation, not a model
tokenizer, a cost claim, or a promise of model quality.

## Quick start

Requires Node.js 20 or newer. No package installation is required.

```sh
node bin/contextforge.mjs init --workspace ./my-project
node bin/contextforge.mjs build \
  --workspace ./my-project \
  --task "Fix the OAuth timeout" \
  --budget 4096
```

`build` creates the following local directory by default:

```text
.contextforge/
├── CONTEXT.md       # reviewed Markdown pack
├── DECISIONS.md     # task, selection and budget choices
├── FILES.json       # selected source files and hashes
├── MANIFEST.json    # reproducibility manifest
├── METRICS.json     # bytes and estimated-token metrics
├── REDACTIONS.json  # count and method, never the redacted values
└── RISKS.md         # limits that still need human review
```

Use `--dry-run` to inspect the planned artifact list without writing it, and
`inspect --dir ./my-project/.contextforge` to print a compact summary.

For a deliberate, explicit plan:

```sh
node bin/contextforge.mjs select --root ./my-project --query "oauth timeout" --out plan.json
node bin/contextforge.mjs compile --root ./my-project --plan plan.json --out context.md --report contextforge-report.json --max-bytes 16384
```

Inspect `context.md` before sharing it. A plan is deliberately explicit:

```json
[
  { "path": "README.md", "reason": "source of truth" },
  { "path": "src/auth.ts", "reason": "file being changed" }
]
```

## Safety model

ContextForge refuses absolute and path-traversal plan entries, refuses symlinks
at every descendant path segment,
does not read files above 256 KiB, and redacts common inline assignments such as
`apiKey=...`, `token=...`, and bearer tokens. These are safeguards, not a data
classification system: never assume a generated pack is safe without review.
See [THREAT_MODEL.md](THREAT_MODEL.md), [PROMPT_INJECTION_LIMITS.md](PROMPT_INJECTION_LIMITS.md), and [LIMITATIONS.md](LIMITATIONS.md).

## Development

```sh
npm test                      # 10 tests, no dependencies
npm run benchmark             # three hand-written fixtures
npm run benchmark:comparative # ContextForge against five naive baselines
```

The fixture benchmark is a contract test: it reports both reduction and
non-reduction cases and claims no universal percentage. The comparative
benchmark measures required-file recall, secret leakage, latency and determinism
against five naive strategies under an identical byte budget, on generated
corpora of up to 2,400 files.

The comparative benchmark found a real defect in this tool and now guards
against it. On a documentation-heavy corpus, one large document monopolised the
byte budget and the file implementing the task was dropped — a naive grep beat
ContextForge there. The failure was frozen into a reproducible corpus, diagnosed,
and fixed by max-min fair byte allocation. Required-file recall went 0.00 → 1.00,
and precision fell 1.00 → 0.67 on one fixture. That trade is documented, not
smoothed over.

**A second defect is still open**: useful-file recall is 0.00 on the three
original generated corpora, because lexical scoring cannot separate a document
describing a task from the code implementing it. See
[LIMITATIONS.md](LIMITATIONS.md), [BENCHMARK_METHODOLOGY.md](BENCHMARK_METHODOLOGY.md)
and [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md).

See [CASE_STUDY.md](CASE_STUDY.md) for a reproducible self-hosted run. It also
records a legitimate non-reduction result when the selected source already fits
the budget and review metadata costs more than it saves.

## Origin and scope

The public design is inspired by general context-hygiene practices: curated
mission packs, explicit budgets, source-of-truth pointers, and incremental
refreshes. It contains no code, prompts, secrets, project data, client names,
or private architecture from the system that motivated it.

## License

MIT. See [LICENSE](LICENSE).
