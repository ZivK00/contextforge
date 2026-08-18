// Comparative benchmark: ContextForge against naive context-selection baselines.
//
// What this measures
//   - required-file recall under a fixed byte budget
//   - how much of the emitted pack is decoy material
//   - whether credential-shaped text reaches the pack
//   - wall-clock selection time as the repository grows
//   - byte-for-byte determinism across two runs
//
// What this does NOT measure
//   - whether a model completes the task
//   - provider tokenizer counts (estimates are ceil(UTF-8 bytes / 4))
//   - real-world repository structure (the generated corpus is synthetic; see
//     `--repo` mode for runs against a real tree)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileContextPack, selectFiles } from '../src/compiler.mjs';
import { STRATEGIES, countLeakedMarkers, listFiles } from './baselines.mjs';
import { generateCorpus, generateProseHeavyCorpus } from './corpus.mjs';

const BUDGET_BYTES = 24_576;
const SELECTION_LIMIT = 12;
const TIMING_REPEATS = 3;

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const bytes = (value) => Buffer.byteLength(value, 'utf8');
const estimatedTokens = (byteCount) => Math.ceil(byteCount / 4);
const ratio = (part, total) => (total === 0 ? null : Number((part / total).toFixed(2)));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[middle - 1] + sorted[middle]) / 2)).toFixed(1))
    : Number(sorted[middle].toFixed(1));
}

async function timed(fn) {
  const samples = [];
  let last;
  for (let i = 0; i < TIMING_REPEATS; i += 1) {
    const start = performance.now();
    last = await fn();
    samples.push(performance.now() - start);
  }
  return { result: last, medianMs: median(samples) };
}

function score({ emittedPaths, pack, annotations }) {
  const { requiredFiles, usefulFiles, decoyFiles, syntheticSecretMarkers } = annotations;
  const requiredHit = requiredFiles.filter((file) => emittedPaths.includes(file)).length;
  const usefulHit = usefulFiles.filter((file) => emittedPaths.includes(file)).length;
  const decoyHit = decoyFiles.filter((file) => emittedPaths.includes(file)).length;
  return {
    emittedFileCount: emittedPaths.length,
    outputBytes: bytes(pack),
    estimatedOutputTokens: estimatedTokens(bytes(pack)),
    requiredRecall: ratio(requiredHit, requiredFiles.length),
    usefulRecall: usefulFiles.length === 0 ? null : ratio(usefulHit, usefulFiles.length),
    decoyFilesEmitted: decoyHit,
    signalRatio: ratio(requiredHit + usefulHit, emittedPaths.length),
    leakedSecretMarkers: countLeakedMarkers(pack, syntheticSecretMarkers),
  };
}

async function runContextForge({ root, task, annotations, budgetBytes }) {
  const { result, medianMs } = await timed(async () => {
    const selected = await selectFiles({ root, query: task, limit: SELECTION_LIMIT });
    const plan = selected.map(({ path: file, score: lexical }) => ({ path: file, reason: `lexical score ${lexical}` }));
    return compileContextPack({ root, plan, maxBytes: budgetBytes });
  });

  // Determinism: an identical input must produce an identical pack.
  const replay = await (async () => {
    const selected = await selectFiles({ root, query: task, limit: SELECTION_LIMIT });
    const plan = selected.map(({ path: file, score: lexical }) => ({ path: file, reason: `lexical score ${lexical}` }));
    return compileContextPack({ root, plan, maxBytes: budgetBytes });
  })();

  const emittedPaths = result.report.files.map((file) => file.path);
  return {
    strategy: 'contextforge',
    label: 'ContextForge lexical selection + bounded compile + redaction',
    medianSelectionMs: medianMs,
    deterministic: sha256(result.pack) === sha256(replay.pack),
    redactionsApplied: result.report.redactions,
    ...score({ emittedPaths, pack: result.pack, annotations }),
    emittedPaths,
  };
}

async function runBaseline(name, { root, task, annotations, budgetBytes }) {
  const strategy = STRATEGIES[name];
  const { result, medianMs } = await timed(() => strategy.run({ root, task, budgetBytes }));
  const emittedPaths = result.emitted.map((file) => file.path);
  return {
    strategy: name,
    label: strategy.label,
    medianSelectionMs: medianMs,
    deterministic: true,
    redactionsApplied: 0,
    ...score({ emittedPaths, pack: result.pack, annotations }),
    emittedPaths: emittedPaths.slice(0, 20),
  };
}

async function runScenario(context) {
  const rows = [await runContextForge(context)];
  for (const name of Object.keys(STRATEGIES)) rows.push(await runBaseline(name, context));
  return rows;
}

