#!/usr/bin/env node
// Screens untrusted text (ticket titles/bodies, PR comments, tool output) for prompt injection
// and malicious requests before an agent acts on it. Rule-based: the same text always gets the
// same verdict, it costs nothing, and it runs before the model reads the text.
//
//   SAFE    nothing found
//   REVIEW  something a human should look at first (hidden HTML comment, new dependency, ...)
//   BLOCK   an injection attempt or a request the factory must never carry out
//
// Usage:
//   node screen.mjs --issue 6            # a ticket (title + body) from GitHub
//   node screen.mjs --pr 60              # every comment and review on a PR
//   node screen.mjs --file ticket.md     # or text on stdin
//   add --json for machine-readable output
// As a module: import { screen } from './screen.mjs'; screen(text) -> { verdict, findings }

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿\u{E0000}-\u{E007F}]/gu;
const GUARDRAILS = String.raw`\.claude[\\/](settings(\.local)?\.json|factory\.json|hooks|agents|skills)|\.mcp\.json|\.gitignore|\.github[\\/](workflows|CODEOWNERS)|guard(-rules)?\.mjs|auto-commit\.mjs|allowlist|allowed ?authors|branch protection`;
const CHANGE = String.raw`delete|remove|disable|turn off|edit|change|modify|overwrite|replace|rewrite|add|append|update|allow|bypass|skip|relax|loosen|empty|clear|rename|move`;

