#!/usr/bin/env node
// Lists the GitHub issues ("tickets") of the repo in the current directory and works out where
// each one is in the review-first flow: todo, in progress on a branch, ready for a PR, awaiting
// review, feedback to address, or done (closed after the human merged its PR).
// Needs only Node 18+ and git; no gh CLI.
//
// Usage: node fetch-tickets.mjs [--state all|open|closed] [--json] [--no-fetch]
// Runs `git fetch` first so remote state is current. API responses are ETag-cached in
// .git/factory-loop/, so polling every minute stays within the 60/h unauthenticated limit.
// Set GITHUB_TOKEN or GH_TOKEN for private repos or 5000 requests/hour.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { apiList, arg, factoryConfig, git, MARKER, prDraftPath, quietEnv, repoSlug, saveCache, stateDir } from './lib.mjs';

const args = process.argv.slice(2);
const state = arg(args, '--state') ?? 'all';
const asJson = args.includes('--json');

const slug = repoSlug();
if (!args.includes('--no-fetch')) {
  try {
    execFileSync('git', ['fetch', '-q', '--prune', 'origin'], { stdio: 'ignore', timeout: 30_000, env: quietEnv });
  } catch {
    console.error('warning: git fetch failed; remote status may be stale');
  }
}
const defaultBranch = (git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD') || 'origin/main').replace(/^origin\//, '');

const closesRe = (n) => new RegExp(`(close[sd]?|fix(e[sd])?|resolve[sd]?) #${n}([^0-9]|$)`, 'i');

// Newest local commit (any branch) that closes #n, and where it lives.
function localWork(n) {
  const sha = git('log', '--all', '-1', '--format=%h', '-i', '-E', `--grep=(close[sd]?|fix(e[sd])?|resolve[sd]?) #${n}([^0-9]|$)`);
  const ticketBranch = git('for-each-ref', '--format=%(refname:short)', `refs/heads/ticket/${n}-*`).split('\n').filter(Boolean)[0] || null;
  if (!sha) return { commit: null, branches: [], onDefault: false, ticketBranch };
  // Local and remote-tracking branches (a commit may exist only on GitHub, e.g. another clone).
  const branches = git('branch', '-a', '--contains', sha, '--format=%(refname:short)')
    .split('\n')
    .filter((b) => b && !b.endsWith('/HEAD') && b !== 'origin');
  let onDefault = false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, `origin/${defaultBranch}`], { stdio: 'ignore' });
    onDefault = true;
  } catch {}
  return { commit: sha, branches, onDefault, ticketBranch };
}

function lastLocalCommitDate(branch) {
  return git('log', '-1', '--format=%cI', branch) || git('log', '-1', '--format=%cI', `origin/${branch}`);
}

// Human feedback is "addressed" once the loop has both pushed a commit and replied (a marker
// comment) after it; anything newer than the later of those two still needs work.
async function feedbackSince(pr) {
  const [reviews, inline, convo] = await Promise.all([
    apiList(`/repos/${slug}/pulls/${pr.number}/reviews`),
    apiList(`/repos/${slug}/pulls/${pr.number}/comments`),
    apiList(`/repos/${slug}/issues/${pr.number}/comments`),
  ]);
  const all = [
    ...reviews.map((r) => ({ at: r.submitted_at, body: r.body || '', state: r.state })),
    ...inline.map((c) => ({ at: c.created_at, body: c.body || '' })),
    ...convo.map((c) => ({ at: c.created_at, body: c.body || '' })),
  ];
  const human = all.filter((i) => !i.body.includes(MARKER) && (i.body.trim() || i.state === 'CHANGES_REQUESTED'));
  const lastReply = all.filter((i) => i.body.includes(MARKER)).map((i) => i.at).sort().pop();
  const lastCommit = lastLocalCommitDate(pr.head.ref);
  const handledUpTo = lastReply && lastCommit ? Math.min(Date.parse(lastReply), Date.parse(lastCommit)) : 0;
  const fresh = human.filter((i) => Date.parse(i.at) > handledUpTo);
  return { total: human.length, fresh: fresh.length };
}

