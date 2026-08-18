# Threat model

## Assets

- Source files, credentials, private keys, and customer data that may exist in a workspace.
- A generated context pack and its manifest, hashes, metrics, and logs.
- Maintainer trust in the tool's safety claims.

## Implemented controls

- Local-only operation: no network client, telemetry, account, or API key.
- Refusal of absolute, traversal, NUL-containing, symlinked, and symlink-root paths.
- Default exclusion of VCS, dependencies, build/cache/archive folders, `.env*`, common credential files, and key files.
- 256 KiB per-file cap and a NUL-byte heuristic that skips many binary files; this is not a complete text-format detector.
- Pattern redaction for common assignments, bearer tokens, GitHub tokens, credential URLs, and PEM private-key blocks.
- SHA-256 source hashes, explicit reasons, skipped-file reasons, and human-review warnings.

## Residual risks

- Pattern filtering can miss an unknown secret format or sensitive prose.
- A permitted source file can contain hostile instructions. The tool packages content; it does not execute it.
- Files can change between inspection and reading on a hostile or concurrently modified filesystem (TOCTOU).
- A root selected by the operator can itself contain sensitive material. Do not point the tool at a home directory, credential store, production export, or customer data without policy and review.
- Hashes identify exact source content and should be treated as sensitive metadata when the source is sensitive.
- Repository-wide file count, total bytes, and scan-time limits are not yet implemented; very large repositories can cause denial-of-service conditions.

## Non-goals

ContextForge is not a DLP product, malware scanner, sandbox, permission system, or proof that a pack is safe to upload.
