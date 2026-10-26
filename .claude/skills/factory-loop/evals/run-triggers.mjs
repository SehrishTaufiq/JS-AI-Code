// Trigger evals for the factory-loop skill (trigger-evals.json): does the skill start when it
// should, and stay out when it shouldn't?
//
//   node .claude/skills/factory-loop/evals/run-triggers.mjs [--model claude-opus-5-5] [--parallel 3]
//
// Each query runs headless in a sandbox with every tool that changes anything disabled. The run
// is stopped as soon as the answer is known: the factory-loop skill was invoked (or its SKILL.md
// read) = triggered; a final reply or a few other tool calls first = not triggered.
// Results: .git/factory-loop/evals/triggers.json (+ one stream log per query).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnv, makeSandbox, OUT, runClaude } from './sandbox.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const model = opt('--model', 'claude-opus-5-5');
const parallel = Number(opt('--parallel', 3));
const QUERIES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'trigger-evals.json'), 'utf8'));

const dir = path.join(OUT, 'triggers', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const sb = makeSandbox();
const env = cleanEnv({ FACTORY_API_BASE: 'http://127.0.0.1:9' }); // nothing listens: no API reachable
const isLoopSkill = (b) => (b.name === 'Skill' && /factory-loop/.test(String(b.input?.skill))) || (b.name === 'Read' && /factory-loop[\\/]SKILL\.md$/i.test(String(b.input?.file_path)));

async function judge(q, i) {
  let triggered = false;
  let firstTool = null;
  let others = 0;
  const res = await runClaude({
    cwd: sb.work,
    prompt: q.query,
    env,
    logFile: path.join(dir, `q${String(i + 1).padStart(2, '0')}.jsonl`),
    timeoutMs: 5 * 60_000,
    flags: ['--model', model, '--max-turns', '4', '--max-budget-usd', '1',
      '--disallowedTools', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'WebFetch', 'WebSearch', 'CronCreate', 'ScheduleWakeup', 'RemoteTrigger', 'AskUserQuestion'],
    onEvent: (e, stop) => {
      if (e.type !== 'assistant') return;
      for (const b of e.message?.content || []) {
        if (b.type !== 'tool_use') continue;
        firstTool ??= `${b.name}${b.input?.skill ? `(${b.input.skill})` : b.input?.file_path ? `(${path.basename(String(b.input.file_path))})` : ''}`;
        if (isLoopSkill(b)) {
          triggered = true;
          return stop('triggered');
        }
        if (++others >= 4) return stop('no trigger after 4 tool calls');
      }
    },
  });
  const ok = triggered === q.should_trigger;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${q.should_trigger ? 'should   ' : 'shouldn\'t'} trigger, ${triggered ? 'did' : 'did not'}: ${q.query}${firstTool ? `  [first tool: ${firstTool}]` : ''}`);
  return { ...q, triggered, pass: ok, firstTool, stopped: res.stopped };
}

const results = new Array(QUERIES.length);
let next = 0;
await Promise.all(Array.from({ length: parallel }, async () => {
  while (next < QUERIES.length) {
    const i = next++;
    results[i] = await judge(QUERIES[i], i);
  }
}));
try {
  fs.rmSync(sb.base, { recursive: true, force: true });
} catch {
  /* best effort on Windows */
}

const pos = results.filter((r) => r.should_trigger);
const neg = results.filter((r) => !r.should_trigger);
const summary = {
  date: new Date().toISOString(),
  model,
  accuracy: Math.round((results.filter((r) => r.pass).length / results.length) * 100),
  recall: `${pos.filter((r) => r.triggered).length}/${pos.length}`, // should trigger and did
  falseTriggers: `${neg.filter((r) => r.triggered).length}/${neg.length}`, // shouldn't and did
  results,
};
fs.writeFileSync(path.join(OUT, 'triggers.json'), JSON.stringify(summary, null, 2));
console.log(`\nTrigger accuracy ${summary.accuracy}%: triggered on ${summary.recall} it should, falsely on ${summary.falseTriggers}`);
