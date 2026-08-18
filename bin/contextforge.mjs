#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContextPack, compileContextPack, selectFiles } from '../src/compiler.mjs';

const VERSION = '0.1.0';

function args(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) parsed[name] = true;
    else { parsed[name] = next; index += 1; }
  }
  return parsed;
}

function help() {
  console.log('contextforge build --workspace <dir> --task <task> [--budget 4096] [--limit 8] [--out .contextforge] [--dry-run]');
  console.log('contextforge inspect --dir <contextforge-output-dir>');
  console.log('contextforge init [--workspace <dir>]');
  console.log('contextforge select --root <dir> --query <terms> [--limit 8] [--out plan.json]');
  console.log('contextforge compile --root <dir> --plan <plan.json> --out <pack.md> --report <report.json> [--max-bytes 16384]');
  console.log('contextforge --version');
}

function artifacts(result) {
  const createdAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    generatedAt: createdAt,
    task: result.task,
    selectedFiles: result.report.files.map(({ path: file, sha256, reason }) => ({ path: file, sha256, reason })),
    excludedFiles: result.report.skipped,
    localOnly: true,
  };
  return {
    'CONTEXT.md': result.pack,
    'FILES.json': `${JSON.stringify(result.report.files, null, 2)}\n`,
    'MANIFEST.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'DECISIONS.md': `# ContextForge decisions\n\n- Task: ${result.task}\n- Selection: lexical ranking, maximum ${result.selected.length} file(s).\n- Budget: ${result.maxTokens} estimated tokens (implemented as ${result.maxTokens * 4} UTF-8 bytes).\n- Review: generated locally; human review is required before sharing.\n`,
    'RISKS.md': '# ContextForge risks\n\n- Redaction is pattern-based and cannot prove that sensitive data is absent.\n- Token figures are byte-based estimates, not tokenizer measurements.\n- A lexical selector can omit relevant files; use `select` and `compile` for an explicit plan.\n- Inspect CONTEXT.md before sending it to any model or service.\n',
    'REDACTIONS.json': `${JSON.stringify({ count: result.report.redactions, method: 'common inline assignment and bearer-token patterns; review required' }, null, 2)}\n`,
    'METRICS.json': `${JSON.stringify(result.report, null, 2)}\n`,
  };
}

const [command, ...rest] = process.argv.slice(2);
const options = args(rest);
if (!command || command === 'help' || command === '--help') { help(); process.exit(0); }
if (command === '--version' || command === 'version') { process.stdout.write(`${VERSION}\n`); process.exit(0); }

try {
  if (command === 'build') {
    const root = options.workspace;
    if (!root || !options.task) throw new Error('build requires --workspace and --task.');
    const result = await buildContextPack({ root, task: options.task, maxTokens: Number(options.budget ?? 4096), limit: Number(options.limit ?? 8) });
    const outputDirectory = path.resolve(options.out ?? path.join(root, '.contextforge'));
    const output = artifacts(result);
    if (!options['dry-run']) {
      await mkdir(outputDirectory, { recursive: true });
      await Promise.all(Object.entries(output).map(([name, content]) => writeFile(path.join(outputDirectory, name), content, 'utf8')));
    }
    process.stdout.write(`${JSON.stringify({ dryRun: Boolean(options['dry-run']), outputDirectory, artifacts: Object.keys(output), metrics: { sourceBytes: result.report.sourceBytes, outputBytes: result.report.outputBytes, estimatedSourceTokens: result.report.estimatedSourceTokens, estimatedOutputTokens: result.report.estimatedOutputTokens, reductionPercent: result.report.reductionPercent, redactions: result.report.redactions } }, null, 2)}\n`);
  } else if (command === 'inspect') {
    if (!options.dir) throw new Error('inspect requires --dir.');
    const directory = path.resolve(options.dir);
    const manifest = JSON.parse(await readFile(path.join(directory, 'MANIFEST.json'), 'utf8'));
    const metrics = JSON.parse(await readFile(path.join(directory, 'METRICS.json'), 'utf8'));
    process.stdout.write(`${JSON.stringify({ task: manifest.task, files: manifest.selectedFiles.length, redactions: metrics.redactions, metrics: { sourceBytes: metrics.sourceBytes, outputBytes: metrics.outputBytes, estimatedSourceTokens: metrics.estimatedSourceTokens, estimatedOutputTokens: metrics.estimatedOutputTokens, reductionPercent: metrics.reductionPercent } }, null, 2)}\n`);
  } else if (command === 'init') {
    const root = path.resolve(options.workspace ?? process.cwd());
    const target = path.join(root, '.contextforgeignore');
    const template = '# Add workspace-local paths ContextForge must not read.\n# Supports simple *, ** and directory/ patterns.\nprivate/\n*.pem\n*.key\n';
    await writeFile(target, template, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ created: target }, null, 2)}\n`);
  } else if (command === 'select') {
    const selected = await selectFiles({ root: options.root, query: options.query, limit: Number(options.limit ?? 8) });
    const output = `${JSON.stringify(selected.map(({ path: file, score }) => ({ path: file, reason: `lexical score ${score}` })), null, 2)}\n`;
    if (options.out) await writeFile(path.resolve(options.out), output, 'utf8');
    else process.stdout.write(output);
  } else if (command === 'compile') {
    if (!options.plan || !options.out || !options.report) throw new Error('compile requires --plan, --out, and --report.');
    const plan = JSON.parse(await readFile(path.resolve(options.plan), 'utf8'));
    const result = await compileContextPack({ root: options.root, plan, maxBytes: Number(options['max-bytes'] ?? 16_384) });
    await writeFile(path.resolve(options.out), result.pack, 'utf8');
    await writeFile(path.resolve(options.report), `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ output: path.resolve(options.out), report: path.resolve(options.report), metrics: result.report }, null, 2)}\n`);
  } else {
    help();
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`contextforge: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
