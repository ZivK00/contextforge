# Limitations

## Open defect: selection quality on documentation-heavy trees

Lexical scoring cannot tell a document that *describes* a task from the code that
*implements* it, and it cannot tell a current document from a superseded one.

The selector scores a file by how often the task's terms appear in its content,
plus a bonus for each term appearing in its path. Documentation is usually named
after the feature and repeats the feature's vocabulary throughout, so it wins on
both signals. Code is named after its module and speaks in identifiers, so it
scores low on both. In the measured corpora, documents beat the implementation by
**7.6× on term hits per kilobyte** — normalising by document length does not
close that gap, it is a real property of prose.

The measurable consequence today: **useful-file recall is 0.00 on the three
original generated corpora**. A superseded postmortem repeating the task
vocabulary outranks the current design documents and pushes them past the
selection limit. Required-file recall is unaffected.

No fix is applied. Plausible directions — weighting code against prose for
implementation-shaped tasks, penalising paths that mark a document as historical,
diversifying selection across directories — all change the contract and all need
a corpus that reproduces the failure before they can be measured. Building that
corpus is the next step, exactly as it was for the budget defect below.

## Closed defect: budget monopolisation

*Fixed. Recorded because the regression guard that proves it is part of the
benchmark, and because the trade-off it introduced is still being paid.*

Greedy rank-order filling let a single large file consume the whole byte budget,
so relevant files ranked below it were dropped with `context budget exhausted` —
including files small enough to cost almost nothing. In the reproduction, one
document took 69% of the budget and the required file, at 947 bytes or 3.9% of
the budget, was never emitted.

`compileContextPack` now divides bytes by max-min fair share instead: files are
served smallest first, each taking the lesser of what it needs and an equal share
of what remains. Required-file recall on the reproduction went from 0.00 to 1.00,
and the scenario is kept as `generated-prose-heavy` to catch a regression.

**The fix cost precision.** On `targeted-reduction`, precision went 1.00 → 0.67
and reduction 16.23% → 10.65%. Signal ratio on the generated corpora went
0.11 → 0.08. More files are emitted, so more irrelevant ones are too. See
[BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md).

## Other limitations

- Lexical selection can omit a relevant file or include a historical one.
- File-level recall is not semantic completeness; truncation can omit a critical line.
- Selection precision is low. Signal ratio peaks at 0.40 across measured scenarios and sits at 0.08 on the large generated corpora: most emitted files are not the ones a human declared as needed.
- ContextForge is the slowest budgeted strategy measured, roughly 1.7× the naive baselines at 2,400 files, because it reads and scores every eligible file.
- Token values are `ceil(UTF-8 bytes / 4)` planning estimates, not provider-tokenizer counts, quality scores, or cost predictions.
- A smaller pack is not automatically a better pack. The benchmark includes negative-reduction scenarios.
- Redaction is bounded pattern matching, not secret classification.
- No benchmark here invokes a model. Required-file recall is a proxy for task usefulness, and a weak one.
- Real-repository benchmark scenarios are point-in-time observations, not reproducible measurements. The working tree changes between runs.
- ContextForge is tested locally on Windows and CI is configured for Ubuntu; macOS remains a compatibility target, not a verified release platform.
- The tool intentionally has no automatic network, model, or telemetry integration.
- It has no repository-wide file-count, total-byte, or scan-time cap; do not run lexical selection on an untrusted huge tree.
