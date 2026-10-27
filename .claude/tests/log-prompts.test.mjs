import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOOKS, fakeGithubToken, runNode, tmpDir } from './helpers.mjs';

const HOOK = path.join(HOOKS, 'log-prompts.mjs');

const user = (uuid, content, extra = {}) => ({ type: 'user', uuid, timestamp: `2026-10-26T08:00:0${uuid.length % 10}Z`, sessionId: 's1', origin: { kind: 'human' }, message: { role: 'user', content }, ...extra });

function setup(entries) {
  const dir = tmpDir();
  const transcript = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(transcript, entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
  const run = () => runNode(HOOK, { cwd: dir, payload: { session_id: 's1', transcript_path: transcript } });
  const log = () => {
    const f = path.join(dir, '.claude', 'logs', 'prompts.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  return { dir, transcript, run, log };
}

test('logs human prompts (string and text blocks) and mid-turn messages, skips everything else', () => {
  const t = setup([
    user('a', 'please fetch the issues'),
    user('b', [{ type: 'text', text: 'all' }]),
    user('c', [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }], { origin: undefined }),
    user('d', 'Base directory for this skill: ...', { isMeta: true }),
    user('e', 'Run the factory-loop skill', { isMeta: true, origin: undefined, promptSource: 'system', turnOrigin: 'scheduled' }),
    user('f', '<local-command-stdout>done</local-command-stdout>'),
    user('g', 'sidechain prompt', { isSidechain: true }),
    { type: 'attachment', uuid: 'h', timestamp: '2026-10-26T08:01:00Z', attachment: { type: 'queued_command', prompt: 'typed while working', source_uuid: 'src-h', origin: { kind: 'human' } } },
    { type: 'assistant', uuid: 'i', message: { content: [{ type: 'text', text: 'hello' }] } },
    'this line is not json',
  ]);
  assert.equal(t.run().code, 0);
  const log = t.log();
  assert.deepEqual(log.map((r) => [r.prompt, r.source]), [
    ['please fetch the issues', 'prompt'],
    ['all', 'prompt'],
    ['typed while working', 'mid-turn'],
  ]);
  assert.equal(log[2].uuid, 'src-h');
  assert.equal(log[0].session_id, 's1');
});

test('only new prompts are appended on later stops', () => {
  const t = setup([user('a', 'first')]);
  t.run();
  t.run();
  assert.equal(t.log().length, 1);
  fs.appendFileSync(t.transcript, JSON.stringify(user('bb', 'second')) + '\n');
  t.run();
  assert.deepEqual(t.log().map((r) => r.prompt), ['first', 'second']);
});

test('records image count for image-only prompts', () => {
  const t = setup([user('a', [{ type: 'image', source: {} }, { type: 'image', source: {} }])]);
  t.run();
  assert.equal(t.log()[0].images, 2);
});

test('masks secrets before writing (the log is pushed to a public branch)', () => {
  const token = fakeGithubToken();
  const t = setup([user('a', `use this token ${token} for the push`)]);
  t.run();
  const prompt = t.log()[0].prompt;
  assert.ok(!prompt.includes(token));
  assert.equal(prompt, 'use this token [REDACTED] for the push');
});

test('missing or absent transcript is a silent no-op', () => {
  const dir = tmpDir();
  assert.equal(runNode(HOOK, { cwd: dir, payload: {} }).code, 0);
  assert.equal(runNode(HOOK, { cwd: dir, payload: { transcript_path: path.join(dir, 'nope.jsonl') } }).code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.claude')));
});
