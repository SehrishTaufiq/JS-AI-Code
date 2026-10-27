// Repo-level rules from tickets #1 and #2 (CLAUDE.md), checked on the real working tree, so a
// change that breaks the factory's own conventions fails CI like any other bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const projects = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
  .map((d) => d.name);
const indexed = [...claude.matchAll(/^\|\s*\[`([^`/]+)\/`\]/gm)].map((m) => m[1]);

test('#2: CLAUDE.md stays under 100 lines', () => {
  const lines = claude.split(/\r?\n/).length;
  assert.ok(lines < 100, `CLAUDE.md has ${lines} lines`);
});

test('#2: CLAUDE.md explains the software factory and progressive disclosure', () => {
  assert.match(claude, /software factory/i);
  assert.match(claude, /progressive disclosure/i);
});

test('#2: every project folder is in the index, and every index row exists', () => {
  assert.deepEqual([...indexed].sort(), [...projects].sort(), `folders: ${projects.join(', ')}; index: ${indexed.join(', ')}`);
});

test('#2: every project folder has a README', () => {
  for (const p of projects) assert.ok(fs.existsSync(path.join(ROOT, p, 'README.md')), `${p}/README.md missing`);
});

test('#1: the research answer names Karachi and cites its source', () => {
  const answer = fs.readFileSync(path.join(ROOT, 'research', 'largest-city-pakistan.md'), 'utf8');
  assert.match(answer, /Karachi/);
  assert.match(answer, /^## Sources?\b/m);
  assert.match(answer, /census/i);
});
