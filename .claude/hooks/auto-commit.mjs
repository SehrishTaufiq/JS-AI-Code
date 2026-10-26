#!/usr/bin/env node
// Stop hook: commits any uncommitted work in the repo and pushes the current branch.
// Safety rules: never force-pushes, never rewrites history, skips during merge/rebase or on a
// detached HEAD, refuses to commit files that look like secrets, and never blocks Claude from
// stopping (always exits 0). The result is shown to the user as a one-line systemMessage.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Never let git wait for a password prompt or credential GUI inside a hook.
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const SECRET = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|ed25519|ecdsa)|credentials\.json|.*secret.*)$/i;

try {
  fs.readFileSync(0); // drain the hook payload; not needed here
} catch {}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, ...opts }).trim();
}

function tryGit(args) {
  try {
    return { ok: true, out: git(args) };
  } catch (err) {
    const msg = String(err.stderr || err.message || err).trim().split(/\r?\n/).filter(Boolean);
    return { ok: false, out: msg.slice(-2).join(' ') };
  }
}

function report(message) {
  if (message) console.log(JSON.stringify({ systemMessage: `auto-commit: ${message}` }));
  process.exit(0);
}

if (!tryGit(['rev-parse', '--is-inside-work-tree']).ok) report('');
for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
  if (fs.existsSync(git(['rev-parse', '--git-path', marker]))) report(`skipped, a ${marker} is in progress`);
}
const branch = tryGit(['symbolic-ref', '--short', 'HEAD']);
if (!branch.ok) report('skipped, HEAD is detached');

const notes = [];

// 1. Commit whatever is uncommitted (respects .gitignore).
git(['add', '-A']);
const staged = git(['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
const secrets = staged.filter((f) => SECRET.test(f));
if (secrets.length) {
  git(['restore', '--staged', '--', ...secrets]);
  notes.push(`left out ${secrets.length} secret-looking file(s): ${secrets.join(', ')}`);
}
const toCommit = staged.filter((f) => !secrets.includes(f));
if (toCommit.length) {
  const list = toCommit.slice(0, 20).map((f) => `- ${f}`).join('\n') + (toCommit.length > 20 ? `\n- ...and ${toCommit.length - 20} more` : '');
  const message = `Auto-commit on stop: ${toCommit.length} file(s)\n\n${list}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  const commit = tryGit(['commit', '-q', '-m', message]);
  notes.push(commit.ok ? `committed ${toCommit.length} file(s)` : `commit failed: ${commit.out}`);
}

// 2. Push if the branch has commits the remote does not.
const upstream = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
const ahead = upstream.ok ? Number(git(['rev-list', '--count', '@{u}..HEAD'])) : Number(git(['rev-list', '--count', 'HEAD']));
if (ahead > 0) {
  const push = tryGit(upstream.ok ? ['push', '-q'] : ['push', '-q', '-u', 'origin', branch.out]);
  notes.push(push.ok ? `pushed ${ahead} commit(s) to ${branch.out}` : `push FAILED, ${ahead} commit(s) still local: ${push.out}`);
}

report(notes.join('; '));
