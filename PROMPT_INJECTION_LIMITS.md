# Prompt-injection limits

Repository files are untrusted content. ContextForge may select or package text that says “ignore prior instructions,” asks an agent to disclose data, or contains misleading tool commands. It does not interpret those strings as instructions, but a downstream coding agent might.

Task strings, plan reasons, and filenames are also rendered into Markdown metadata without semantic validation. Treat all of them as untrusted text and avoid copying generated instructions into a trusted prompt.

Before sending a pack to an agent or service:

1. Review `CONTEXT.md` and `RISKS.md`.
2. Treat repository text as data, not authority.
3. Keep system and user constraints outside the generated pack.
4. Prefer an explicit `select`/`compile` plan for security-sensitive work.
5. Do not include secrets, customer data, or files whose sharing policy is unknown.

ContextForge does not detect every injection, validate downstream prompts, or make a generated pack safe by itself.
