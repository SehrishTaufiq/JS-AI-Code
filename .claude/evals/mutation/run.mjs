// Mutation testing: are the tests good enough to catch real bugs?
//
//   node .claude/evals/mutation/run.mjs              # all mutants
//   node .claude/evals/mutation/run.mjs --only=T04,G10
//
// Copies the code under test into a temp folder (the repo itself is never modified), checks the
// suites pass there unchanged, then plants each mutant from mutants.mjs one at a time and runs
// its suites. Killed = a test failed (good). Survived = every test still passed (a test gap).
// Results: .git/factory-loop/evals/mutation.json. An --only run updates just those mutants there
// and keeps the earlier results of the rest (the eval-after-tests hook relies on this).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PW = ['node_modules/@playwright/test/cli.js', 'test', '--reporter=dot', '--max-failures=1'];
const SUITES = {
  unit: { cwd: 'todo', args: ['--test'] },
  e2e: { cwd: 'todo', args: [...PW, '--project=desktop-utc'] },
  'e2e-dates': { cwd: 'todo', args: [...PW, '--project=desktop-utc', '--project=tz-auckland', '--project=tz-sao-paulo', '--grep', '@dates'] },
  guard: { cwd: '.', args: ['--test', '.claude/tests/guard.test.mjs'] },
  secrets: { cwd: '.', args: ['--test', '.claude/tests/secrets.test.mjs', '.claude/tests/log-prompts.test.mjs', '.claude/tests/auto-commit.test.mjs'] },
  autocommit: { cwd: '.', args: ['--test', '.claude/tests/auto-commit.test.mjs'] },
  logprompts: { cwd: '.', args: ['--test', '.claude/tests/log-prompts.test.mjs'] },
  fetch: { cwd: '.', args: ['--test', '.claude/tests/fetch-tickets.test.mjs'] },
  github: { cwd: '.', args: ['--test', '.claude/tests/github.test.mjs'] },
};
const COPY = ['todo', '.claude/hooks', '.claude/tests', '.claude/skills/factory-loop/scripts', '.claude/factory.json'];
const SKIP = new Set(['node_modules', 'test-results', 'playwright-report', 'screenshots']);

const onlyAt = process.argv.indexOf('--only');
const only = ((process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || (onlyAt > -1 ? process.argv[onlyAt + 1] || '' : '')).split(',').filter(Boolean);
const mutants = only.length ? MUTANTS.filter((m) => only.includes(m.id)) : MUTANTS;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-mutation-'));
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
for (const p of COPY) fs.cpSync(path.join(ROOT, p), path.join(work, p), { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
fs.symlinkSync(path.join(ROOT, 'todo', 'node_modules'), path.join(work, 'todo', 'node_modules'), 'junction');

const env = { ...process.env, CI: '', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_PERSONAL_ACCESS_TOKEN: '', FACTORY_NO_GH: '1', GIT_TERMINAL_PROMPT: '0' };
function runSuite(name) {
  const s = SUITES[name];
  const t = Date.now();
  const res = spawnSync(process.execPath, s.args, { cwd: path.join(work, s.cwd), env, encoding: 'utf8', timeout: 240_000 });
  const out = `${res.stdout}\n${res.stderr}`;
  const failed = (out.match(/^not ok \d+ - (.+)$/gm) || []).map((l) => l.replace(/^not ok \d+ - /, ''))
    .concat((out.match(/^\s+\d+\) \[[^\]]+\] › .+$/gm) || []).map((l) => l.trim().replace(/^\d+\) /, '')));
  return { suite: name, passed: res.status === 0, timedOut: res.error?.code === 'ETIMEDOUT', failed: [...new Set(failed)].slice(0, 5), ms: Date.now() - t };
}

// The unchanged code must pass, or a "kill" would mean nothing.
const needed = [...new Set(mutants.flatMap((m) => m.suites))];
for (const name of needed) {
  const r = runSuite(name);
  console.log(`baseline ${name}: ${r.passed ? 'pass' : 'FAIL'} (${(r.ms / 1000).toFixed(1)}s)`);
  if (!r.passed) {
    console.error(`Suite ${name} fails without any mutant; fix it first. ${r.failed.join('; ')}`);
    process.exit(1);
  }
}

const results = [];
for (const m of mutants) {
  const file = path.join(work, m.file);
  const original = fs.readFileSync(file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.replace(/\n/g, eol);
  const count = original.split(from).length - 1;
  if (count !== 1) {
    results.push({ ...m, status: 'invalid', note: `pattern found ${count} times` });
    console.log(`${m.id} INVALID (pattern found ${count} times)`);
    continue;
  }
  fs.writeFileSync(file, original.replace(from, () => m.to.replace(/\n/g, eol)));
  const runs = [];
  for (const name of m.suites) {
    const r = runSuite(name);
    runs.push(r);
    if (!r.passed) break; // one failing suite is enough to kill it
  }
  fs.writeFileSync(file, original);
  const killedBy = runs.find((r) => !r.passed);
  const status = killedBy ? 'killed' : 'survived';
  results.push({ ...m, status, killedBy: killedBy ? { suite: killedBy.suite, tests: killedBy.failed, timedOut: killedBy.timedOut } : null });
  console.log(`${m.id} ${status.toUpperCase().padEnd(8)} ${m.bug}${killedBy ? `  <- ${killedBy.failed[0] || killedBy.suite}` : ''}`);
}

function summarize(list) {
  const killed = list.filter((r) => r.status === 'killed').length;
  const valid = list.filter((r) => r.status !== 'invalid').length;
  return { date: new Date().toISOString(), killed, survived: valid - killed, invalid: list.length - valid, score: valid ? Math.round((killed / valid) * 100) : 0, results: list };
}
const outDir = path.join(ROOT, '.git', 'factory-loop', 'evals');
const outFile = path.join(outDir, 'mutation.json');
// An --only run keeps the earlier results of the mutants it did not run (if they still exist).
let all = results;
if (only.length && fs.existsSync(outFile)) {
  const ran = new Set(results.map((r) => r.id));
  const previous = new Map((JSON.parse(fs.readFileSync(outFile, 'utf8')).results || []).map((r) => [r.id, r]));
  all = MUTANTS.map((m) => (ran.has(m.id) ? results.find((r) => r.id === m.id) : previous.get(m.id))).filter(Boolean);
}
const summary = summarize(results);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(summarize(all), null, 2));
console.log(`\nMutation score: ${summary.score}% (${summary.killed}/${summary.killed + summary.survived} killed, ${summary.survived} survived, ${summary.invalid} invalid)`);
if (all !== results) console.log(`All recorded results (${all.length} of ${MUTANTS.length} mutants): ${summarize(all).score}%`);
for (const r of results.filter((x) => x.status === 'survived')) console.log(`  SURVIVED ${r.id} ${r.file}: ${r.bug}`);
