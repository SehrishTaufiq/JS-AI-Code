import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, runScript, tmpDir } from './helpers.mjs';
import { pull, startFakeGitHub } from './fake-github.mjs';

const MARKER = '<!-- factory-loop -->';

async function setup(state = {}) {
  const r = makeRepo({ githubSlug: 'o/r' });
  const gh = await startFakeGitHub({ issues: [], pulls: [], reviews: {}, inline: {}, comments: {}, ...state });
  const drafts = tmpDir();
  const draft = (name, text) => {
    const f = path.join(drafts, name);
    fs.writeFileSync(f, text);
    return f;
  };
  const run = (args, { token = 'test-token' } = {}) =>
    runScript('github.mjs', args, { cwd: r.work, env: { FACTORY_API_BASE: gh.base, GITHUB_TOKEN: token } });
  return { r, gh, draft, run };
}

test('pr-create opens a PR with the marker appended once', async () => {
  const { gh, draft, run } = await setup();
  try {
    const res = await run(['pr-create', '--head', 'ticket/6-x', '--title', 'Edit tasks', '--body-file', draft('pr.md', 'Body\n\nCloses #6')]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /^opened PR #\d+/);
    const post = gh.log.find((x) => x.method === 'POST');
    assert.equal(post.auth, 'Bearer test-token');
    assert.equal(post.body.head, 'ticket/6-x');
    assert.equal(post.body.base, 'main');
    assert.equal(post.body.body.split(MARKER).length - 1, 1);
  } finally {
    await gh.close();
  }
});

test('pr-create on a branch with an open PR updates it instead of opening another', async () => {
  const { gh, draft, run } = await setup({ pulls: [pull(60, 'ticket/6-x')] });
  try {
    const res = await run(['pr-create', '--head', 'ticket/6-x', '--base', 'review/tickets-1-5', '--title', 'T2', '--body-file', draft('pr.md', `B2 ${MARKER}`)]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /^updated PR #60/);
    assert.ok(!gh.log.some((x) => x.method === 'POST'));
    assert.equal(gh.state.pulls[0].base.ref, 'review/tickets-1-5');
    assert.equal(gh.state.pulls[0].body.split(MARKER).length - 1, 1, 'existing marker not duplicated');
  } finally {
    await gh.close();
  }
});

test('--dry-run prints the request and sends no write', async () => {
  const { gh, draft, run } = await setup();
  try {
    const res = await run(['pr-create', '--head', 'ticket/6-x', '--title', 'T', '--body-file', draft('pr.md', 'B'), '--dry-run'], { token: '' });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /^\[dry-run\] POST .*\/repos\/o\/r\/pulls/);
    assert.ok(gh.log.every((x) => x.method === 'GET'));
  } finally {
    await gh.close();
  }
});

test('writes without a token exit 3 with a clear message', async () => {
  const { gh, draft, run } = await setup();
  try {
    const res = await run(['comment', '--issue', '6', '--body-file', draft('comment-6.md', 'hi')], { token: '' });
    assert.equal(res.code, 3);
    assert.match(res.stderr, /No GitHub token/);
  } finally {
    await gh.close();
  }
});

test('comment posts with the marker and marks the draft as posted', async () => {
  const { gh, draft, run } = await setup();
  try {
    const file = draft('comment-6.md', 'Ready for review in #60');
    const res = await run(['comment', '--issue', '6', '--body-file', file]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(gh.state.comments[6][0].body.endsWith(MARKER));
    assert.ok(!fs.existsSync(file));
    assert.ok(fs.existsSync(file.replace(/\.md$/, '.posted.md')));
  } finally {
    await gh.close();
  }
});

test('pr-feedback lists human feedback oldest first, without the loop\'s own posts', async () => {
  const { gh, run } = await setup({
    reviews: { 60: [{ submitted_at: '2026-10-26T10:00:00Z', user: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: 'needs work' }] },
    inline: { 60: [{ created_at: '2026-10-26T09:00:00Z', user: { login: 'rev' }, path: 'app.js', line: 4, body: 'typo' }] },
    comments: { 60: [{ created_at: '2026-10-26T11:00:00Z', user: { login: 'me' }, body: `Fixed ${MARKER}` }] },
  });
  try {
    const res = await run(['pr-feedback', '--pr', '60']);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /inline app\.js:4\)\ntypo[\s\S]*review CHANGES_REQUESTED\)\nneeds work/);
    assert.ok(!res.stdout.includes('Fixed'));
  } finally {
    await gh.close();
  }
});

test('image-md: sorted, captioned, pinned to a commit, images only', async () => {
  const { r, gh, run } = await setup();
  try {
    const dir = path.join(r.work, 'todo', 'docs', 'screenshots', 'ticket-6');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['02-after-edit.png', '01-edit-form.png', 'notes.txt']) fs.writeFileSync(path.join(dir, f), 'x');
    const res = await run(['image-md', '--dir', dir, '--ref', 'abc123']);
    assert.equal(res.stdout, [
      '![edit form](https://github.com/o/r/blob/abc123/todo/docs/screenshots/ticket-6/01-edit-form.png?raw=true)',
      '![after edit](https://github.com/o/r/blob/abc123/todo/docs/screenshots/ticket-6/02-after-edit.png?raw=true)',
    ].join('\n'));
    const missing = await run(['image-md', '--dir', path.join(r.work, 'nope')]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /no screenshot folder/);
  } finally {
    await gh.close();
  }
});

test('has no merge or close command', async () => {
  const { gh, run } = await setup();
  try {
    for (const cmd of ['merge', 'pr-merge', 'close', 'issue-close']) assert.equal((await run([cmd])).code, 2);
  } finally {
    await gh.close();
  }
});
