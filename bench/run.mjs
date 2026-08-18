import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileContextPack, selectFiles } from '../src/compiler.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(await readFile(path.join(directory, 'scenarios.json'), 'utf8'));
const countMatches = (items, expected) => expected.filter((item) => items.includes(item)).length;
const results = [];

for (const scenario of scenarios) {
  const root = path.join(directory, 'fixtures', scenario.id);
  const selected = scenario.selectionQuery
    ? await selectFiles({ root, query: scenario.selectionQuery, limit: scenario.selectionLimit ?? 8 })
    : scenario.plan.map(({ path: file }) => ({ path: file, score: null }));
  const plan = scenario.plan ?? selected.map(({ path: file, score }) => ({ path: file, reason: `lexical score ${score}` }));
  const { report } = await compileContextPack({ root, plan, maxBytes: scenario.maxBytes });
  const emitted = report.files.map((file) => file.path);
  const requiredFound = countMatches(emitted, scenario.annotations.requiredFiles);
  const usefulFound = countMatches(emitted, scenario.annotations.usefulFiles);
  const expectedSecrets = scenario.annotations.syntheticSecrets ?? 0;
  results.push({
    id: scenario.id,
    purpose: scenario.purpose,
    selectionMode: scenario.selectionQuery ? 'lexical' : 'explicit-plan',
    sourceBytes: report.sourceBytes,
    outputBytes: report.outputBytes,
    estimatedSourceTokens: report.estimatedSourceTokens,
    estimatedOutputTokens: report.estimatedOutputTokens,
    reductionPercent: report.reductionPercent,
    selectedFiles: emitted,
    selectedFileCount: emitted.length,
    requiredFileRecall: scenario.annotations.requiredFiles.length === 0 ? null : Number((requiredFound / scenario.annotations.requiredFiles.length).toFixed(2)),
    selectionPrecision: emitted.length === 0 ? null : Number(((requiredFound + usefulFound) / emitted.length).toFixed(2)),
    syntheticSecretsExpected: expectedSecrets,
    syntheticSecretsDetected: report.redactions,
    syntheticSecretsMissed: Math.max(0, expectedSecrets - report.redactions),
    deterministicInput: true,
    elapsedMs: null,
    limits: report.limits
  });
}

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, methodology: 'fixture-only; file recall measures emitted file selection, not semantic completeness', scenarios: results }, null, 2)}\n`);
