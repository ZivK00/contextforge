// Deterministic corpus generator for comparative benchmarking.
//
// The generator takes a seed and a file count and always produces the same tree,
// byte for byte. It uses no clock and no global randomness so a published result
// can be reproduced on another machine.
//
// A generated corpus is not a real repository. It is used to compare selection
// strategies at a controlled scale; real-repository runs live in `real-repos.mjs`.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'handler', 'session', 'queue', 'buffer', 'schema', 'adapter', 'registry', 'worker',
  'payload', 'timeout', 'retry', 'cursor', 'stream', 'digest', 'policy', 'window',
  'segment', 'binding', 'channel', 'record', 'lease', 'shard', 'bucket', 'ledger',
];

const AREAS = ['src', 'src/api', 'src/db', 'lib', 'lib/internal', 'config', 'docs', 'notes', 'tests'];

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function paragraph(random, sentences) {
  const out = [];
  for (let i = 0; i < sentences; i += 1) {
    const length = 6 + Math.floor(random() * 9);
    const words = [];
    for (let w = 0; w < length; w += 1) words.push(pick(random, WORDS));
    out.push(`${words.join(' ')}.`);
  }
  return out.join(' ');
}

function moduleBody(random, name, lines) {
  const out = [`// ${name} module`, ''];
  for (let i = 0; i < lines; i += 1) {
    const a = pick(random, WORDS);
    const b = pick(random, WORDS);
    out.push(`export function ${a}${b.charAt(0).toUpperCase()}${b.slice(1)}${i}(input) {`);
    out.push(`  // ${paragraph(random, 1)}`);
    out.push(`  return { ${a}: input?.${b} ?? null };`);
    out.push('}');
    out.push('');
  }
  return out.join('\n');
}

// Synthetic, obviously-fake secret material. These strings exist so a benchmark
// can measure whether a strategy emits credential-shaped text into a pack.
const SYNTHETIC_SECRETS = [
  'legacy_api_key = ghp_EXAMPLEEXAMPLEEXAMPLE0000000000',
  'database_url = postgres://benchuser:EXAMPLE-NOT-A-REAL-PASSWORD@localhost:5432/bench',
  'service_token = EXAMPLE0000000000000000000000000000',
];

/**
 * Build a deterministic corpus on disk.
 *
 * The scenario plants three classes of file:
 *  - required: files a human says are needed to do the task
 *  - useful:   files that legitimately help
 *  - decoy:    files that share vocabulary with the task but are historical or unrelated
 *  - secret:   a file that is NOT covered by default exclusions but contains credential-shaped text
 */
