# Benchmark methodology

This project ships two benchmarks. They answer different questions and have
different reproducibility guarantees.

Neither invokes a model. Task success is never measured. Estimated tokens are
`ceil(UTF-8 bytes / 4)` — a planning approximation, not a provider tokenizer
count, not a cost claim.

---

## 1. Fixture benchmark — `npm run benchmark`

Evaluates three hand-written fixtures of a few hundred bytes each. It records
source and output bytes, byte-derived token estimates, selected-file count,
required-file recall, selection precision, synthetic-secret redactions, and
whether inputs are deterministic.

- `targeted-reduction` — a budgeted lexical task with a selected required file and one synthetic secret.
- `all-fits-overhead` — a small explicit plan where pack metadata increases size.
- `critical-discovery` — a lexical task whose required constraint file is discoverable from content, not from its filename.

This is a **contract test**. It verifies bounding, redaction accounting and
negative-reduction honesty. At a few hundred bytes per fixture it says nothing
about behaviour on a real codebase.

## 2. Comparative benchmark — `npm run benchmark:comparative`

Compares ContextForge against five naive selection strategies under an identical
**24,576-byte budget**: paste the whole repository, alphabetical order, smallest
files first, largest files first, and naive grep.

Baselines reuse ContextForge's own default directory exclusions (VCS metadata,
dependencies, build output, dotenv, key material), so the measured difference is
selection and byte allocation — not directory hygiene. Baselines emit raw file
content, which is what a person does when pasting files into a chat window.

Required, useful and decoy files are declared by a human **before** the run, in
`bench/corpus.mjs` and `bench/comparative.mjs`. The tool never defines its own
ground truth.

### Metrics

| Metric | Meaning |
| --- | --- |
| `requiredRecall` | Did the file that actually implements the task get into the pack? |
| `usefulRecall` | Did the supporting files get in? |
| `decoyFilesEmitted` | How many files declared irrelevant were emitted? |
| `signalRatio` | (required + useful) ÷ emitted |
| `leakedSecretMarkers` | Synthetic credential strings that survived into the pack |
| `medianSelectionMs` | Median wall-clock over 3 runs. **Machine-specific — re-measure, never quote.** |
| `deterministic` | Two consecutive compiles of the same tree produced byte-identical packs |

### Scenarios and their reproducibility

| Scenario | Kind | Reproducible |
| --- | --- | --- |
| `generated-small` / `-medium` / `-large` | Generated corpus, 60 / 600 / 2,400 files | ✅ byte-for-byte from a seed |
| `generated-prose-heavy` | Generated corpus, 400 files — **regression guard** | ✅ byte-for-byte from a seed |
| `real-self-symlink-refusal` | This repository | ❌ point-in-time |

Generated corpora come from `bench/corpus.mjs`, seeded with `mulberry32`, using
no clock and no global randomness, so a third party reproduces the same tree byte
for byte. They are synthetic and do not model real repository structure.

Real-repository scenarios are **point-in-time observations**, recorded with their
commit and dirty flag. The working tree changes between runs — including when
this benchmark writes its own results — so their numbers are evidence of a moment,
not a reproducible measurement.

### The regression guard

`generated-prose-heavy` was built to reproduce a failure, not to pass. On a
documentation-heavy tree, a single large document monopolised the byte budget and
the file implementing the task was dropped: `requiredRecall = 0.00`, four
consecutive runs, identical.

Max-min fair byte allocation fixed that, and the scenario now reports `1.00`. Its
corpus, seed and ground truth are **unchanged since the failing run** — that is
the point, so the before and after numbers describe the same experiment.

It stays in the suite as a guard. A change that lets one file monopolise the
budget again shows up here first. The full sequence — failure, frozen baseline,
diagnosis, fix, cost — is in [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md).

Note what this scenario does **not** cover: useful-file recall on the three
original generated corpora is still `0.00`, an open selection-quality defect that
no scenario here reproduces in isolation yet. See [LIMITATIONS.md](LIMITATIONS.md).

## Reproduce

```sh
npm run benchmark               # fixtures
npm run benchmark:comparative   # generated corpora + regression guard + this repository
node bench/comparative.mjs --repo /path/to/repo   # any real tree
```