function existing(p) {
  return fs.existsSync(p) ? p : null;
}

function draftFor(branches) {
  for (const b of branches) {
    const p = existing(prDraftPath(b.replace(/^origin\//, '')));
    if (p) return p;
  }
  return null;
}

// A ticket comment drafted but not yet posted (github.mjs renames it to .posted.md on success).
function unpostedComment(n) {
  return existing(path.join(stateDir(), `comment-${n}.md`));
}

const { allowedAuthors } = factoryConfig();

async function classify(issue, prs) {
  const n = issue.number;
  const local = localWork(n);
  // Public repo: anyone can open an issue, and its text drives the agent. Untrusted tickets are
  // never built (closed ones are still reported as done).
  if (issue.state === 'open' && !allowedAuthors.includes(String(issue.user?.login).toLowerCase())) {
    return { local, pr: null, action: `skipped (untrusted author ${issue.user?.login}; not in .claude/factory.json)` };
  }
  const pr = prs
    .filter((p) => p.head.ref.startsWith(`ticket/${n}-`) || closesRe(n).test(p.body || ''))
    .sort((a, b) => b.number - a.number)[0];
  const base = { local, pr: pr ? { number: pr.number, state: pr.state, merged: !!pr.merged_at, url: pr.html_url, head: pr.head.ref, base: pr.base.ref } : null };

  if (issue.state === 'closed') return { ...base, action: 'done' };
  if (pr?.merged_at) return { ...base, action: `done (PR #${pr.number} merged; issue closes shortly)` };
  if (pr && pr.state === 'open') {
    const fb = await feedbackSince(pr);
    if (fb.fresh) return { ...base, action: `address feedback (PR #${pr.number}: ${fb.fresh} new comment(s))` };
    const pending = unpostedComment(n);
    if (pending) return { ...base, action: `post ticket comment (PR #${pr.number} is open; draft ${path.basename(pending)})` };
    return { ...base, action: `awaiting review (PR #${pr.number})` };
  }
  if (pr && pr.state === 'closed') return { ...base, action: `PR #${pr.number} closed without merging: ask the user` };
  if (local.onDefault) return { ...base, action: `done (on ${defaultBranch}; issue not closed yet)` };
  if (local.commit) {
    const where = local.branches.join(', ') || 'unknown branch';
    const draft = draftFor(local.branches);
    return { ...base, action: `open PR (committed on ${where}${draft ? `; PR draft ${path.basename(draft)}` : ''})`, draft };
  }
  if (local.ticketBranch) return { ...base, action: `in progress (branch ${local.ticketBranch})` };
  return { ...base, action: 'todo' };
}

const issues = (await apiList(`/repos/${slug}/issues?state=${state}&sort=created&direction=asc`)).filter((i) => !i.pull_request);
const prs = await apiList(`/repos/${slug}/pulls?state=all`);
const tickets = [];
for (const i of issues) {
  const c = await classify(i, prs);
  tickets.push({
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.user?.login,
    labels: i.labels.map((l) => l.name),
    url: i.html_url,
    body: (i.body || '').trim(),
    action: c.action,
    localCommit: c.local.commit,
    branches: c.local.branches,
    ticketBranch: c.local.ticketBranch,
    pr: c.pr,
    draft: c.draft ?? null,
  });
}
saveCache();

if (asJson) {
  console.log(JSON.stringify({ repo: slug, defaultBranch, state, tickets }, null, 2));
} else {
  console.log(`${slug} (default branch ${defaultBranch}): ${tickets.length} ticket(s), state=${state}\n`);
  for (const t of tickets) {
    const labels = t.labels.length ? ` [${t.labels.join(', ')}]` : '';
    console.log(`#${t.number} [${t.state}]${labels} ${t.title}`);
    console.log(`   -> ${t.action}${t.localCommit ? ` commit ${t.localCommit}` : ''}`);
    if (t.body) console.log('   ' + t.body.replace(/\r?\n/g, '\n   '));
    console.log('');
  }
}
