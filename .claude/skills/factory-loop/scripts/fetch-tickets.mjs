#!/usr/bin/env node
// Lists the GitHub issues ("tickets") of the repo in the current directory and, for each,
// whether a local commit already says "Closes #N" and whether that commit is pushed.
// Needs only Node 18+ and git; no gh CLI.
//
// Usage: node fetch-tickets.mjs [--state all|open|closed] [--json]
// Set GITHUB_TOKEN or GH_TOKEN for private repos or higher rate limits.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const state = valueOf('--state') ?? 'all';
const asJson = args.includes('--json');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function git(...gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function repoSlug() {
  const url = git('remote', 'get-url', 'origin');
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) {
    console.error(`origin is not a GitHub remote: ${url || '(no origin)'}`);
    process.exit(2);
  }
  return `${m[1]}/${m[2]}`;
}

async function fetchIssues(slug) {
  const headers = { 'User-Agent': 'factory-loop', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const issues = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${slug}/issues?state=${state}&per_page=100&page=${page}&sort=created&direction=asc`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`GitHub API ${res.status} for ${slug}: ${(await res.text()).slice(0, 300)}`);
      if (res.status === 404 && !token) console.error('Private repo? Set GITHUB_TOKEN or GH_TOKEN.');
      process.exit(1);
    }
    const batch = await res.json();
    issues.push(...batch.filter((i) => !i.pull_request)); // the issues API also returns PRs
    if (batch.length < 100) return issues;
  }
}

// Newest local commit whose message closes #number, and whether a remote branch contains it.
function localStatus(number) {
  const pattern = `(close[sd]?|fix(e[sd])?|resolve[sd]?) #${number}([^0-9]|$)`;
  const sha = git('log', '-1', '--format=%h', '-i', '-E', `--grep=${pattern}`, 'HEAD');
  if (!sha) return { commit: null, pushed: false };
  const remotes = git('branch', '-r', '--contains', sha);
  return { commit: sha, pushed: remotes.length > 0 };
}

function action(issue, local) {
  if (issue.state === 'closed') return 'done';
  if (local.commit && local.pushed) return 'done (pushed, issue not closed yet)';
  if (local.commit) return 'push only (committed locally, not pushed)';
  return 'todo';
}

const slug = repoSlug();
const issues = await fetchIssues(slug);
const tickets = issues.map((i) => {
  const local = localStatus(i.number);
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.user?.login,
    labels: i.labels.map((l) => l.name),
    createdAt: i.created_at,
    url: i.html_url,
    body: (i.body || '').trim(),
    localCommit: local.commit,
    pushed: local.pushed,
    action: action(i, local),
  };
});

if (asJson) {
  console.log(JSON.stringify({ repo: slug, state, tickets }, null, 2));
} else {
  console.log(`${slug}: ${tickets.length} ticket(s), state=${state} (remote status as of last git fetch)\n`);
  for (const t of tickets) {
    const labels = t.labels.length ? ` [${t.labels.join(', ')}]` : '';
    const commit = t.localCommit ? ` commit ${t.localCommit}` : '';
    console.log(`#${t.number} [${t.state}]${labels} ${t.title}`);
    console.log(`   -> ${t.action}${commit}`);
    if (t.body) console.log('   ' + t.body.replace(/\r?\n/g, '\n   '));
    console.log('');
  }
}
