// Collects every failure trace from ~/.claude into <repo>/.claude/logs/failure-traces/ (gitignored)
// and groups them by cause.
//   node collect-failures.mjs <repo root>
// Sources: session transcripts (failed tool calls, API errors, Stop-hook errors) and the
// /insights per-session analyses (friction). Secrets are masked with the factory's redact().
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(process.argv[2] || '.');
// --since 2026-10-27: only failures from that date on (to check whether fixed issues come back).
const SINCE = process.argv.includes('--since') ? process.argv[process.argv.indexOf('--since') + 1] : '';
const HOME = path.join(os.homedir(), '.claude');
const OUT = path.join(ROOT, '.claude', 'logs', 'failure-traces', ...(SINCE ? [`since-${SINCE}`] : []));
const SELF = fs.readFileSync(process.argv[1]); // kept in memory: a re-run from OUT deletes the file
const { redact } = await import(pathToFileURL(path.join(ROOT, '.claude', 'hooks', 'secrets.mjs')).href);

// Ordered: the first matching rule names the cause.
// [id, label, pattern on the error text, optional pattern the tool name must match]
const BROWSER = /chrome-devtools|playwright|browser|claude-in-chrome/i;
const CAUSES = [
  ['user-rejected', 'Rejected or interrupted by the user', /doesn't want to (proceed|take this action)|tool use was rejected|user rejected|User declined|Request interrupted by user|interrupted by user/i],
  ['auto-mode-denied', 'Denied by auto mode\'s safety check', /denied by the Claude Code auto mode|auto mode classifier/i],
  ['hook-block', 'Blocked by a hook (guard / PreToolUse)', /PreToolUse:\S* hook|factory guard|hook error|blocked by .*hook|Hook .* denied/i],
  ['harness-block', 'Blocked by Claude Code itself (sleep, protected system path)', /<tool_use_error>Blocked:|on system path .* is blocked|This path is protected/i],
  ['permission-rule', 'Denied by a permission rule or protected path (e.g. .git/)', /Permission to use \w+|has been denied|denied by your permission|matches a deny rule|sensitive file|protected (location|path)|not allowed to (edit|write)|outside the allowed/i],
  ['github-auth', 'GitHub auth / 403 / missing scope', /\b40[13]\b|Permission to [\w./-]+ denied|Bad credentials|Resource not accessible|requires authentication|workflow scope|Enterprise Managed User|Authorization header|gh auth/i],
  ['limits', 'Usage, session, size or context limits', /session limit|hit your (usage )?limit|rate.?limit|usage limit|overloaded|\b529\b|prompt is too long|context (length|window)|too many tokens|exceeds the maximum|exceeds maximum allowed tokens|max_tokens|Concurrent subagent limit/i],
  ['network', 'Network, API or Claude login', /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|Connection error|socket hang up|fetch failed|getaddrinfo|Can't reach the API|response stopped arriving|OAuth session expired|Failed to authenticate/i],
  ['invalid-input', 'Tool called with invalid input', /InputValidationError|Invalid tool parameters|Invalid input/i],
  ['edit-precondition', 'Edit/Write precondition (string not found, file not read, changed on disk)', /String to replace not found|old_string|not unique|Found \d+ matches|has not been read|File has not been read|modified since|changed on disk|content has changed since it was last read|must read/i],
  ['browser-session', 'Browser session problems (already running, reconnected, navigated away)', /browser is already running|browser was restarted or reconnected|Execution context was destroyed|Target closed|Protocol error|No page|page has been closed/i, BROWSER],
  ['dom-not-found', 'Page element not found or not interactable (locator / DOM timing)', /Cannot read properties of (undefined|null)|Failed to interact with the element|is not (visible|attached|enabled)|waiting for (locator|selector)|No element|element is outside/i, BROWSER],
  ['missing-tool', 'Missing command, binary, module or agent', /command not found|is not recognized as (an internal|the name)|not installed|Cannot find module|MODULE_NOT_FOUND|native binary|Python was not found|Agent type '[^']+' not found/i],
  ['not-found', 'File or path not found', /ENOENT|No such file|does not exist|cannot find (the )?(path|file)|cannot find or open|Cannot find path|not found in|Path not found|Directory not found/i],
  ['timeout', 'Timeout', /timed out|Timeout \d+ms exceeded|timeout of|exceeded the (time|timeout)/i],
  ['test-failure', 'Test failures', /\bnot ok \d|\d+ (tests? )?failed|\bfailing\b|AssertionError|✘|Error: expect\(|toHave\w+|Test timeout|tests? failed/i],
  ['git-error', 'Git error', /^fatal:|\bfatal: |error: pathspec|merge conflict|non-fast-forward|\[rejected\]|would be overwritten|not a git repository/im],
  ['script-error', 'Script / syntax / runtime error (incl. sed, grep, inline node)', /SyntaxError|ParserError|Unexpected token|ReferenceError|TypeError|is not defined|unexpected EOF|parse error|InvalidOperation|ParameterBinding|Unmatched \(|unknown command|anchor not found|\[eval\]|triggerUncaughtException/i],
  ['os-process', 'OS / process error (spawn, access)', /spawn|EUNKNOWN|EPERM|EACCES|EBUSY|Access (to the path .* )?is denied|being used by another process/i],
  ['nonzero-exit', 'Command exited non-zero (no clearer cause)', /Exit code \d+/i],
];
const classify = (text, tool) => {
  for (const [id, label, re, toolRe] of CAUSES) if (re.test(text) && (!toolRe || toolRe.test(tool || ''))) return { id, label };
  if (/^mcp__/.test(tool || '')) return { id: 'mcp-browser', label: 'MCP / browser tool error' };
  return { id: 'other', label: 'Other' };
};
const clip = (s, n) => redact(String(s ?? '')).replace(/\r/g, '').slice(0, n);
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : c.type === 'tool_reference' ? `[${c.tool_name}]` : `[${c.type}]`)).join('\n') : JSON.stringify(content ?? ''));
const inputOf = (name, input = {}) => {
  if (input.command) return input.command;
  if (input.file_path) return `${input.file_path}${input.old_string ? ` (replace: ${String(input.old_string).slice(0, 80)}…)` : ''}`;
  return JSON.stringify(input);
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const records = [];
const sessionProject = {};
const projectsDir = path.join(HOME, 'projects');
for (const file of walk(projectsDir)) {
  const rel = path.relative(projectsDir, file).split(path.sep);
  const project = rel[0];
  const session = path.basename(rel[1], '.jsonl');
  const subagent = rel.length > 2;
  if (!subagent) sessionProject[session] = project;
  const uses = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const base = { project, session, subagent, timestamp: e.timestamp, cwd: e.cwd };
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use') uses.set(b.id, { name: b.name, input: b.input });
        if (b.type === 'tool_result' && b.is_error) {
          const use = uses.get(b.tool_use_id) || {};
          const error = textOf(b.content);
          const cause = classify(error, use.name);
          records.push({ ...base, source: 'tool', tool: use.name || '?', input: clip(inputOf(use.name, use.input), 400), error: clip(error, 800), cause: cause.id, causeLabel: cause.label });
        }
      }
    }
    if (e.type === 'system' && e.subtype === 'api_error') {
      const error = e.error?.formatted || e.error?.message || JSON.stringify(e.error);
      const cause = classify(error);
      records.push({ ...base, source: 'api', tool: null, input: '', error: clip(error, 500), cause: cause.id, causeLabel: cause.label });
    }
    if (e.isApiErrorMessage) {
      const error = textOf(content);
      const cause = classify(error);
      records.push({ ...base, source: 'api', tool: null, input: '', error: clip(error, 500), cause: cause.id, causeLabel: cause.label });
    }
    if (e.type === 'system' && e.subtype === 'stop_hook_summary' && (e.hookErrors || []).length) {
      const error = e.hookErrors.map((h) => (typeof h === 'string' ? h : JSON.stringify(h))).join('\n');
      records.push({ ...base, source: 'stop-hook', tool: 'Stop hook', input: (e.hookInfos || []).map((h) => h.command).join('; '), error: clip(error, 800), cause: 'stop-hook', causeLabel: 'Stop hook errors' });
    }
  }
}

