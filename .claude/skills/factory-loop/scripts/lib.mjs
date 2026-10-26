// Shared helpers for the factory-loop scripts: git, repo detection, and a GitHub REST client
// that caches GET responses by ETag in .git/ (304s do not count against the rate limit).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Marker on every comment/PR body the loop writes, so its own posts are not mistaken for
// review feedback (the loop posts with the user's own account).
export const MARKER = '<!-- factory-loop -->';

export const quietEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

export function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: quietEnv }).trim();
  } catch {
    return '';
  }
}

export function repoSlug() {
  const url = git('remote', 'get-url', 'origin');
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) {
    console.error(`origin is not a GitHub remote: ${url || '(no origin)'}`);
    process.exit(2);
  }
  return `${m[1]}/${m[2]}`;
}

// Private loop state (cache, drafts) lives in .git/factory-loop/, never committed.
export function stateDir() {
  const dir = path.resolve(git('rev-parse', '--git-path', 'factory-loop') || '.git/factory-loop');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// GITHUB_PERSONAL_ACCESS_TOKEN is the variable the GitHub MCP plugin reads, so one token can
// serve both.
export function token() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (env) return env;
  if (process.env.FACTORY_NO_GH) return null; // tests: never pick up the machine's gh login
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const cacheFile = () => path.join(stateDir(), 'api-cache.json');
let cache;
function loadCache() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    } catch {
      cache = {};
    }
  }
  return cache;
}
export function saveCache() {
  if (cache) fs.writeFileSync(cacheFile(), JSON.stringify(cache));
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// GitHub REST call. GETs are ETag-cached; other methods need a token.
export async function api(method, urlPath, body) {
  // FACTORY_API_BASE points the scripts at a fake GitHub API in tests.
  const base = process.env.FACTORY_API_BASE || 'https://api.github.com';
  const url = urlPath.startsWith('http') ? urlPath : `${base}${urlPath}`;
  const headers = { 'User-Agent': 'factory-loop', Accept: 'application/vnd.github+json' };
  const tok = token();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (method !== 'GET' && !tok) {
    throw new ApiError(401, 'No GitHub token. Set GITHUB_TOKEN (or GH_TOKEN), or install gh and run `gh auth login`.');
  }
  const c = loadCache();
  const cached = method === 'GET' ? c[url] : null;
  if (cached) headers['If-None-Match'] = cached.etag;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 304 && cached) return cached.body;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. an HTML error page from a 5xx); keep the status, report the text.
    if (res.ok) throw new ApiError(res.status, `GitHub API ${res.status} ${method} ${urlPath}: unexpected non-JSON response`);
  }
  if (!res.ok) {
    let msg = `GitHub API ${res.status} ${method} ${urlPath}: ${data?.message || text.slice(0, 200)}`;
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
      msg += ` (rate limited until ${reset.toLocaleTimeString()}; a token raises the limit to 5000/h)`;
    }
    if ((res.status === 404 || res.status === 403) && method !== 'GET') msg += ' (does the token have write access to this repo?)';
    throw new ApiError(res.status, msg);
  }
  if (method === 'GET' && res.headers.get('etag')) c[url] = { etag: res.headers.get('etag'), body: data };
  return data;
}

// All pages of a list endpoint (per_page=100).
export async function apiList(urlPath) {
  const out = [];
  const sep = urlPath.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const batch = await api('GET', `${urlPath}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

// .claude/factory.json: { allowedAuthors: [...] }. Missing file or list = nobody is trusted, so a
// misconfigured repo builds nothing rather than everything.
export function factoryConfig() {
  const root = git('rev-parse', '--show-toplevel') || process.cwd();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'factory.json'), 'utf8'));
    return { allowedAuthors: (cfg.allowedAuthors || []).map((a) => String(a).toLowerCase()) };
  } catch {
    return { allowedAuthors: [] };
  }
}

// Draft PR bodies are named after the branch: review/tickets-1-5 -> pr-review-tickets-1-5.md
export function prDraftPath(branch) {
  return path.join(stateDir(), `pr-${branch.replace(/[^\w.-]+/g, '-')}.md`);
}

export function arg(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
