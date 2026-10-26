import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOOKS, fakeGithubToken, makeRepo, runNode, systemMessage } from './helpers.mjs';

const HOOK = path.join(HOOKS, 'auto-commit.mjs');
const run = (r) => {
  const res = runNode(HOOK, { cwd: r.work });
  assert.equal(res.code, 0, 'hook must never fail the stop');
  return systemMessage(res.stdout);
};
const write = (r, file, text) => {
  fs.mkdirSync(path.dirname(path.join(r.work, file)), { recursive: true });
  fs.writeFileSync(path.join(r.work, file), text);
};
const writeLog = (r, lines) => write(r, '.claude/logs/prompts.jsonl', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

test('on main: commits and pushes nothing, warns about leftovers', () => {
  const r = makeRepo();
  write(r, 'feature.js', 'x');
  const msg = run(r);
  assert.match(msg, /1 change\(s\) left uncommitted on main/);
  assert.equal(r.g('rev-list', '--count', 'HEAD'), '1');
  assert.equal(r.rg('rev-list', '--count', 'main'), '1');
});

test('on a ticket branch: commits everything and pushes the branch', () => {
  const r = makeRepo();
  r.g('switch', '-q', '-c', 'ticket/6-x');
  write(r, 'feature.js', 'x');
  const msg = run(r);
  assert.match(msg, /committed 1 file\(s\)/);
  assert.match(msg, /pushed ticket\/6-x \(1 commit\(s\) ahead\)/);
  assert.equal(r.rg('rev-parse', 'ticket/6-x'), r.g('rev-parse', 'HEAD'));
  assert.match(r.g('log', '-1', '--format=%B'), /Co-Authored-By: Claude/);
});

test('a new branch with no new commits is not pushed', () => {
  const r = makeRepo();
  r.g('switch', '-q', '-c', 'ticket/7-empty');
  assert.equal(run(r), '');
  assert.ok(!r.rg('branch', '--list', 'ticket/7-empty'));
});

test('leaves out secret files by name and by content', () => {
  const r = makeRepo();
  r.g('switch', '-q', '-c', 'ticket/8-x');
  write(r, '.env', 'X=1');
  write(r, 'config.js', `export const t = '${fakeGithubToken()}';`);
  write(r, 'ok.js', 'export const ok = 1;');
  const msg = run(r);
  assert.match(msg, /left out 2 secret-looking file\(s\): .*\.env.*config\.js|left out 2 secret-looking file\(s\): .*config\.js.*\.env/);
  const committed = r.g('show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.deepEqual(committed, ['ok.js']);
});

test('push failure is reported but never fails the hook', () => {
  const r = makeRepo();
  r.g('remote', 'set-url', 'origin', path.join(r.base, 'missing.git'));
  r.g('switch', '-q', '-c', 'ticket/9-x');
  write(r, 'f.js', 'x');
  assert.match(run(r), /push of ticket\/9-x FAILED/);
});

test('skips committing during a merge in progress and on a detached HEAD', () => {
  const r = makeRepo();
  r.g('switch', '-q', '-c', 'ticket/10-x');
  fs.writeFileSync(path.join(r.work, '.git', 'MERGE_HEAD'), r.g('rev-parse', 'HEAD'));
  write(r, 'f.js', 'x');
  assert.match(run(r), /skipped commit, a MERGE_HEAD is in progress/);
  fs.unlinkSync(path.join(r.work, '.git', 'MERGE_HEAD'));
  r.g('checkout', '-q', '--detach');
  assert.match(run(r), /HEAD is detached/);
  assert.equal(r.g('rev-list', '--count', 'HEAD'), '1');
});

test('publishes the prompt log to its own branch, incrementally, without touching the work tree', () => {
  const r = makeRepo();
  r.g('switch', '-q', '-c', 'ticket/11-x');
  writeLog(r, [{ prompt: 'one' }]);
  assert.match(run(r), /prompt log pushed/);
  assert.equal(r.rg('show', 'prompt-log:.claude/logs/prompts.jsonl'), '{"prompt":"one"}');
  assert.equal(r.g('status', '--porcelain'), '', 'log is gitignored, tree stays clean');
  assert.equal(r.g('rev-list', '--count', 'HEAD'), '1', 'nothing committed on the ticket branch');

  assert.equal(run(r), '', 'unchanged log: nothing to do');
  writeLog(r, [{ prompt: 'one' }, { prompt: 'two' }]);
  run(r);
  assert.equal(r.rg('rev-list', '--count', 'prompt-log'), '2');
  assert.equal(r.rg('show', 'prompt-log:.claude/logs/prompts.jsonl'), '{"prompt":"one"}\n{"prompt":"two"}');
});

test('prompt log is published even from main, while main itself stays untouched', () => {
  const r = makeRepo();
  writeLog(r, [{ prompt: 'x' }]);
  assert.match(run(r), /prompt log pushed/);
  assert.equal(r.rg('rev-list', '--count', 'main'), '1');
});
