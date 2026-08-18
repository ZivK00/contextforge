// Baseline context-selection strategies.
//
// Every baseline is given the same repository, the same task string and the same
// byte budget as ContextForge. To keep the comparison honest, baselines reuse the
// same default exclusions (VCS metadata, dependencies, build output, dotenv and
// key material). The remaining difference is therefore selection quality and
// redaction, not directory hygiene.
//
// Baselines emit raw file content, which is what a person does when they paste
// files into a chat window. That is the behaviour under test.

import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRECTORIES = new Set(['.git', '.ssh', '.aws', '.gnupg', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', 'tmp', 'temp', 'archive', 'archives', '.contextforge']);
const EXCLUDED_BASENAMES = new Set(['.npmrc', '.netrc', '.pypirc', '.git-credentials', 'credentials', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);
const MAX_SCAN_FILE_BYTES = 256 * 1024;

const bytes = (value) => Buffer.byteLength(value, 'utf8');

function excluded(relativePath) {
  const parts = relativePath.split(path.sep).map((part) => part.toLowerCase());
  const basename = parts.at(-1);
  return parts.some((part) => EXCLUDED_DIRECTORIES.has(part))
    || basename.startsWith('.env')
    || EXCLUDED_BASENAMES.has(basename)
    || basename.endsWith('.pem')
    || basename.endsWith('.key');
}

export async function listFiles(root, directory = root, entries = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (excluded(relative)) continue;
    if (entry.isDirectory()) await listFiles(root, absolute, entries);
    else if (entry.isFile()) entries.push(relative.split(path.sep).join('/'));
  }
  return entries;
}

async function readBounded(root, relativePath) {
  const absolute = path.join(root, relativePath);
  const info = await lstat(absolute);
  if (!info.isFile() || info.size > MAX_SCAN_FILE_BYTES) return null;
  const raw = await readFile(absolute, 'utf8');
  return raw.includes('\0') ? null : raw;
}

async function loadAll(root) {
  const files = [];
  for (const relativePath of await listFiles(root)) {
    let content;
    try { content = await readBounded(root, relativePath); } catch { continue; }
    if (content === null) continue;
    files.push({ path: relativePath, content, bytes: bytes(content) });
  }
  return files;
}

function assemble(selected, budgetBytes) {
  // Concatenate whole files until the next file would not fit. This mirrors how a
  // person fills a context window: files go in complete, or they do not go in.
  const header = '# Context pack\n\n';
  let output = header;
  const emitted = [];
  for (const file of selected) {
    const section = `## ${file.path}\n\n${file.content}\n\n`;
    if (budgetBytes !== null && bytes(output) + bytes(section) > budgetBytes) continue;
    output += section;
    emitted.push(file);
  }
  return { pack: output, emitted };
}

function taskTerms(task) {
  return String(task).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2);
}

export const STRATEGIES = {
  'whole-repo': {
    label: 'Paste the whole repository (no budget)',
    async run({ root }) {
      const files = await loadAll(root);
      return assemble(files.sort((a, b) => a.path.localeCompare(b.path)), null);
    },
  },
  'budget-alphabetical': {
    label: 'Alphabetical order until the budget is full',
    async run({ root, budgetBytes }) {
      const files = await loadAll(root);
      return assemble(files.sort((a, b) => a.path.localeCompare(b.path)), budgetBytes);
    },
  },
  'budget-smallest-first': {
    label: 'Smallest files first (maximises file count under budget)',
    async run({ root, budgetBytes }) {
      const files = await loadAll(root);
      return assemble(files.sort((a, b) => a.bytes - b.bytes || a.path.localeCompare(b.path)), budgetBytes);
    },
  },
  'budget-largest-first': {
    label: 'Largest files first',
    async run({ root, budgetBytes }) {
      const files = await loadAll(root);
      return assemble(files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)), budgetBytes);
    },
  },
  'budget-grep': {
    label: 'Naive grep: every file containing a task term, path order',
    async run({ root, budgetBytes, task }) {
      const terms = taskTerms(task);
      const files = (await loadAll(root)).filter((file) => {
        const haystack = `${file.path}\n${file.content}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      });
      return assemble(files.sort((a, b) => a.path.localeCompare(b.path)), budgetBytes);
    },
  },
};

/**
 * Count how many synthetic secret markers survived into a pack.
 * A marker that appears in the pack means the strategy leaked credential-shaped text.
 */
export function countLeakedMarkers(pack, markers) {
  return markers.reduce((total, marker) => total + (pack.includes(marker) ? 1 : 0), 0);
}
