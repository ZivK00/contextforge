# Demo project

ContextForge is evaluated on a compact source-of-truth document, not a full workspace dump.
The compiler must preserve active constraints and omit generated or secret-adjacent files.

This fixture intentionally contains more prose than a 512-byte mission budget can
hold. A real project often has long policy or roadmap documents, while an agent
only needs the active rule, the current constraint, and the file it will change.
The benchmark proves only that the configured byte limit is respected and that
the generated pack is smaller than this known fixture. It does not estimate
model tokens, quality, cost, or a universal reduction percentage.

Use explicit reasons for every selected file. Preserve source-of-truth documents
ahead of historical reports. Exclude generated output, dependency trees, and
archives by default. Refresh a compact pack when the mission changes instead of
rebuilding a complete repository summary. Review the output before sharing it.