// id, severity, why, pattern. Patterns run on the text with invisible characters removed, plus
// on any decoded base64 blob.
export const RULES = [
  // --- prompt injection ---
  { id: 'ignore-instructions', severity: 'block', why: 'tries to override the agent\'s instructions', re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|the|any|system|safety)\b[^.\n]{0,30}\b(instructions?|rules|prompts?|guidelines|guardrails|polic(y|ies)|constraints)\b/i },
  { id: 'role-switch', severity: 'block', why: 'tries to give the agent a new identity or mode', re: /\byou are (now|no longer)\b|\b(enter|switch to|activate)\b[^.\n]{0,20}\b(developer|maintenance|admin|god|jailbreak|DAN|unrestricted) mode\b/i },
  { id: 'fake-role-header', severity: 'block', why: 'fakes a system/assistant message inside the text', re: /^\s*(#+\s*)?((system|developer)\s+(message|prompt|instructions?|note)|assistant|AI|agent|claude)\s*:/im },
  { id: 'fake-system-caps', severity: 'block', why: 'fakes a system message inside the text', re: /^\s*\[?SYSTEM\]?\s*:/m },
  { id: 'fake-role-tag', severity: 'block', why: 'fakes a system/assistant message inside the text', re: /<\/?\s*(system|assistant|instructions?|admin|im_start|im_end)\b[^>]*>|\[\/?(INST|SYS)\]/i },
  { id: 'addressed-to-ai', severity: 'block', why: 'gives orders to the AI rather than describing a feature', re: /\b(AI|LLM|agent|assistant|Claude|bot|model|copilot)\b[^.\n]{0,15}[:,]\s*(please\s+)?(ignore|run|execute|push|merge|delete|add|send|print|disable|you (must|should))\b/i },
  { id: 'claims-approval', severity: 'block', why: 'claims an approval the agent can\'t verify', re: /\b(user|owner|maintainer|admin|reviewer)\b[^.\n]{0,20}\b(has |already )?(approved|authori[sz]ed|allowed|signed off)\b[^.\n]{0,40}\b(merg|push|clos|delet|deploy|skip)/i },
  { id: 'secrecy', severity: 'block', why: 'asks to hide what is done from the user or reviewer', re: /\b(don'?t|do not|never|without)\b[^.\n]{0,20}\b(tell|mention|inform|notify|show|report|alert|include it in)\b[^.\n]{0,30}\b(user|owner|reviewer|maintainer|anyone|PR|pull request|summary|description)\b|\b(quietly|silently|secretly|covertly|stealthily)\s+(add|send|upload|post|push|commit|install|remove|delete|change|include|insert|run|copy|exfiltrate)\b/i },

  // --- dangerous requests ---
  { id: 'guardrail-change', severity: 'block', why: 'asks to change the factory\'s own guardrails', re: new RegExp(String.raw`\b(${CHANGE})\b[^\n]{0,60}(${GUARDRAILS})|(${GUARDRAILS})[^\n]{0,60}\b(${CHANGE})\b`, 'i') },
  { id: 'skip-checks', severity: 'block', why: 'asks to skip tests, reviews or safety checks', re: /\b(skip|disable|bypass|turn off|ignore)\b[^.\n]{0,25}\b(tests?|hooks?|guard|reviews?|security|checks?|ci|verification|linters?|approval|branch protection)\b|--no-verify\b/i },
  { id: 'git-destructive', severity: 'block', why: 'asks for a destructive or review-skipping git/GitHub action', re: /\bforce[- ]?push|push\b[^.\n]{0,15}(--force|-f\b)|\bpush\b[^.\n]{0,30}\b(to|into|onto) (the )?(main|master)\b|\breset --hard\b|\b(delete|remove)\b[^.\n]{0,20}\b(the |a |all |remote |git |every )?(branch(es)?|repo(sitory)?|commits?|git history)\b|\bgit tag -d\b|(^|[.!?:]\s+|\n\s*)(please\s+|now\s+)?(merge|approve)\b[^.\n]{0,20}\b(PR|pull request|it|this)\b|(^|[.!?:]\s+|\n\s*)(please\s+|now\s+|also\s+)?close\b[^.\n]{0,15}\b(issues?|tickets?)\b|\brewrite (git )?history\b/i },
  { id: 'secret-access', severity: 'block', why: 'asks for secrets, tokens or environment variables', re: /\b(print|echo|show|output|log|dump|cat|list|send|post|upload|share|paste|leak|exfiltrate|expose)\b[^.\n]{0,40}\b(env(ironment)?\s*(vars?|variables)|\.env\b|process\.env|tokens?|secrets?|credentials?|api[ _-]?keys?|ssh[ _-]?keys?|private keys?|GITHUB_TOKEN|GH_TOKEN|cookies|session ids?|\.git-credentials|\.npmrc)\b/i },
  { id: 'exfiltration', severity: 'block', why: 'points at a known data-exfiltration or tunnelling service', re: /\b(webhook\.site|requestbin|pipedream\.net|ngrok(-free)?\.(io|app)|pastebin\.com|hastebin|transfer\.sh|0x0\.st|interactsh|oast\.(fun|pro|live|site)|burpcollaborator|canarytokens|discord(app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\b/i },
  { id: 'remote-exec', severity: 'block', why: 'runs a script downloaded from the internet', re: /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]{0,120}\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\|\s*(iex|Invoke-Expression|python3?|node)\b|\b(iex|Invoke-Expression)\s*\(?\s*(\(|\$|New-Object|iwr|irm)|\bbash\s+<\(\s*curl/i },
  { id: 'hidden-network-call', severity: 'block', why: 'asks to send data to an outside server', re: /\b(send|post|upload|report|beacon|forward|sync)\b[^.\n]{0,40}\b(to|at)\b[^.\n]{0,20}\b(my|our|this|an?|external|remote|third[- ]party)\s+(server|endpoint|url|webhook|host|domain|api)\b/i },

  // --- needs a human look ---
  { id: 'hidden-html', severity: 'review', why: 'contains text hidden from the GitHub page (HTML comment or hidden element)', re: /<!--(?!\s*factory-loop\s*-->)[\s\S]*?-->|<[^>]+\b(hidden|display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)\b[^>]*>/i },
  { id: 'new-dependency', severity: 'review', why: 'adds a dependency (supply-chain risk)', re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\bpostinstall\b|"dependencies"\s*:|\bgit\+https?:|\.tgz\b/i },
  { id: 'dangerous-code', severity: 'review', why: 'asks for code that runs strings or shells out', re: /\beval\s*\(|\bnew Function\s*\(|\bchild_process\b|\bexecSync\b|\bspawn\s*\(|\bdocument\.cookie\b|\binnerHTML\s*=|\bdangerouslySetInnerHTML\b/i },
  { id: 'raw-ip-url', severity: 'review', why: 'links to a raw IP address', re: /\bhttps?:\/\/\d{1,3}(\.\d{1,3}){3}\b/i },
  { id: 'data-uri', severity: 'review', why: 'contains an embedded data: URI', re: /\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/i },
];

const RANK = { safe: 0, review: 1, block: 2 };
const show = (s) => s.replace(INVISIBLE, (c) => `\\u{${c.codePointAt(0).toString(16)}}`).replace(/\s+/g, ' ').trim();

function excerpt(text, index, length) {
  const start = Math.max(0, index - 30);
  return show(text.slice(start, Math.min(text.length, index + length + 30))).slice(0, 140);
}

function scan(text, where, findings) {
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) findings.push({ rule: rule.id, severity: rule.severity, why: rule.why, where, excerpt: excerpt(text, m.index, m[0].length) });
  }
}

export function screen(input) {
  const raw = String(input ?? '');
  const findings = [];
  const invisible = raw.match(INVISIBLE);
  if (invisible) {
    const i = raw.search(INVISIBLE);
    findings.push({ rule: 'invisible-characters', severity: 'block', why: `contains ${invisible.length} invisible or text-direction character(s), a way to hide instructions`, where: 'text', excerpt: excerpt(raw, i, 1) });
  }
  const text = raw.replace(INVISIBLE, '');
  scan(text, 'text', findings);
  // Encoded payloads: decode long base64 runs and scan what they say.
  for (const m of text.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
    const decoded = Buffer.from(m[0], 'base64').toString('utf8');
    const printable = decoded.replace(/[^\x20-\x7E\s]/g, '').length / Math.max(1, decoded.length);
    if (printable < 0.9) continue;
    findings.push({ rule: 'encoded-text', severity: 'review', why: 'contains base64 that decodes to readable text', where: 'base64', excerpt: show(decoded).slice(0, 140) });
    scan(decoded, 'base64', findings);
  }
  const verdict = findings.reduce((v, f) => (RANK[f.severity] > RANK[v] ? f.severity : v), 'safe').toUpperCase();
  return { verdict, findings };
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  const val = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const asJson = args.includes('--json');
  const items = [];
  if (val('--issue') || val('--pr')) {
    const { api, apiList, repoSlug, saveCache } = await import('../../factory-loop/scripts/lib.mjs');
    const slug = repoSlug();
    if (val('--issue')) {
      const i = await api(`/repos/${slug}/issues/${val('--issue')}`);
      items.push({ source: `issue #${i.number} by ${i.user?.login}`, text: `${i.title}\n\n${i.body || ''}` });
    } else {
      const n = val('--pr');
      const [reviews, inline, convo] = await Promise.all([apiList(`/repos/${slug}/pulls/${n}/reviews`), apiList(`/repos/${slug}/pulls/${n}/comments`), apiList(`/repos/${slug}/issues/${n}/comments`)]);
      for (const c of [...reviews, ...inline, ...convo]) if ((c.body || '').trim()) items.push({ source: `PR #${n} comment by ${c.user?.login} (${c.submitted_at || c.created_at})`, text: c.body });
    }
    saveCache();
  } else {
    const fs = await import('node:fs');
    items.push({ source: val('--file') || 'stdin', text: val('--text') ?? fs.readFileSync(val('--file') || 0, 'utf8') });
  }
  const results = items.map((it) => ({ source: it.source, ...screen(it.text) }));
  if (asJson) return console.log(JSON.stringify(results, null, 2));
  if (!results.length) return console.log('nothing to screen');
  for (const r of results) {
    console.log(`${r.verdict.padEnd(6)} ${r.source}`);
    for (const f of r.findings) console.log(`  [${f.severity}] ${f.rule}: ${f.why}\n          "${f.excerpt}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
