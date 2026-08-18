# Benchmark results

Two benchmarks are published here. The first checks the contract on hand-written
fixtures. The second compares ContextForge against naive context-selection
baselines at four generated scales and on a real repository.

Neither invokes a model. Task success is not measured. Estimated tokens are
`ceil(UTF-8 bytes / 4)`, a planning approximation, not a provider tokenizer count
and not a cost claim.

This file also records a defect the comparative benchmark found in ContextForge
itself, the fix, and what the fix cost. That sequence is in
[The defect, the fix, and the price](#the-defect-the-fix-and-the-price) below.

---

## 1. Fixture benchmark

`npm run benchmark`

| Scenario | Source bytes | Output bytes | Estimated-token change | Reduction | Required recall | Precision | Secret misses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Targeted reduction | 573 | 512 | 144 to 128 | 10.65% | 1.00 | 0.67 | 0 |
| All fits / overhead | 152 | 313 | 38 to 79 | -105.92% | 1.00 | 1.00 | 0 |
| Critical discovery | 301 | 524 | 76 to 131 | -74.09% | 1.00 | 0.67 | 0 |

These fixtures are a few hundred bytes each. They verify behaviour — bounding,
redaction accounting, negative-reduction honesty — and nothing about scale. They
are a contract test with a table, not evidence of usefulness on a real codebase.
That gap is what the comparative benchmark exists to close.

---

## 2. Comparative benchmark

`npm run benchmark:comparative` — Node v24.12.0, Windows 11.
Raw data: [`BENCHMARK_COMPARATIVE.json`](BENCHMARK_COMPARATIVE.json).

### Method

Every strategy receives the same repository, the same task string, and the same
**24,576-byte budget**. Baselines reuse ContextForge's default directory
exclusions, so the measured difference is *selection and byte allocation*, not
directory hygiene. Baselines emit raw file content, which is what a person does
when pasting files into a chat window.

Required, useful and decoy files are declared by a human **before** the run. The
tool does not define its own ground truth. Generated corpora are deterministic
from a seed. Full method in [BENCHMARK_METHODOLOGY.md](BENCHMARK_METHODOLOGY.md).

### Results — generated corpus, 2,400 files, 3.33 MB

| Strategy | Files emitted | Output bytes | Required recall | Useful recall | Signal ratio | Leaked secrets | Median ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **ContextForge** | 12 | 24,576 | **1.00** | 0.00 | 0.08 | **0** | ~1,400 |
| Paste whole repository | 2,400 | 3,411,308 | 1.00 | 1.00 | 0.00 | 3 | ~810 |
| Budget, alphabetical | 226 | 24,522 | 0.00 | 0.50 | 0.00 | 3 | ~800 |
| Budget, smallest first | 229 | 24,508 | 0.00 | 0.00 | 0.00 | 0 | ~780 |
| Budget, largest first | 8 | 24,576 | 0.00 | 0.00 | 0.00 | 0 | ~820 |
| Budget, naive grep | 57 | 24,369 | 0.00 | 1.00 | 0.04 | 3 | ~840 |

The 600-file and 60-file corpora behave the same way: ContextForge keeps required
recall at 1.00 and leaks no secrets; every naive budgeted strategy reaches 0.00
required recall by 600 files.

Timings are machine-specific. Re-measure them; do not quote these.

### Results — regression guard, prose-heavy corpus, 400 files, 462 KB

Task: *"refuse symlinked paths during compilation"*. Required: `src/compiler.mjs`,
the only file that performs the refusal, 947 bytes. Decoys: a design note, a
postmortem and a benchmark report, each ~17 KB, each named after the task and
each discussing it at length.

| Strategy | Files | Required recall | Useful recall | Decoys emitted |
| --- | ---: | ---: | ---: | ---: |
| **ContextForge** | 5 | **1.00** | 1.00 | 3 |
| Paste whole repository | 400 | 1.00 | 1.00 | 3 |
| Budget, alphabetical | 21 | 0.00 | 0.00 | 0 |
| Budget, smallest first | 60 | 0.00 | 0.00 | 0 |
| Budget, largest first | 4 | 0.00 | 1.00 | 1 |
| Budget, naive grep | 3 | 1.00 | 1.00 | 1 |

This scenario reported **0.00** before the fix described below.

### Results — real repository, ContextForge itself

Point-in-time observation, not a reproducible measurement: the working tree
changes between runs, including when this benchmark writes its own results. It is
recorded with its commit and dirty flag in the JSON artifact.

Required recall moved from **0.00 to 1.00** across the same fix.

### Determinism

Two consecutive compiles of the same tree produced identical packs (SHA-256
equal) in every scenario. The four generated-corpus scenarios are byte-for-byte
reproducible across runs; three consecutive full runs were compared and matched.

---

## The defect, the fix, and the price

### 1. What the benchmark found

On a documentation-heavy repository, ContextForge emitted two documents *about*
symlink refusal and never emitted the function that *performs* it. A naive grep,
same budget, found it. This first appeared on this repository, where it could not
be reproduced: the tree changed between runs.

### 2. The baseline

`bench/corpus.mjs` builds a 400-file corpus from seed `1000081` where the failure
is deterministic. Four consecutive runs produced identical results:
`requiredRecall = 0.00`, same corpus size of 461,611 bytes, same two-file
selection. Only then was a fix attempted.

### 3. The diagnosis

The ranking was not at fault. The required file was **in the plan**, at rank 5 of
5 scored candidates:

```
rank  score  content  path  bytes   file
   1    416      404    12   16986   docs/postmortems/symlinked-paths-during-compilation.md
   2    409      400     9   16925   docs/benchmarks/refuse-symlinked-paths-report.md
   3    400      391     9   16843   docs/design/refuse-symlinked-paths.md
   4     73       73     0    3414   docs/threat-model.md
   5      3        3     0     947   src/compiler.mjs   <-- required
```

Two facts decided the outcome. A single document consumed **69% of the whole
budget**, so two of them exhausted it. And the required file cost only 947
bytes — **3.9% of the budget**. It was dropped with `context budget exhausted`,
not because it was judged irrelevant, but because greedy rank-order filling had
already spent everything.

Normalising the score by lexical density was rejected on measurement, not
opinion: the documents still win by 7.6× on hits per kilobyte (24.4 versus 3.2).
Density normalisation changes the scoring without fixing the defect.

### 4. The fix

Max-min fair byte allocation in `compileContextPack`. Files are served smallest
first; each takes the lesser of what it needs and an equal share of what remains.
Anything that fits within its share is included whole; only files larger than
their share are truncated.

`fairByteShares` in [`src/compiler.mjs`](src/compiler.mjs). The scoring code is
untouched. No fixture and no test assertion was modified.

### 5. Before and after

| Scenario | Required recall | Useful recall | Files emitted | Signal ratio |
| --- | ---: | ---: | ---: | ---: |
| generated-small | 1.00 → 1.00 | 0.00 → 0.00 | 10 → 12 | 0.10 → 0.08 |
| generated-medium | 1.00 → 1.00 | 0.00 → 0.00 | 9 → 12 | 0.11 → 0.08 |
| generated-large | 1.00 → 1.00 | 0.00 → 0.00 | 9 → 12 | 0.11 → 0.08 |
| **generated-prose-heavy** | **0.00 → 1.00** | **0.00 → 1.00** | 2 → 5 | 0.00 → 0.40 |
| **real-self-symlink-refusal** | **0.00 → 1.00** | **0.00 → 1.00** | 2 → 12 | 0.00 → 0.25 |

Fixture benchmark, before → after: required recall stayed 1.00 on all three.

### 6. The price

The fix trades precision for recall. It is not free and it is not magic.

- `targeted-reduction` precision **1.00 → 0.67**, reduction **16.23% → 10.65%**.
- Signal ratio on the three original generated corpora **0.11 → 0.08**: more files
  are emitted, so more irrelevant ones are too.

Redaction, secret leakage and determinism are unchanged. All 25 baseline
measurements that could be affected were compared; `bench/baselines.mjs` contains
zero references to `compileContextPack` or `selectFiles`, so baselines cannot be
influenced by this change. Three baseline numbers did move, all on the real
repository scenario, because the working tree changed between runs.

### 7. What is still broken

**Useful-file recall remains 0.00 on the three original generated corpora.** The
fix addressed *byte allocation*, not *selection quality*. A superseded postmortem
that repeats the task vocabulary still outranks current design documents and
pushes them past the selection limit.

This is a distinct, open defect. ContextForge is not "fixed"; one failure mode
was identified, reproduced, diagnosed and corrected, and another remains. See
[LIMITATIONS.md](LIMITATIONS.md).

---

## Reproduce

```sh
npm test
npm run benchmark
npm run benchmark:comparative
node bench/comparative.mjs --repo /path/to/repo
```
