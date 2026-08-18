# Security policy

ContextForge is local-first: it reads only the configured real root directory
and writes only the output paths explicitly passed to its CLI. It excludes
common build, archive, environment, credential, and key paths by default,
refuses absolute and traversal plan entries, caps source files, and redacts
several common secret forms. A plan cannot follow a symlink in the configured
root, including a symlinked parent directory.

These guards are not a substitute for review. Treat every generated pack as
sensitive until you inspect it. Do not point the tool at a home directory,
credential store, production export, or customer data without a deliberate
policy and a manual review.

Please report vulnerabilities privately to the repository maintainer once a
public contact channel is configured. Until then, do not open a public issue
for a suspected data exposure and do not include secrets in any report. See
[THREAT_MODEL.md](THREAT_MODEL.md) for the complete boundary.