export async function generateCorpus({ root, seed, fileCount }) {
  const random = mulberry32(seed);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const required = ['src/api/oauth-refresh.mjs'];
  const useful = ['docs/auth-flow.md', 'config/auth-policy.json'];
  const decoys = ['lib/internal/lexer-token.mjs', 'notes/oauth-postmortem-archive.md', 'docs/csrf-token-notes.md'];
  const secretFile = 'config/legacy-credentials.txt';

  const written = new Map();
  const write = async (relativePath, content) => {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    written.set(relativePath, Buffer.byteLength(content, 'utf8'));
  };

  // The one file that actually implements the task.
  await write(
    required[0],
    [
      '// OAuth refresh: exchanges a refresh token for a new access token.',
      '// Retries are bounded and the request timeout is enforced per attempt.',
      '',
      'const REFRESH_TIMEOUT_MS = 8000;',
      'const MAX_REFRESH_RETRIES = 3;',
      '',
      'export async function refreshAccessToken({ refreshToken, fetchImpl }) {',
      '  for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt += 1) {',
      '    const controller = new AbortController();',
      '    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);',
      '    try {',
      '      const response = await fetchImpl("/oauth/token", {',
      '        method: "POST",',
      '        signal: controller.signal,',
      '        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),',
      '      });',
      '      if (response.ok) return await response.json();',
      '      if (response.status < 500) throw new Error("oauth refresh rejected");',
      '    } finally {',
      '      clearTimeout(timer);',
      '    }',
      '  }',
      '  throw new Error("oauth refresh timeout after retries");',
      '}',
      '',
    ].join('\n'),
  );

  await write(
    useful[0],
    [
      '# Authentication flow',
      '',
      'The access token is short lived. When it expires the client performs an oauth',
      'refresh against the token endpoint. The refresh path enforces its own timeout',
      'and a bounded retry count so a failing identity provider cannot stall a request.',
      '',
      paragraph(random, 8),
      '',
    ].join('\n'),
  );

  await write(
    useful[1],
    `${JSON.stringify({ oauth: { refreshTimeoutMs: 8000, maxRefreshRetries: 3, clockSkewSeconds: 30 } }, null, 2)}\n`,
  );

  // Decoys share the task vocabulary but are not what a reviewer needs.
  await write(
    decoys[0],
    `// Tokenizer internals. "token" here means a lexical token, not an auth token.\n\n${moduleBody(random, 'lexer-token', 14)}`,
  );
  await write(
    decoys[1],
    `# Archived postmortem (superseded)\n\nHistorical oauth refresh incident. Kept for the record only; the retry and timeout\nvalues described here were replaced.\n\n${paragraph(random, 22)}\n`,
  );
  await write(
    decoys[2],
    `# CSRF token notes\n\n${paragraph(random, 16)}\n`,
  );

  // A credential-bearing file that default exclusions do NOT catch.
  await write(
    secretFile,
    `# Legacy credentials kept for the migration window.\n${SYNTHETIC_SECRETS.join('\n')}\n`,
  );

  // Filler files up to the requested count.
  const planted = written.size;
  for (let i = 0; i < Math.max(0, fileCount - planted); i += 1) {
    const area = pick(random, AREAS);
    const stem = `${pick(random, WORDS)}-${pick(random, WORDS)}-${i}`;
    if (area === 'docs' || area === 'notes') {
      await write(`${area}/${stem}.md`, `# ${stem}\n\n${paragraph(random, 4 + Math.floor(random() * 20))}\n`);
    } else if (area === 'config') {
      await write(`${area}/${stem}.json`, `${JSON.stringify({ name: stem, enabled: random() > 0.5, retries: Math.floor(random() * 5) }, null, 2)}\n`);
    } else {
      await write(`${area}/${stem}.mjs`, moduleBody(random, stem, 2 + Math.floor(random() * 18)));
    }
  }

  const totalBytes = [...written.values()].reduce((sum, value) => sum + value, 0);
  return {
    root,
    seed,
    fileCount: written.size,
    totalBytes,
    task: 'oauth refresh token timeout retry',
    annotations: {
      requiredFiles: required,
      usefulFiles: useful,
      decoyFiles: decoys,
      secretFiles: [secretFile],
      syntheticSecretMarkers: ['ghp_EXAMPLE', 'EXAMPLE-NOT-A-REAL-PASSWORD', 'service_token'],
    },
  };
}


// ---------------------------------------------------------------------------
// Prose-heavy corpus.
//
// This corpus exists to reproduce a specific, observed defect: lexical scoring
// prefers documents that *describe* a task over the file that *implements* it.
//
// It was built after the comparative benchmark hit that failure on this
// project's own repository, where selection returned a design note and a
// benchmark report and missed `src/compiler.mjs`. That observation was not
// reproducible, because the working tree changed between runs. This generator
// makes the same failure deterministic so a fix could be measured against it.
//
// The fix landed: max-min fair byte allocation in `compileContextPack`. This
// corpus is now a regression guard rather than a reproduction. Its ground truth
// is unchanged since the failing run — deliberately, so the before and after
// numbers describe the same experiment.
//
// The mechanism is not exotic, which is the point. Documentation is named after
// the feature, so the task's own words appear in its path (worth +3 each in the
// selector) and dozens of times in its body. The implementation is named after
// its module and speaks in code, so the task's words barely appear. The prose
// therefore outranks the code and exhausts the byte budget before the code is
// reached.
// ---------------------------------------------------------------------------

const PROSE_TASK_TERMS = ['refuse', 'symlinked', 'paths', 'during', 'compilation'];

