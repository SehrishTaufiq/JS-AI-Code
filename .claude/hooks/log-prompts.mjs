#!/usr/bin/env node
// Stop hook: appends this session's new human prompts to .claude/logs/prompts.jsonl.
// Reads the hook payload (JSON with transcript_path, session_id) from stdin.
// Prompts already in the log (matched by uuid) are skipped, so every stop adds only new ones.
//
// Covers both normal prompts (transcript "user" entries from a human) and messages typed
// while Claude was working (transcript "attachment" entries of type queued_command).
// The log is pushed to a public branch, so token-like strings are masked before writing.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from './secrets.mjs';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const logFile = path.join(projectDir, '.claude', 'logs', 'prompts.jsonl');

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function textOf(content) {
  if (typeof content === 'string') return { text: content, images: 0 };
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const images = blocks.filter((b) => b.type === 'image').length;
  return { text, images };
}

// Local command output and caveats are recorded as user messages but are not prompts.
const NOT_A_PROMPT = /^\s*<(local-command-stdout|local-command-stderr|local-command-caveat)>/;

function promptFrom(entry) {
  if (entry.isSidechain) return null;
  if (entry.type === 'user' && !entry.isMeta && entry.origin?.kind === 'human') {
    const { text, images } = textOf(entry.message?.content);
    if (!text.trim() && !images) return null;
    return { uuid: entry.uuid, timestamp: entry.timestamp, source: 'prompt', text, images };
  }
  const a = entry.type === 'attachment' ? entry.attachment : null;
  if (a?.type === 'queued_command' && a.origin?.kind === 'human' && typeof a.prompt === 'string') {
    return { uuid: a.source_uuid || entry.uuid, timestamp: a.timestamp || entry.timestamp, source: 'mid-turn', text: a.prompt, images: 0 };
  }
  return null;
}

const input = readStdin();
if (!input.transcript_path || !fs.existsSync(input.transcript_path)) process.exit(0);

const logged = new Set(readJsonl(logFile).map((r) => r.uuid));
const fresh = [];
for (const entry of readJsonl(input.transcript_path)) {
  const p = promptFrom(entry);
  if (!p || NOT_A_PROMPT.test(p.text) || logged.has(p.uuid)) continue;
  logged.add(p.uuid);
  fresh.push({
    timestamp: p.timestamp,
    session_id: input.session_id || entry.sessionId,
    uuid: p.uuid,
    source: p.source,
    prompt: redact(p.text),
    ...(p.images ? { images: p.images } : {}),
  });
}

if (fresh.length) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
