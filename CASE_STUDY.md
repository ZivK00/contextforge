# Self-hosted case study: release-safety context

Date: 2026-07-19  
Scope: ContextForge was run on its own public-safe source tree for the task
`Prepare a public safety release checklist`.

## Reproduction

```sh
node bin/contextforge.mjs build \
  --workspace . \
  --task "Prepare a public safety release checklist" \
  --budget 4096 \
  --out <temporary-directory>
```

## Observed result

The 2026-07-21 dry-run emitted all seven standard artifacts. It reported 5,712
selected source bytes and 6,673 output bytes, or an estimated-token change from
1,428 to 1,669 (`-16.82%`). No inline patterns were redacted in this run.

This is deliberately recorded as a **non-reduction** result. The selected files
already fit the budget, and the reviewable context-pack headers add metadata.
ContextForge must not claim that every task reduces context; the useful proof
here is transparent selection, reproducible artifact generation, and visible
redaction rather than a positive percentage.

## Limits

- Byte-derived token estimates are not provider-tokenizer measurements.
- Lexical selection can omit a relevant file; an explicit plan remains the
  safer route for critical changes.
- Redaction is pattern-based, so every generated pack still requires review
  before it is shared.

No private workspace, client project, prompt, credential, local path, or user
identity is included in this case study.