function proseParagraph(random, sentences, density) {
  const out = [];
  for (let i = 0; i < sentences; i += 1) {
    const words = [];
    const length = 8 + Math.floor(random() * 10);
    for (let w = 0; w < length; w += 1) {
      words.push(random() < density ? pick(random, PROSE_TASK_TERMS) : pick(random, WORDS));
    }
    out.push(`${words.join(' ').replace(/^./, (c) => c.toUpperCase())}.`);
  }
  return out.join(' ');
}

function proseDocument(random, title, sentences) {
  return [`# ${title}`, '', proseParagraph(random, sentences, 0.18), '', '## Background', '', proseParagraph(random, sentences, 0.14), '', '## Decision', '', proseParagraph(random, sentences, 0.2), ''].join('\n');
}

/**
 * Build a deterministic corpus in which documentation about the task outranks
 * the code that performs it.
 *
 * Ground truth: `src/compiler.mjs` is the only file that implements the
 * behaviour. Everything under `docs/` merely discusses it.
 */
export async function generateProseHeavyCorpus({ root, seed, fileCount }) {
  const random = mulberry32(seed);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const written = new Map();
  const write = async (relativePath, content) => {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    written.set(relativePath, Buffer.byteLength(content, 'utf8'));
  };

  const required = ['src/compiler.mjs'];
  const useful = ['docs/threat-model.md'];

  // The implementation. It speaks in code: the task's exact words appear a
  // handful of times, and its path carries none of them.
  await write(
    required[0],
    [
      '// Context pack compiler.',
      '',
      "import { lstat, readFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      '',
      '// A symlink anywhere along the descent is refused, not followed.',
      'async function assertNoSymlinkOnPath(root, relativePath) {',
      '  let current = root;',
      '  for (const segment of relativePath.split(/[\\/]+/)) {',
      '    current = path.join(current, segment);',
      '    const info = await lstat(current);',
      '    if (info.isSymbolicLink()) {',
      '      throw new Error(`Refusing symlinked path: ${relativePath}`);',
      '    }',
      '  }',
      '}',
      '',
      'export async function readBoundedFile(root, relativePath) {',
      '  if (path.isAbsolute(relativePath) || relativePath.includes(String.fromCharCode(0))) {',
      "    throw new Error('Plan entries must use non-empty relative paths.');",
      '  }',
      '  await assertNoSymlinkOnPath(root, relativePath);',
      '  const absolute = path.resolve(root, relativePath);',
      '  const info = await lstat(absolute);',
      '  if (!info.isFile()) return null;',
      "  return readFile(absolute, 'utf8');",
      '}',
      '',
    ].join('\n'),
  );

  await write(useful[0], proseDocument(random, 'Threat model', 12));

  // Documentation named after the task. Each of these outranks the code on both
  // signals the selector uses: the terms sit in the path, and the body repeats
  // them. Each is large enough that two of them exhaust a 24 KiB budget.
  const decoys = [
    'docs/design/refuse-symlinked-paths.md',
    'docs/postmortems/symlinked-paths-during-compilation.md',
    'docs/benchmarks/refuse-symlinked-paths-report.md',
  ];
  await write(decoys[0], proseDocument(random, 'Why we refuse symlinked paths during compilation', 60));
  await write(decoys[1], proseDocument(random, 'Postmortem: symlinked paths during compilation', 60));
  await write(decoys[2], proseDocument(random, 'Benchmark report: refuse symlinked paths', 60));

  const planted = written.size;
  for (let i = 0; i < Math.max(0, fileCount - planted); i += 1) {
    const area = pick(random, AREAS);
    const stem = `${pick(random, WORDS)}-${pick(random, WORDS)}-${i}`;
    if (area === 'docs' || area === 'notes') await write(`${area}/${stem}.md`, `# ${stem}\n\n${paragraph(random, 4 + Math.floor(random() * 12))}\n`);
    else await write(`${area}/${stem}.mjs`, moduleBody(random, stem, 2 + Math.floor(random() * 10)));
  }

  return {
    root,
    seed,
    fileCount: written.size,
    totalBytes: [...written.values()].reduce((sum, value) => sum + value, 0),
    task: 'refuse symlinked paths during compilation',
    annotations: {
      requiredFiles: required,
      usefulFiles: useful,
      decoyFiles: decoys,
      secretFiles: [],
      syntheticSecretMarkers: [],
    },
  };
}
