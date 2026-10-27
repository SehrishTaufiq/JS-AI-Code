#!/usr/bin/env node
// PostToolUse hook (Edit|Write): runs the fast tests related to the file Claude just changed and,
// if they fail, reports the failure back to Claude (exit 2) so it fixes it before moving on,
// rather than the Stop hook committing and pushing a broken change.
//   todo/*.js (not e2e)          -> todo unit tests (node --test, about 1s)
//   .claude/hooks/guard-rules.mjs -> guard rule table
//   .claude/hooks/secrets.mjs     -> secret pattern tests
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {}

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = input.tool_input?.file_path || input.tool_response?.filePath;
if (!file) process.exit(0);
const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');

let suite = null;
if (/^todo\/(?!e2e\/|node_modules\/).*\.(m?js)$/.test(rel)) suite = { cwd: path.join(root, 'todo'), args: ['--test'], name: 'todo unit tests' };
else if (rel === '.claude/hooks/guard-rules.mjs') suite = { cwd: root, args: ['--test', '.claude/tests/guard.test.mjs'], name: 'guard rule tests' };
else if (rel === '.claude/hooks/secrets.mjs') suite = { cwd: root, args: ['--test', '.claude/tests/secrets.test.mjs'], name: 'secret pattern tests' };
if (!suite) process.exit(0);

const res = spawnSync(process.execPath, suite.args, { cwd: suite.cwd, encoding: 'utf8', timeout: 60_000 });
if (res.status === 0) process.exit(0);

const out = `${res.stdout}\n${res.stderr}`;
const failures = out.split(/\r?\n/).filter((l) => /^not ok|^\s+(error|expected|actual|message):|AssertionError/.test(l)).slice(0, 30);
process.stderr.write(`${suite.name} failed after editing ${rel}:\n${failures.join('\n') || out.slice(-2000)}\nFix this before continuing.\n`);
process.exit(2);
