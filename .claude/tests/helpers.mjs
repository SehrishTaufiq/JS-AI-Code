// Test helpers: throwaway git repos with a local bare "remote", and running the hook/script
// entry points the way Claude Code does (JSON on stdin, CLAUDE_PROJECT_DIR set).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOOKS = path.join(ROOT, '.claude', 'hooks');
export const SCRIPTS = path.join(ROOT, '.claude', 'skills', 'factory-loop', 'scripts');

const cleanups = [];
process.on('exit', () => {
  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
});

export function tmpDir(prefix = 'factory-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

export function sh(cwd, cmd, ...args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A working clone on `main` with one commit, pushed to a bare remote. Optionally a fake GitHub
// origin URL (for scripts that read the repo slug), with pushes still going to the bare repo.
export function makeRepo({ githubSlug } = {}) {
  const base = tmpDir();
  const remote = path.join(base, 'remote.git');
  const work = path.join(base, 'work');
  sh(base, 'git', 'init', '-q', '--bare', '-b', 'main', remote);
  sh(base, 'git', 'clone', '-q', remote, work);
  const g = (...a) => sh(work, 'git', ...a);
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  g('config', 'core.autocrlf', 'false');
  g('checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, '.gitignore'), '.claude/logs/\n');
  fs.writeFileSync(path.join(work, 'README.md'), '# test\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  g('push', '-q', '-u', 'origin', 'main');
  g('remote', 'set-head', 'origin', 'main');
  if (githubSlug) {
    g('remote', 'set-url', 'origin', `https://github.com/${githubSlug}.git`);
    g('remote', 'set-url', '--push', 'origin', remote);
  }
  return { base, remote, work, g, rg: (...a) => sh(base, 'git', '--git-dir', remote, ...a) };
}

// Runs a .mjs entry point with a JSON payload on stdin.
export function runNode(script, { cwd, payload = {}, env = {} } = {}) {
  const res = spawnSync(process.execPath, [script, ...(env.ARGS || [])], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, GIT_TERMINAL_PROMPT: '0', FACTORY_NO_GH: '1', ...env },
  });
  return { code: res.status, stdout: res.stdout.trim(), stderr: res.stderr.trim() };
}

// Async on purpose: the fake GitHub server runs in this same process, and a synchronous spawn
// would block its event loop, so the script under test would wait forever for a response.
export function runScript(name, args, { cwd, env = {}, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, name), ...args], {
      cwd,
      env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', FACTORY_NO_GH: '1', GIT_TERMINAL_PROMPT: '0', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${name} timed out after ${timeoutMs}ms\n${stderr}`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export const systemMessage = (stdout) => (stdout ? JSON.parse(stdout).systemMessage : '');

// Fake token strings built at runtime, so this file never contains a real-looking secret.
export const fakeGithubToken = () => 'ghp_' + 'A1b2C3d4E5'.repeat(4);
