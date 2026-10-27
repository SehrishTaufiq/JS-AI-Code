import test from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, redact } from '../hooks/secrets.mjs';
import { fakeGithubToken } from './helpers.mjs';

// Built at runtime so the repo never contains strings that look like real secrets.
const samples = {
  github: fakeGithubToken(),
  githubPat: 'github_pat_' + '11ABCDEFG0'.repeat(3),
  anthropic: 'sk-ant-' + 'api03-' + 'x'.repeat(30),
  openai: 'sk-proj-' + 'y'.repeat(30),
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  slack: 'xoxb-' + '1234567890-abcdefghij',
  jwt: 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0In0x' + '.' + 'c2lnbmF0dXJlLXZhbHVl',
  key: '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  url: 'https://' + 'user:hunter2secret' + '@example.com/repo.git',
};

for (const [name, secret] of Object.entries(samples)) {
  test(`finds and redacts ${name}`, () => {
    const text = `here is my ${name}: ${secret} thanks`;
    assert.ok(findSecrets(text).length > 0, `${name} not found`);
    const out = redact(text);
    assert.ok(out.includes('[REDACTED]'));
    assert.ok(!out.includes(secret.slice(8, 20)), `${name} leaked: ${out}`);
    assert.ok(out.startsWith('here is my'), 'surrounding text kept');
  });
}

test('redacts generic password/api key assignments, keeping the key name', () => {
  assert.equal(redact('password=hunter2hunter2'), 'password=[REDACTED]');
  assert.equal(redact('API_KEY: "abcdef123456"'), 'API_KEY: "[REDACTED]"');
});

test('leaves ordinary text and code alone', () => {
  const text = 'please fetch the issues; const tok = token(); see GITHUB_TOKEN (or GH_TOKEN) docs, sk-short';
  assert.deepEqual(findSecrets(text), []);
  assert.equal(redact(text), text);
});