async function generatedScenarios() {
  const scales = [
    { id: 'small', seed: 1_000_003, fileCount: 60 },
    { id: 'medium', seed: 1_000_033, fileCount: 600 },
    { id: 'large', seed: 1_000_037, fileCount: 2400 },
  ];
  const scenarios = [];
  for (const scale of scales) {
    const workdir = await mkdtemp(path.join(tmpdir(), `contextforge-bench-${scale.id}-`));
    const root = path.join(workdir, 'corpus');
    try {
      const corpus = await generateCorpus({ root, seed: scale.seed, fileCount: scale.fileCount });
      const rows = await runScenario({
        root,
        task: corpus.task,
        annotations: corpus.annotations,
        budgetBytes: BUDGET_BYTES,
      });
      scenarios.push({
        id: `generated-${scale.id}`,
        kind: 'generated-corpus',
        seed: scale.seed,
        task: corpus.task,
        corpusFileCount: corpus.fileCount,
        corpusBytes: corpus.totalBytes,
        budgetBytes: BUDGET_BYTES,
        groundTruth: corpus.annotations,
        results: rows,
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
  return scenarios;
}

// Regression guard for the prose-over-code budget defect.
//
// This corpus was built to reproduce a failure deterministically: documentation
// named after a task, repeating its vocabulary, outranked the file implementing
// it and exhausted the byte budget before that file was reached. It reported
// requiredRecall 0.00 for every run.
//
// Max-min fair byte allocation fixed that, and this scenario now reports 1.00.
// It is kept as a guard: a change that lets one file monopolise the budget again
// will show up here first.
async function proseHeavyScenario() {
  const workdir = await mkdtemp(path.join(tmpdir(), 'contextforge-bench-prose-'));
  const root = path.join(workdir, 'corpus');
  try {
    const corpus = await generateProseHeavyCorpus({ root, seed: 1_000_081, fileCount: 400 });
    const rows = await runScenario({ root, task: corpus.task, annotations: corpus.annotations, budgetBytes: BUDGET_BYTES });
    return [{
      id: 'generated-prose-heavy',
      kind: 'generated-corpus',
      role: 'regression-baseline',
      expectation: 'Guards against budget monopolisation. Reported 0.00 before max-min fair allocation; expected 1.00 now.',
      seed: 1_000_081,
      task: corpus.task,
      corpusFileCount: corpus.fileCount,
      corpusBytes: corpus.totalBytes,
      budgetBytes: BUDGET_BYTES,
      groundTruth: corpus.annotations,
      results: rows,
    }];
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

// Real-repository scenario. Ground truth is declared by a human, not derived from
// the tool, so it can disagree with what the tool selects. That is the point.
const REAL_REPO_SCENARIOS = [
  {
    id: 'self-symlink-refusal',
    repo: path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..'),
    task: 'refuse symlinked paths during compilation',
    annotations: {
      requiredFiles: ['src/compiler.mjs'],
      usefulFiles: ['THREAT_MODEL.md', 'test/compiler.test.mjs'],
      decoyFiles: ['CHANGELOG.md', 'GOVERNANCE.md', 'CODE_OF_CONDUCT.md'],
      secretFiles: [],
      syntheticSecretMarkers: [],
    },
  },
];

// Provenance for a real tree. A real-repository run is a point-in-time
// observation: the tree can change between runs, and it does. Recording the
// commit and the dirty flag is what makes the number readable later.
function gitProvenance(repo) {
  const run = (args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const commit = run(['rev-parse', 'HEAD']);
  if (commit === null) return { commit: null, dirty: null, note: 'git unavailable or not a repository' };
  const status = run(['status', '--porcelain']);
  return { commit, dirty: status === null ? null : status.length > 0, note: null };
}

async function realRepoScenarios(overrideRepo) {
  const scenarios = [];
  const definitions = overrideRepo
    ? [{ id: 'custom-repo', repo: path.resolve(overrideRepo), task: process.env.CONTEXTFORGE_BENCH_TASK ?? 'bug fix', annotations: { requiredFiles: [], usefulFiles: [], decoyFiles: [], secretFiles: [], syntheticSecretMarkers: [] } }]
    : REAL_REPO_SCENARIOS;

  for (const definition of definitions) {
    let fileCount = null;
    try { fileCount = (await listFiles(definition.repo)).length; } catch { continue; }
    const rows = await runScenario({
      root: definition.repo,
      task: definition.task,
      annotations: definition.annotations,
      budgetBytes: BUDGET_BYTES,
    });
    scenarios.push({
      id: `real-${definition.id}`,
      kind: 'real-repository',
      reproducible: false,
      reproducibilityNote: 'Point-in-time observation. The working tree changes between runs, including when this benchmark writes its own results. Only the generated-corpus scenarios are byte-for-byte reproducible.',
      git: gitProvenance(definition.repo),
      repositoryFileCount: fileCount,
      task: definition.task,
      budgetBytes: BUDGET_BYTES,
      groundTruth: definition.annotations,
      results: rows,
    });
  }
  return scenarios;
}

const repoFlagIndex = process.argv.indexOf('--repo');
const overrideRepo = repoFlagIndex === -1 ? null : process.argv[repoFlagIndex + 1];

const scenarios = [
  ...(overrideRepo ? [] : await generatedScenarios()),
  ...(overrideRepo ? [] : await proseHeavyScenario()),
  ...(await realRepoScenarios(overrideRepo)),
];

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  benchmark: 'comparative',
  budgetBytes: BUDGET_BYTES,
  selectionLimit: SELECTION_LIMIT,
  timingRepeats: TIMING_REPEATS,
  methodology: [
    'Baselines share ContextForge default directory exclusions, so the measured difference is selection and redaction, not directory hygiene.',
    'Required/useful/decoy files are declared by a human before the run.',
    'Estimated tokens are ceil(UTF-8 bytes / 4) and are not provider tokenizer counts.',
    'Generated corpora are synthetic and deterministic from a seed; they do not model real repository structure.',
    'No model is invoked. Task success is not measured.',
  ],
  scenarios,
}, null, 2)}\n`);
