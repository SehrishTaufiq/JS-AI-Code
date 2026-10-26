#!/usr/bin/env node
// GitHub writes for the factory loop: open/update a PR, comment on an issue or PR, read review
// feedback, and build screenshot markdown. Deliberately has NO merge or close command: merging
// (which closes the ticket via "Closes #N") is the human reviewer's job.
//
//   node github.mjs pr-create   --head <branch> [--base main] --title <title> --body-file <file> [--dry-run]
//   node github.mjs comment     --issue <number> --body-file <file> [--dry-run]
//   node github.mjs pr-feedback --pr <number>
//   node github.mjs image-md    --dir <screenshot dir> [--ref <commit sha>]
//
// Token: GITHUB_TOKEN / GH_TOKEN, or `gh auth token`. Bodies get a hidden marker so the loop can
// tell its own posts from review feedback.
import fs from 'node:fs';
import path from 'node:path';
import { api, apiList, arg, git, MARKER, repoSlug, saveCache } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const slug = repoSlug();

function need(flag) {
  const v = arg(args, flag);
  if (!v) {
    console.error(`missing ${flag}`);
    process.exit(2);
  }
  return v;
}

function bodyFrom(flag) {
  const text = fs.readFileSync(need(flag), 'utf8').trim();
  return text.includes(MARKER) ? text : `${text}\n\n${MARKER}`;
}

async function write(method, urlPath, body) {
  if (dryRun) {
    console.log(`[dry-run] ${method} https://api.github.com${urlPath}\n${JSON.stringify(body, null, 2)}`);
    return null;
  }
  return api(method, urlPath, body);
}

async function prCreate() {
  const head = need('--head');
  const base = arg(args, '--base') || 'main';
  const title = need('--title');
  const body = bodyFrom('--body-file');
  const owner = slug.split('/')[0];
  // Idempotent: if this branch already has an open PR, update it instead of opening another.
  const open = await api('GET', `/repos/${slug}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
  if (open.length) {
    const pr = await write('PATCH', `/repos/${slug}/pulls/${open[0].number}`, { title, body, base });
    console.log(`updated PR #${open[0].number}: ${pr?.html_url ?? open[0].html_url}`);
    return;
  }
  const pr = await write('POST', `/repos/${slug}/pulls`, { title, head, base, body });
  if (pr) console.log(`opened PR #${pr.number}: ${pr.html_url}`);
}

// Comments on an issue or a PR (PRs are issues for comments). A draft named comment-<N>.md is
// renamed to comment-<N>.posted.md once posted, so fetch-tickets knows not to retry it.
async function comment() {
  const issue = need('--issue');
  const file = need('--body-file');
  const c = await write('POST', `/repos/${slug}/issues/${issue}/comments`, { body: bodyFrom('--body-file') });
  if (!c) return;
  console.log(`commented: ${c.html_url}`);
  if (/comment-\d+\.md$/.test(file)) fs.renameSync(file, file.replace(/\.md$/, '.posted.md'));
}

// Human feedback on a PR, oldest first: reviews, inline review comments and conversation
// comments, minus the loop's own posts.
async function prFeedback() {
  const pr = need('--pr');
  const [reviews, inline, convo] = await Promise.all([
    apiList(`/repos/${slug}/pulls/${pr}/reviews`),
    apiList(`/repos/${slug}/pulls/${pr}/comments`),
    apiList(`/repos/${slug}/issues/${pr}/comments`),
  ]);
  const items = [
    ...reviews.filter((r) => r.body || r.state !== 'COMMENTED').map((r) => ({ at: r.submitted_at, who: r.user?.login, kind: `review ${r.state}`, body: r.body })),
    ...inline.map((c) => ({ at: c.created_at, who: c.user?.login, kind: `inline ${c.path}:${c.line ?? c.original_line ?? '?'}`, body: c.body })),
    ...convo.map((c) => ({ at: c.created_at, who: c.user?.login, kind: 'comment', body: c.body })),
  ].filter((i) => !(i.body || '').includes(MARKER)).sort((a, b) => a.at.localeCompare(b.at));
  if (!items.length) console.log('no human feedback yet');
  for (const i of items) console.log(`--- ${i.at} ${i.who} (${i.kind})\n${(i.body || '').trim()}\n`);
}

// Markdown image list for the PNGs in a directory, pinned to a commit so links survive the
// branch being deleted after merge. The commit must be pushed for the images to load.
function imageMd() {
  const dir = need('--dir');
  const ref = arg(args, '--ref') || git('rev-parse', 'HEAD');
  const root = git('rev-parse', '--show-toplevel');
  if (!fs.existsSync(dir)) {
    console.error(`no screenshot folder at ${dir}; take the screenshots first (references/browser-qa.md)`);
    process.exit(2);
  }
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  for (const f of files) {
    const rel = path.relative(root, path.resolve(dir, f)).split(path.sep).join('/');
    const label = f.replace(/\.[^.]+$/, '').replace(/^\d+[-_]?/, '').replace(/[-_]/g, ' ');
    console.log(`![${label}](https://github.com/${slug}/blob/${ref}/${rel}?raw=true)`);
  }
}

const commands = { 'pr-create': prCreate, comment, 'pr-feedback': prFeedback, 'image-md': imageMd };
if (!commands[cmd]) {
  console.error(`usage: github.mjs <${Object.keys(commands).join('|')}> ...`);
  process.exit(2);
}
try {
  await commands[cmd]();
  saveCache();
} catch (err) {
  console.error(err.message);
  process.exit(err.status === 401 ? 3 : 1);
}
