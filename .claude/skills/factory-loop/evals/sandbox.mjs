// Shared plumbing for the factory-loop evals: a throwaway copy of this repo with a local "GitHub"
// remote, and a headless `claude -p` run whose stream-json events are saved as the run's log.
//
// Safety: the sandbox's origin is a local bare repo (its path ends in github.com/o/r.git so the
// factory scripts accept it), the GitHub API is a fake (FACTORY_API_BASE), real tokens are
// removed from the environment, MCP servers are off, and user-level settings/plugins are not
// loaded, so a run can only touch the temp folder.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const OUT = path.join(ROOT, '.git', 'factory-loop', 'evals');
export const CLAUDE = process.env.CLAUDE_CODE_EXECPATH || 'claude';

export const sh = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => {
  try {
    return sh(cwd, 'git', ...args);
  } catch {
    return '';
  }
};

// A clone of the current branch (committed state only) as `main`, pushed to a local bare remote.
export function makeSandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-eval-'));
  const bare = path.join(base, 'github.com', 'o', 'r.git');
  const work = path.join(base, 'work');
  const branch = sh(ROOT, 'git', 'rev-parse', '--abbrev-ref', 'HEAD');
  sh(base, 'git', 'clone', '-q', '--no-local', '--single-branch', '--branch', branch, ROOT, work);
  const g = (...a) => sh(work, 'git', ...a);
  if (branch !== 'main') g('branch', '-m', branch, 'main');
  g('config', 'user.name', 'Eval Bot');
  g('config', 'user.email', 'eval@example.com');
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  sh(base, 'git', 'init', '-q', '--bare', '-b', 'main', bare);
  g('remote', 'set-url', 'origin', bare.replace(/\\/g, '/'));
  g('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'); // clone was single-branch
  g('push', '-q', '-u', 'origin', 'main');
  g('fetch', '-q', '--prune', 'origin');
  g('remote', 'set-head', 'origin', 'main');
  return { base, bare, work, g, tryG: (...a) => tryGit(work, ...a), rg: (...a) => tryGit(base, '--git-dir', bare, ...a) };
}

// Makes every push to the sandbox remote fail the way GitHub does without write access.
export function rejectPushes(bare) {
  const hook = path.join(bare, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "Permission to o/r.git denied to Sehrish-Lodhi_Jonas."\necho "fatal: unable to access: The requested URL returned error: 403"\nexit 1\n');
  fs.chmodSync(hook, 0o755);
}

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    // Child sessions must not look nested in this one, nor inherit any GitHub credentials.
    if (/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|MESSAGING_SOCKET|MESSAGING_TOKEN|SSE_PORT|SESSION_ATTENDED)|CLAUDE_PID|CLAUDE_PROJECT_DIR)$/.test(k)) delete env[k];
    if (/^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PERSONAL_ACCESS_TOKEN)$/.test(k)) delete env[k];
  }
  return { ...env, FACTORY_NO_GH: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

// Runs `claude -p` and resolves with every stream-json event. onEvent(event, stop) may call
// stop() to end the run early (trigger evals stop at the first tool call).
export function runClaude({ cwd, prompt, env, flags = [], logFile, timeoutMs = 20 * 60_000, onEvent }) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project,local', '--strict-mcp-config', '--no-session-persistence', ...flags];
    const child = spawn(CLAUDE, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const events = [];
    const log = logFile ? fs.createWriteStream(logFile) : null;
    let buf = '';
    let stderr = '';
    let stopped = null;
    const stop = (why) => {
      stopped ??= why;
      child.kill();
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        log?.write(line + '\n');
        try {
          const e = JSON.parse(line);
          events.push(e);
          onEvent?.(e, stop);
        } catch {
          /* non-JSON noise */
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      log?.end();
      resolve({ events, code, stopped, stderr: stderr.slice(-2000) });
    });
  });
}

// Flattens a run into what graders need: ordered tool calls (main agent and subagents), shell
// commands, the final reply and usage.
export function digest(events) {
  const calls = [];
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    for (const b of e.message?.content || []) {
      if (b.type === 'tool_use') calls.push({ name: b.name, input: b.input || {}, sub: !!e.parent_tool_use_id });
    }
  }
  const result = events.findLast((e) => e.type === 'result') || {};
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {};
  return {
    calls,
    commands: calls.filter((c) => /^(Bash|PowerShell)$/.test(c.name)).map((c) => String(c.input.command || '')),
    edits: calls.filter((c) => /^(Edit|Write|NotebookEdit)$/.test(c.name)).map((c) => String(c.input.file_path || '').replace(/\\/g, '/')),
    final: String(result.result || ''),
    stats: { model: init.model, turns: result.num_turns, costUsd: result.total_cost_usd, ms: result.duration_ms, subtype: result.subtype, mcpServers: (init.mcp_servers || []).length },
  };
}
