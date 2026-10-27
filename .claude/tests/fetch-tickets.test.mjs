import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, runScript } from './helpers.mjs';
import { issue, pull, startFakeGitHub } from './fake-github.mjs';

const MARKER = '<!-- factory-loop -->';

// One repo + fake API covering every state the loop distinguishes.
async function scenario() {
  const r = makeRepo({ githubSlug: 'o/r' });
  fs.mkdirSync(path.join(r.work, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(r.work, '.claude', 'factory.json'), JSON.stringify({ allowedAuthors: ['mashhoodr', 'Sehrish-Lodhi_Jonas'] }));
  r.g('add', '-A');
  r.g('commit', '-q', '-m', 'factory config'); // on main, so it exists on every branch below
  const commitOn = (branch, msg, from = 'main') => {
    r.g('switch', '-q', '-c', branch, from);
    fs.writeFileSync(path.join(r.work, `${branch.replace(/\W/g, '_')}.txt`), msg);
    r.g('add', '-A');
    r.g('commit', '-q', '-m', msg);
    r.g('switch', '-q', 'main');
  };
  r.g('branch', 'ticket/4-wip');
  commitOn('ticket/5-built', 'Build five\n\nCloses #5');
  commitOn('ticket/6-pr', 'Build six\n\nCloses #6');
  commitOn('ticket/7-feedback', 'Build seven\n\nCloses #7');
  commitOn('ticket/12-twelve', 'Build twelve\n\nCloses #12');
  commitOn('ticket/13-handled', 'Build thirteen\n\nCloses #13');

  const stateDir = path.join(r.work, '.git', 'factory-loop');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'pr-ticket-5-built.md'), 'draft');
  fs.writeFileSync(path.join(stateDir, 'comment-6.md'), 'draft comment');

  const gh = await startFakeGitHub({
    issues: [
      issue(1),
      issue(2, { user: { login: 'random-stranger' } }),
      issue(3, { state: 'closed' }),
      issue(4),
      issue(5),
      issue(6),
      issue(7),
      issue(8),
      issue(9),
      issue(12),
      issue(13, { user: { login: 'sehrish-lodhi_jonas' } }), // case-insensitive match
      { ...issue(99), pull_request: {} }, // the issues API also returns PRs
    ],
    pulls: [
      pull(60, 'ticket/6-pr'),
      pull(70, 'ticket/7-feedback'),
      pull(80, 'ticket/8-merged', { state: 'closed', merged_at: '2026-10-26T00:00:00Z' }),
      pull(90, 'ticket/9-rejected', { state: 'closed' }),
      pull(130, 'ticket/13-handled'),
    ],
    reviews: {},
    inline: { 70: [{ created_at: '2099-01-01T00:00:00Z', body: 'rename this', path: 'app.js', line: 3 }] },
    comments: {
      60: [{ created_at: '2099-01-01T00:00:00Z', body: `Opened by the loop ${MARKER}` }],
      130: [
        { created_at: '2000-01-01T00:00:00Z', body: 'please fix the label' },
        { created_at: '2099-01-02T00:00:00Z', body: `Fixed in abc ${MARKER}` },
      ],
    },
  });
  const fetchTickets = () => runScript('fetch-tickets.mjs', ['--json', '--no-fetch'], { cwd: r.work, env: { FACTORY_API_BASE: gh.base } });
  return { r, gh, fetchTickets };
}

test('classifies every ticket state', async () => {
  const { gh, fetchTickets } = await scenario();
  try {
    const res = await fetchTickets();
    assert.equal(res.code, 0, res.stderr);
    const actions = Object.fromEntries(JSON.parse(res.stdout).tickets.map((t) => [t.number, t.action]));
    assert.equal(actions[1], 'todo', '#1 must not be matched by the "Closes #12" commit');
    assert.match(actions[2], /^skipped \(untrusted author random-stranger/);
    assert.equal(actions[3], 'done');
    assert.equal(actions[4], 'in progress (branch ticket/4-wip)');
    assert.equal(actions[5], 'open PR (committed on ticket/5-built; PR draft pr-ticket-5-built.md)');
    assert.match(actions[6], /^post ticket comment \(PR #60 is open; draft comment-6\.md\)$/);
    assert.equal(actions[7], 'address feedback (PR #70: 1 new comment(s))');
    assert.match(actions[8], /^done \(PR #80 merged/);
    assert.match(actions[9], /^PR #90 closed without merging/);
    assert.equal(actions[12], 'open PR (committed on ticket/12-twelve)');
    assert.equal(actions[13], 'awaiting review (PR #130)', 'feedback older than the loop\'s push + reply is handled');
    assert.equal(actions[99], undefined, 'pull requests are not tickets');
  } finally {
    await gh.close();
  }
});

test('second run is served from the ETag cache (304s)', async () => {
  const { gh, fetchTickets } = await scenario();
  try {
    await fetchTickets();
    const first = gh.log.length;
    await fetchTickets();
    const second = gh.log.slice(first);
    assert.ok(second.length > 0);
    assert.ok(second.every((x) => x.status === 304), JSON.stringify(second.map((x) => [x.path, x.status])));
  } finally {
    await gh.close();
  }
});

test('missing factory.json trusts nobody', async () => {
  const { r, gh, fetchTickets } = await scenario();
  try {
    fs.unlinkSync(path.join(r.work, '.claude', 'factory.json'));
    const tickets = JSON.parse((await fetchTickets()).stdout).tickets.filter((t) => t.state === 'open');
    assert.ok(tickets.every((t) => t.action.startsWith('skipped (untrusted author')));
  } finally {
    await gh.close();
  }
});
