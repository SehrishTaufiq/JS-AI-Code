// Requirements matrix: is every ticket requirement and security rule covered by a test, and do
// those tests catch real bugs?
//
//   node .claude/evals/requirements.mjs          # after mutation/run.mjs, for the "verified" column
//
// Status per requirement:
//   VERIFIED  tests exist, and every planted bug (mutant) that breaks it was caught
//   COVERED   tests exist; no mutant targets it yet
//   WEAK      tests exist, but a mutant that breaks it survived: the tests miss that bug
//   GAP       no test found (a mapped test was renamed or deleted, or none was ever written)
// Exits 1 on any GAP or WEAK, so it can run in CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutation/mutants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { requirements } = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'evals', 'requirements.json'), 'utf8'));
const mutationFile = path.join(ROOT, '.git', 'factory-loop', 'evals', 'mutation.json');
const mutation = fs.existsSync(mutationFile) ? JSON.parse(fs.readFileSync(mutationFile, 'utf8')) : null;
const outcome = new Map((mutation?.results || []).map((r) => [r.id, r.status]));
const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) cache.set(f, fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : null);
  return cache.get(f);
};

const rows = requirements.map((req) => {
  const found = req.tests.filter((t) => read(t.file)?.includes(t.match));
  const missing = req.tests.filter((t) => !found.includes(t));
  const mutants = MUTANTS.filter((m) => m.covers.includes(req.id)).map((m) => ({ id: m.id, bug: m.bug, status: outcome.get(m.id) || 'not run' }));
  const survived = mutants.filter((m) => m.status === 'survived');
  const killed = mutants.filter((m) => m.status === 'killed');
  const status = !found.length ? 'GAP' : survived.length ? 'WEAK' : killed.length ? 'VERIFIED' : 'COVERED';
  return { ...req, status, found: found.length, missing, mutants, survived: survived.map((m) => `${m.id} ${m.bug}`) };
});

const count = (s) => rows.filter((r) => r.status === s).length;
console.log('| Req | Ticket | Requirement | Tests | Planted bugs caught | Status |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  const caught = r.mutants.length ? `${r.mutants.filter((m) => m.status === 'killed').length}/${r.mutants.length}` : '-';
  console.log(`| ${r.id} | ${r.ticket} | ${r.requirement} | ${r.found}/${r.tests.length} | ${caught} | ${r.status} |`);
}
console.log(`\n${count('VERIFIED')} verified, ${count('COVERED')} covered, ${count('WEAK')} weak, ${count('GAP')} gaps (of ${rows.length})${mutation ? '' : ' (no mutation results yet: run mutation/run.mjs)'}`);
for (const r of rows.filter((x) => x.missing.length)) console.log(`  missing test in ${r.id}: ${r.missing.map((t) => `${t.file} "${t.match}"`).join('; ')}`);
for (const r of rows.filter((x) => x.survived.length)) console.log(`  ${r.id} misses: ${r.survived.join('; ')}`);

fs.mkdirSync(path.dirname(mutationFile), { recursive: true });
fs.writeFileSync(path.join(path.dirname(mutationFile), 'requirements.json'), JSON.stringify({ date: new Date().toISOString(), rows }, null, 2));
process.exitCode = count('GAP') || count('WEAK') ? 1 : 0;
