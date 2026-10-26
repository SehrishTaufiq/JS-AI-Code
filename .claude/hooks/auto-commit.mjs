#!/usr/bin/env node
// Stop hook: publishes the prompt log and commits/pushes work on ticket branches.
//
// 1. The prompt log (.claude/logs/prompts.jsonl, gitignored in the working tree) is committed
//    to its own branch, `prompt-log`, with git plumbing, without touching the working tree or the
//    current branch, and pushed. Keeping it off ticket branches means PRs never conflict over it
//    and it never changes a branch's last-commit date (used to spot new review feedback).
// 2. On a ticket/review branch: commits all leftover changes and pushes that branch.
//    On the default branch (main): commits and pushes nothing. Work reaches main only through
//    reviewed PRs; leftovers there are reported.
//
// Safety: never force-pushes, never rewrites history, skips during merge/rebase or on a detached
// HEAD, refuses to commit secret-looking files, never blocks Claude from stopping (always exits 0).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Never let git wait for a password prompt or credential GUI inside a hook.
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const SECRET = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|ed25519|ecdsa)|credentials\.json|.*secret.*)$/i;
const LOG_FILE = '.claude/logs/prompts.jsonl';
const LOG_BRANCH = 'prompt-log';
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

try {
  fs.readFileSync(0); // drain the hook payload; not needed here
} catch {}

function git(args, input) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();
}

function tryGit(args, input) {
  try {
    return { ok: true, out: git(args, input) };
  } catch (err) {
    const msg = String(err.stderr || err.message || err).trim().split(/\r?\n/).filter(Boolean);
    return { ok: false, out: msg.slice(-2).join(' ') };
  }
}

function report(notes) {
  const msg = notes.filter(Boolean).join('; ');
  if (msg) console.log(JSON.stringify({ systemMessage: `auto-commit: ${msg}` }));
  process.exit(0);
}

if (!tryGit(['rev-parse', '--is-inside-work-tree']).ok) report([]);

const notes = [];

// 1. Prompt log -> its own branch, via plumbing (blob -> trees -> commit -> ref).
function publishLog() {
  const file = path.join(cwd, LOG_FILE);
  if (!fs.existsSync(file)) return null;
  const blob = git(['hash-object', '-w', '--', file]);
  const local = tryGit(['rev-parse', '--verify', '-q', `refs/heads/${LOG_BRANCH}`]);
  const remote = tryGit(['rev-parse', '--verify', '-q', `refs/remotes/origin/${LOG_BRANCH}`]);
  const parent = local.ok ? local.out : remote.ok ? remote.out : null;
  if (parent && tryGit(['rev-parse', `${parent}:${LOG_FILE}`]).out === blob) {
    // Unchanged; still push if an earlier push failed.
  } else {
    const logs = git(['mktree'], `100644 blob ${blob}\tprompts.jsonl\n`);
    const claude = git(['mktree'], `040000 tree ${logs}\tlogs\n`);
    const root = git(['mktree'], `040000 tree ${claude}\t.claude\n`);
    const commit = git(['commit-tree', root, ...(parent ? ['-p', parent] : []), '-m', `Prompt log update\n\n${TRAILER}`]);
    git(['update-ref', `refs/heads/${LOG_BRANCH}`, commit]);
  }
  const ahead = remote.ok ? Number(git(['rev-list', '--count', `origin/${LOG_BRANCH}..${LOG_BRANCH}`])) : 1;
  if (!ahead) return null;
  const push = tryGit(['push', '-q', 'origin', `${LOG_BRANCH}:${LOG_BRANCH}`]);
  return push.ok ? 'prompt log pushed' : `prompt log saved on ${LOG_BRANCH}, push FAILED: ${push.out}`;
}
try {
  notes.push(publishLog());
} catch (err) {
  notes.push(`prompt log not published: ${String(err.message).split('\n')[0]}`);
}

// 2. Work on the current branch.
for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
  if (fs.existsSync(path.resolve(cwd, git(['rev-parse', '--git-path', marker])))) report([...notes, `skipped commit, a ${marker} is in progress`]);
}
const branch = tryGit(['symbolic-ref', '--short', 'HEAD']);
if (!branch.ok) report([...notes, 'skipped commit, HEAD is detached']);
const defaultBranch = (tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).out || 'origin/main').replace(/^origin\//, '');

if (branch.out === defaultBranch || branch.out === LOG_BRANCH) {
  const left = git(['status', '--porcelain']).split(/\r?\n/).filter(Boolean);
  if (left.length) notes.push(`${left.length} change(s) left uncommitted on ${branch.out} (work goes on a ticket branch + PR)`);
  report(notes);
}

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
  const commit = tryGit(['commit', '-q', '-m', `Auto-commit on stop: ${toCommit.length} file(s)\n\n${list}\n\n${TRAILER}`]);
  notes.push(commit.ok ? `committed ${toCommit.length} file(s)` : `commit failed: ${commit.out}`);
}

// Push when the remote lacks commits: vs the upstream, or vs the default branch for a new branch.
const upstream = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
const range = upstream.ok ? '@{u}..HEAD' : `origin/${defaultBranch}..HEAD`;
const ahead = Number(tryGit(['rev-list', '--count', range]).out || 0);
if (ahead > 0) {
  const push = tryGit(upstream.ok ? ['push', '-q'] : ['push', '-q', '-u', 'origin', branch.out]);
  notes.push(push.ok ? `pushed ${branch.out} (${ahead} commit(s) ahead)` : `push of ${branch.out} FAILED (${ahead} commit(s) not on GitHub): ${push.out}`);
}

report(notes);