// /insights per-session analyses: the friction the session ran into.
const facetsDir = path.join(HOME, 'usage-data', 'facets');
const facets = fs.existsSync(facetsDir)
  ? fs.readdirSync(facetsDir).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(facetsDir, f), 'utf8'));
    return { session: j.session_id, project: sessionProject[j.session_id] || '?', goal: j.underlying_goal, outcome: j.outcome, friction: j.friction_counts || {}, detail: clip(j.friction_detail, 1200), summary: clip(j.brief_summary, 600) };
  })
  : [];

if (SINCE) records.splice(0, records.length, ...records.filter((r) => String(r.timestamp) >= SINCE));

// --- group the same failure together ---
// Signature = cause + tool family + the error's first meaningful line with the parts that vary
// between occurrences (paths, URLs, numbers, element uids, quoted text, times) replaced.
const toolFamily = (t) => String(t || 'api').replace(/^mcp__(plugin_[\w-]+?_)?([\w-]+?)__(\w+)$/, (_m, _p, server, name) => `${server.replace(/-mcp$/, '')}:${name}`);
function normalize(error) {
  // Noise printed before the real message (dotenv tips, npm notices, CRLF warnings) is skipped.
  const NOISE = /^(Exit code \d+\s*)?(\[dotenv@|npm notice|npm warn|warning: in the working copy|> |Running \d+ tests?)/i;
  const lines = String(error).replace(/<\/?tool_use_error>/g, '').split('\n').map((l) => l.trim()).filter((l, i, all) => l && !(NOISE.test(l) && all.length > 1));
  let line = (lines[0] || '').replace(/^Exit code \d+\s*/, '') || lines[1] || '';
  // Stack traces start with a location (node:fs:1193, [eval]:5, a file path); the message is the
  // first line that names an error.
  const named = lines.find((l) => /^(\w*Error|Error|fatal|error)\b[:\s]|\b(Exception|ERR_[A-Z_]+)\b/.test(l.replace(/^Exit code \d+\s*/, '')));
  if (named && (/^(node:|\[eval\]|[A-Za-z]:[\\/]|\/|file:|at |<anonymous>)/.test(line) || !/[a-z]{3}/i.test(line))) line = named.replace(/^Exit code \d+\s*/, '');
  return line
    .replace(/`[^`]*`/g, '<cmd>') // the guard quotes the blocked command
    .replace(/(auto mode classifier\. Reason: \[[^\]]+\]).*/, '$1') // group auto-mode denials by reason
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z]:[\\/][^\s'"`,)]*|(?:\/[\w.@-]+){2,}\/?|~[\\/][^\s'"`,)]*/g, '<path>')
    .replace(/(["'`])(?:(?!\1).){1,80}\1/g, '<q>')
    .replace(/\buid\s*"?\d+_\d+"?|\b\d+_\d+\b/g, '<uid>')
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, '<time>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
const clusters = new Map();
for (const r of records) {
  const family = toolFamily(r.tool);
  const issue = normalize(r.error) || '(empty error)';
  const key = `${r.cause}|${family}|${issue}`;
  if (!clusters.has(key)) clusters.set(key, { id: '', cause: r.cause, causeLabel: r.causeLabel, tool: family, issue, count: 0, sessions: new Set(), projects: new Set(), first: r.timestamp, last: r.timestamp, example: { input: r.input, error: r.error }, occurrences: [] });
  const c = clusters.get(key);
  c.count++;
  c.sessions.add(r.session);
  c.projects.add(r.project);
  if (r.timestamp && r.timestamp < c.first) c.first = r.timestamp;
  if (r.timestamp && r.timestamp > c.last) c.last = r.timestamp;
  c.occurrences.push({ session: r.session, project: r.project, timestamp: r.timestamp, input: r.input.slice(0, 200) });
  r.issue = key;
}
const issues = [...clusters.values()].sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue));
// Stable ids (from the signature, not the rank), so rules and notes can cite them across runs.
const { createHash } = await import('node:crypto');
issues.forEach((c) => {
  c.id = `I-${createHash('sha1').update(`${c.cause}|${c.tool}|${c.issue}`).digest('hex').slice(0, 6)}`;
  c.sessions = [...c.sessions];
  c.projects = [...c.projects];
});
const issueId = new Map(issues.map((c) => [`${c.cause}|${c.tool}|${c.issue}`, c.id]));
for (const r of records) r.issue = issueId.get(r.issue);

// --- write ---
fs.mkdirSync(path.join(OUT, 'by-cause'), { recursive: true });
// Clear the previous run's groups file by file (a shell sitting in the folder locks it on Windows).
for (const f of fs.readdirSync(path.join(OUT, 'by-cause'))) fs.rmSync(path.join(OUT, 'by-cause', f), { force: true });
records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
fs.writeFileSync(path.join(OUT, 'traces.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const byCause = {};
for (const r of records) (byCause[r.cause] ||= []).push(r);
for (const [id, list] of Object.entries(byCause)) fs.writeFileSync(path.join(OUT, 'by-cause', `${id}.jsonl`), list.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'session-friction.json'), JSON.stringify(facets, null, 2));
fs.writeFileSync(path.join(OUT, 'issues.json'), JSON.stringify(issues, null, 2));

const count = (list, key) => Object.entries(list.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
const short = (p) => p.replace(/^[A-Za-z]--/, '').replace(/^Users-taufiseh-?/, '~').slice(0, 45);
const one = (s, n) => String(s).replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, n);
let md = `# Failure traces\n\nCollected ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from \`~/.claude\` (${Object.keys(sessionProject).length} sessions in ${new Set(Object.values(sessionProject)).size} projects). Local only: this folder is gitignored. Secrets are masked.\n\n`;
const repeated = issues.filter((c) => c.count > 1);
md += `**${records.length} failures** (${count(records, 'source').map(([k, v]) => `${v} ${k}`).join(', ')}) are **${issues.length} distinct issues**: ${repeated.length} happened more than once and account for ${repeated.reduce((n, c) => n + c.count, 0)} failures; ${issues.length - repeated.length} happened once.\n\n`;
const seen = (c) => `${c.first?.slice(5, 10)}${c.last?.slice(5, 10) !== c.first?.slice(5, 10) ? `…${c.last?.slice(5, 10)}` : ''}`;
const issueRow = (c) => `| ${c.id} | **${c.count}** | ${one(c.issue, 110)} | ${c.tool} | ${c.sessions.length} | ${c.projects.map(short).join(', ').slice(0, 60)} | ${seen(c)} |\n`;
md += `## Most repeated issues\n\n| Issue | × | Same failure (normalised) | Tool | Sessions | Projects | Seen (MM-DD) |\n|---|---|---|---|---|---|---|\n`;
for (const c of repeated.slice(0, 25)) md += issueRow(c);
md += `\n## Issues by cause\n\n| Cause | Failures | Distinct issues |\n|---|---|---|\n`;
const causes = Object.entries(byCause).sort((a, b) => b[1].length - a[1].length);
for (const [id, list] of causes) md += `| [${list[0].causeLabel}](#${id}) | ${list.length} | ${issues.filter((c) => c.cause === id).length} |\n`;
for (const [id, list] of causes) {
  const mine = issues.filter((c) => c.cause === id);
  md += `\n### ${list[0].causeLabel} <a id="${id}"></a>\n\n${list.length} failures, ${mine.length} distinct issues ([all occurrences](by-cause/${id}.jsonl)).\n\n| Issue | × | Same failure (normalised) | Tool | Sessions | Seen |\n|---|---|---|---|---|---|\n`;
  for (const c of mine.slice(0, 12)) md += `| ${c.id} | ${c.count} | ${one(c.issue, 120)} | ${c.tool} | ${c.sessions.length} | ${seen(c)} |\n`;
  if (mine.length > 12) md += `| | | …and ${mine.length - 12} more (one-offs), see issues.json | | | |\n`;
  const top = mine[0];
  md += `\nExample of ${top.id}: \`${one(top.example.input || '(no input)', 140)}\`\n→ ${one(top.example.error, 260)}\n`;
}
md += `\n## By project\n\n| Project | Failures | Main causes |\n|---|---|---|\n`;
for (const [p, n] of count(records, 'project')) {
  md += `| ${short(p)} | ${n} | ${count(records.filter((r) => r.project === p), 'cause').slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')} |\n`;
}
if (facets.length) {
  const fr = {};
  for (const f of facets) for (const [k, v] of Object.entries(f.friction)) fr[k] = (fr[k] || 0) + v;
  md += `\n## Session-level friction (from /insights, ${facets.length} sessions)\n\nThese are judgement-level failures (misread requests, wrong approach) that never show up as an error.\n\n| Friction | Count |\n|---|---|\n`;
  for (const [k, v] of Object.entries(fr).sort((a, b) => b[1] - a[1])) md += `| ${k.replace(/_/g, ' ')} | ${v} |\n`;
  md += `\nOutcomes: ${count(facets, 'outcome').map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}. Details per session: [session-friction.json](session-friction.json).\n`;
}
md += `\n## Files\n\n- \`issues.json\`: the distinct issues: same failure grouped, with count, sessions, projects, first/last seen, an example and every occurrence\n- \`traces.jsonl\`: every failure (project, session, time, tool, input, error, cause, issue id)\n- \`by-cause/<cause>.jsonl\`: the same, split by cause\n- \`session-friction.json\`: /insights friction per session\n- \`collect.mjs\`: re-run with \`node .claude/logs/failure-traces/collect.mjs .\`\n`;
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
fs.writeFileSync(path.join(OUT, 'collect.mjs'), SELF);
console.log(`${records.length} failures, ${Object.keys(byCause).length} causes, ${facets.length} session analyses -> ${OUT}`);
for (const [id, list] of Object.entries(byCause).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(list.length).padStart(4)}  ${list[0].causeLabel}`);
