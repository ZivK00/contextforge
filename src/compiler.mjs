import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRECTORIES = new Set(['.git', '.ssh', '.aws', '.gnupg', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', 'tmp', 'temp', 'archive', 'archives', '.contextforge']);
const EXCLUDED_BASENAMES = new Set(['.npmrc', '.netrc', '.pypirc', '.git-credentials', 'credentials', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);
const MAX_SCAN_FILE_BYTES = 256 * 1024;

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function bytes(value) { return Buffer.byteLength(value, 'utf8'); }
function estimatedTokens(byteCount) { return Math.ceil(byteCount / 4); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

function normalizeRoot(root) {
  if (!root) throw new Error('A root directory is required.');
  return path.resolve(root);
}

async function assertSafeRoot(root) {
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('The root must be a real directory, not a symlink or file.');
  return root;
}

function normalizeRelative(relativePath) { return relativePath.split(path.sep).join('/'); }

function resolveSafeFile(root, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.includes('\0') || path.isAbsolute(sourcePath)) throw new Error('Plan entries must use non-empty relative paths.');
  const candidate = path.resolve(root, sourcePath);
  if (!inside(root, candidate)) throw new Error(`Refusing a path outside the root: ${sourcePath}`);
  return candidate;
}

function excluded(relativePath) {
  const parts = relativePath.split(path.sep).map((part) => part.toLowerCase());
  const basename = parts.at(-1);
  return parts.some((part) => EXCLUDED_DIRECTORIES.has(part)) || basename.startsWith('.env') || EXCLUDED_BASENAMES.has(basename) || basename.endsWith('.pem') || basename.endsWith('.key');
}

function escapeRegex(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

function globMatches(relativePath, pattern) {
  const normalizedPath = normalizeRelative(relativePath);
  const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
  const wildcardPattern = escapeRegex(normalizedPattern).replaceAll('**', '__CONTEXTFORGE_GLOBSTAR__').replaceAll('*', '[^/]*').replaceAll('__CONTEXTFORGE_GLOBSTAR__', '.*');
  const regex = new RegExp(`^${wildcardPattern}$`);
  return regex.test(normalizedPath);
}

function ignoredByRules(relativePath, rules) {
  const normalized = normalizeRelative(relativePath);
  return rules.some((rule) => {
    if (rule.endsWith('/')) {
      const directory = rule.slice(0, -1);
      return normalized === directory || normalized.startsWith(`${directory}/`) || normalized.split('/').includes(directory);
    }
    if (rule.includes('/')) return globMatches(normalized, rule);
    return globMatches(path.posix.basename(normalized), rule);
  });
}

async function ignoreRules(root) {
  const rules = [];
  for (const file of ['.gitignore', '.contextforgeignore']) {
    try {
      const text = await readFile(path.join(root, file), 'utf8');
      for (const raw of text.split(/\r?\n/)) {
        const rule = raw.trim();
        if (!rule || rule.startsWith('#') || rule.startsWith('!')) continue;
        rules.push(rule.replace(/^\//, ''));
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return rules;
}

function redact(text) {
  let count = 0;
  const redacted = text.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, () => {
    count += 1;
    return '[REDACTED PRIVATE KEY]';
  }).replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, (_match, scheme) => {
    count += 1;
    return `${scheme}[REDACTED]@`;
  }).replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, () => {
    count += 1;
    return '[REDACTED GITHUB TOKEN]';
  }).replace(/((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password))(\s*[:=]\s*)([^\s,;"']+)/gi, (_match, label, separator) => {
    count += 1;
    return `${label}${separator}[REDACTED]`;
  }).replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/g, () => {
    count += 1;
    return 'Bearer [REDACTED]';
  });
  return { text: redacted, count };
}

function truncateUtf8(text, limit) {
  if (limit <= 0) return '';
  let output = '';
  let used = 0;
  for (const character of text) {
    const next = bytes(character);
    if (used + next > limit) break;
    output += character;
    used += next;
  }
  return output;
}

async function readText(root, relativePath) {
  const absolutePath = resolveSafeFile(root, relativePath);
  let current = root;
  for (const part of relativePath.split(/[\\/]+/)) {
    current = path.join(current, part);
    const segment = await lstat(current);
    if (segment.isSymbolicLink()) throw new Error(`Refusing symlinked path: ${relativePath}`);
  }
  const info = await lstat(absolutePath);
  if (!info.isFile() || info.size > MAX_SCAN_FILE_BYTES) return null;
  const raw = await readFile(absolutePath, 'utf8');
  if (raw.includes('\0')) return null;
  return raw;
}

async function walk(root, directory = root, entries = [], rules = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (excluded(relative) || ignoredByRules(relative, rules)) continue;
    if (entry.isDirectory()) await walk(root, absolute, entries, rules);
    else if (entry.isFile()) entries.push(relative);
  }
  return entries;
}

export async function selectFiles({ root, query, limit = 8 }) {
  const resolvedRoot = await assertSafeRoot(normalizeRoot(root));
  const terms = String(query ?? '').toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2);
  if (terms.length === 0) throw new Error('Selection requires a query with at least one two-character term.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Limit must be an integer between 1 and 50.');
  const candidates = [];
  const rules = await ignoreRules(resolvedRoot);
  for (const relativePath of await walk(resolvedRoot, resolvedRoot, [], rules)) {
    let content;
    try { content = await readText(resolvedRoot, relativePath); } catch { continue; }
    if (content === null) continue;
    const lower = content.toLowerCase();
    const lowerPath = relativePath.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.split(term).length - 1) + (lowerPath.includes(term) ? 3 : 0), 0);
    if (score > 0) candidates.push({ path: normalizeRelative(relativePath), score, bytes: bytes(content) });
  }
  return candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/**
 * Divide `total` bytes across `sizes` using max-min fair allocation.
 *
 * Files are served smallest first. Each takes the lesser of what it needs and an
 * equal share of what is left, so anything that fits within its share is included
 * whole, and only files larger than their share are truncated. The alternative —
 * filling greedily by rank — lets the first entry consume the budget and starve
 * every later one, including small files that would have cost almost nothing.
 */
function fairByteShares(sizes, total) {
  const allocation = new Array(sizes.length).fill(0);
  const order = sizes.map((size, index) => ({ size, index })).sort((left, right) => left.size - right.size || left.index - right.index);
  let remaining = Math.max(0, total);
  let unserved = sizes.length;
  for (const { size, index } of order) {
    const share = Math.floor(remaining / unserved);
    const granted = Math.min(size, share);
    allocation[index] = granted;
    remaining -= granted;
    unserved -= 1;
  }
  return allocation;
}

export async function compileContextPack({ root, plan, maxBytes = 16_384 }) {
  const resolvedRoot = await assertSafeRoot(normalizeRoot(root));
  if (!Array.isArray(plan) || plan.length === 0) throw new Error('Compilation requires a non-empty plan array.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || maxBytes > 1_000_000) throw new Error('maxBytes must be an integer between 512 and 1,000,000.');

  const header = '# ContextForge pack\n\nGenerated locally. Review before sending to any model.\n\n';
  let sourceBytes = 0;
  let redactions = 0;
  const files = [];
  const skipped = [];
  const seen = new Set();
  const rules = await ignoreRules(resolvedRoot);

  // Pass 1: resolve, read and redact every eligible entry. Byte allocation needs
  // to know the size of everything before it can be fair about anything.
  const prepared = [];
  for (const entry of plan) {
    const relativePath = typeof entry === 'string' ? entry : entry?.path;
    const reason = typeof entry === 'string' ? 'Selected by plan.' : entry?.reason ?? 'Selected by plan.';
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    if (typeof relativePath !== 'string') throw new Error('Every plan entry needs a relative path.');
    resolveSafeFile(resolvedRoot, relativePath);
    if (excluded(relativePath)) { skipped.push({ path: relativePath, reason: 'excluded by default policy' }); continue; }
    if (ignoredByRules(relativePath, rules)) { skipped.push({ path: relativePath, reason: 'excluded by workspace ignore rules' }); continue; }
    let raw;
    try { raw = await readText(resolvedRoot, relativePath); } catch (error) { skipped.push({ path: relativePath, reason: error.message }); continue; }
    if (raw === null) { skipped.push({ path: relativePath, reason: 'not a bounded text file' }); continue; }
    const safe = redact(raw);
    prepared.push({ relativePath, reason, raw, safe, section: `## ${relativePath}\nReason: ${reason}\n\n` });
  }

  // Pass 2: reserve each entry's section header in plan order, then share what is
  // left over the bodies. An entry whose header no longer fits is dropped here.
  const trailer = bytes('\n\n');
  let overhead = bytes(header);
  const admitted = [];
  for (const item of prepared) {
    const cost = bytes(item.section) + trailer;
    if (overhead + cost >= maxBytes) { skipped.push({ path: item.relativePath, reason: 'context budget exhausted' }); continue; }
    overhead += cost;
    admitted.push(item);
  }
  const shares = fairByteShares(admitted.map((item) => bytes(item.safe.text)), maxBytes - overhead);

  // Pass 3: emit in plan order.
  let output = header;
  admitted.forEach((item, index) => {
    const allowance = shares[index];
    if (allowance <= 0 && bytes(item.safe.text) > 0) { skipped.push({ path: item.relativePath, reason: 'context budget exhausted' }); return; }
    sourceBytes += bytes(item.raw);
    redactions += item.safe.count;
    const body = truncateUtf8(item.safe.text, allowance);
    output += `${item.section}${body}\n\n`;
    files.push({ path: normalizeRelative(item.relativePath), reason: item.reason, sourceBytes: bytes(item.raw), emittedBytes: bytes(body), estimatedSourceTokens: estimatedTokens(bytes(item.raw)), estimatedEmittedTokens: estimatedTokens(bytes(body)), sha256: sha256(item.raw), redactions: item.safe.count, truncated: bytes(body) < bytes(item.safe.text) });
  });

  const outputBytes = bytes(output);
  return {
    pack: output,
    report: {
      schemaVersion: 1,
      sourceBytes,
      outputBytes,
      estimatedSourceTokens: estimatedTokens(sourceBytes),
      estimatedOutputTokens: estimatedTokens(outputBytes),
      reductionPercent: sourceBytes === 0 ? 0 : Number((((sourceBytes - outputBytes) / sourceBytes) * 100).toFixed(2)),
      files,
      skipped,
      redactions,
      limits: { maxBytes, estimatedTokenMethod: 'ceil(UTF-8 bytes / 4); approximation only', maxScanFileBytes: MAX_SCAN_FILE_BYTES, byteAllocation: 'max-min fair share across planned files' },
    },
  };
}

export async function buildContextPack({ root, task, maxTokens = 4096, limit = 8 }) {
  if (typeof task !== 'string' || task.trim().length < 2) throw new Error('Build requires a task with at least two characters.');
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 128 || maxTokens > 250_000) throw new Error('maxTokens must be an integer between 128 and 250,000.');
  const selected = await selectFiles({ root, query: task, limit });
  if (selected.length === 0) throw new Error('No eligible text files matched the task. Use select or an explicit compile plan.');
  const plan = selected.map(({ path: file, score }) => ({ path: file, reason: `lexical score ${score} for task: ${task.trim()}` }));
  const result = await compileContextPack({ root, plan, maxBytes: maxTokens * 4 });
  return { ...result, task: task.trim(), selected, maxTokens };
}
