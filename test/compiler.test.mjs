import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildContextPack, compileContextPack, selectFiles } from '../src/compiler.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contextforge-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'PROJECT.md'), '# Project\nThe billing parser needs a safe context pack.\n', 'utf8');
  await writeFile(path.join(root, 'src', 'billing.mjs'), 'export const apiKey = very-private-value;\nconst OPENAI_API_KEY=another-private-value;\nconst token = third-private-value;\nexport function parseBilling() { return true; }\n', 'utf8');
  await writeFile(path.join(root, '.env'), 'API_KEY=must-not-enter-a-pack\n', 'utf8');
  await writeFile(path.join(root, '.env.staging'), 'API_KEY=also-must-not-enter-a-pack\n', 'utf8');
  await writeFile(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=must-not-enter-a-pack\n', 'utf8');
  return root;
}

test('selection is bounded and excludes .env files', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const selected = await selectFiles({ root, query: 'billing parser', limit: 5 });
  assert.deepEqual(selected.map((entry) => entry.path), ['src/billing.mjs', 'PROJECT.md']);
});

test('selection excludes common credential files and secret-bearing environment variants', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const selected = await selectFiles({ root, query: 'api key', limit: 10 });
  assert.ok(selected.every((entry) => !entry.path.startsWith('.env') && entry.path !== '.npmrc'));
});

test('build creates an honest bounded pack and respects workspace ignore rules', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'private'));
  await writeFile(path.join(root, '.contextforgeignore'), 'private/\n', 'utf8');
  await writeFile(path.join(root, 'private', 'billing.md'), 'billing password=not-for-pack\n', 'utf8');
  const result = await buildContextPack({ root, task: 'billing parser', maxTokens: 128, limit: 5 });
  assert.equal(result.maxTokens, 128);
  assert.match(result.pack, /billing parser/i);
  assert.doesNotMatch(result.pack, /not-for-pack/);
  assert.equal(result.report.limits.estimatedTokenMethod, 'ceil(UTF-8 bytes / 4); approximation only');
  assert.ok(result.report.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test('compilation redacts secrets, enforces a byte budget, and reports reduction', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { pack, report } = await compileContextPack({
    root,
    plan: [{ path: 'PROJECT.md', reason: 'source of truth' }, { path: 'src/billing.mjs', reason: 'active code' }, { path: '.env', reason: 'must stay excluded' }],
    maxBytes: 512,
  });
  assert.match(pack, /apiKey = \[REDACTED\]/i);
  assert.match(pack, /OPENAI_API_KEY=\[REDACTED\]/);
  assert.match(pack, /token = \[REDACTED\]/i);
  assert.doesNotMatch(pack, /another-private-value|third-private-value/);
  assert.doesNotMatch(pack, /must-not-enter-a-pack/);
  assert.equal(report.redactions, 3);
  assert.ok(report.outputBytes <= 512);
  assert.equal(report.skipped[0].path, '.env');
});

test('compilation refuses a path that escapes the configured root', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => compileContextPack({ root, plan: ['../outside.md'] }), /outside the root/);
});

test('compilation rejects empty, absolute, or NUL-containing plan entries', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => compileContextPack({ root, plan: [] }), /non-empty plan array/);
  await assert.rejects(() => compileContextPack({ root, plan: [path.resolve(root, 'PROJECT.md')] }), /relative paths/);
  await assert.rejects(() => compileContextPack({ root, plan: ['src\0billing.mjs'] }), /relative paths/);
});

test('redaction covers private keys, GitHub tokens, credential URLs, and bearer tokens', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'src', 'credentials.mjs'), 'const gh = ghp_abcdefghijklmnopqrstuvwx;\nconst url = https://alice:very-secret@example.test/path;\nconst auth = Bearer abcdefghijklmnop;\n-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----\n', 'utf8');
  const { pack, report } = await compileContextPack({ root, plan: ['src/credentials.mjs'], maxBytes: 1024 });
  assert.doesNotMatch(pack, /abcdefghijklmnopqrstuvwx|very-secret|private-material/);
  assert.match(pack, /\[REDACTED GITHUB TOKEN\]|\[REDACTED\]/);
  assert.ok(report.redactions >= 4);
});

test('selection and compilation are deterministic for identical inputs', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await compileContextPack({ root, plan: ['PROJECT.md', 'src/billing.mjs'], maxBytes: 1024 });
  const second = await compileContextPack({ root, plan: ['PROJECT.md', 'src/billing.mjs'], maxBytes: 1024 });
  assert.deepEqual(first, second);
});

async function createLinkOrSkip(t, target, linkPath, type) {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('Symlink creation is unavailable in this Windows security context.');
      return false;
    }
    throw error;
  }
}

test('compilation never follows a direct symlink from an explicit plan', async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contextforge-outside-'));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const secretPath = path.join(outside, 'secret.md');
  await writeFile(secretPath, 'access_token=outside-root-secret', 'utf8');
  if (!await createLinkOrSkip(t, secretPath, path.join(root, 'linked-secret.md'), 'file')) return;

  const { pack, report } = await compileContextPack({ root, plan: ['linked-secret.md'] });
  assert.doesNotMatch(pack, /outside-root-secret/);
  assert.deepEqual(report.skipped, [{ path: 'linked-secret.md', reason: 'Refusing symlinked path: linked-secret.md' }]);
});

test('compilation never follows a symlinked directory from an explicit plan', async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contextforge-outside-'));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await writeFile(path.join(outside, 'secret.md'), 'password=outside-root-secret', 'utf8');
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  if (!await createLinkOrSkip(t, outside, path.join(root, 'linked-dir'), type)) return;

  const { pack, report } = await compileContextPack({ root, plan: ['linked-dir/secret.md'] });
  assert.doesNotMatch(pack, /outside-root-secret/);
  assert.deepEqual(report.skipped, [{ path: 'linked-dir/secret.md', reason: 'Refusing symlinked path: linked-dir/secret.md' }]);
});
