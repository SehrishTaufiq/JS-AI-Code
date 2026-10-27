// Rules for the PreToolUse command guard (guard.mjs). Pure: check(command, ctx) -> verdict.
// Prefix-only permission rules miss variants (`--force-with-lease`, `+branch`, `git -C . push -f`,
// `find -delete`, `node -e "fs.rmSync(..)"`), so each shell segment is inspected as a whole.
//
// verdict: { decision: 'allow' | 'ask' | 'deny', reason }

// Files that hold the guardrails themselves; changing them needs the user.
export const PROTECTED = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/factory.json',
  '.claude/hooks/',
  '.claude/skills/factory-loop/scripts/',
  '.mcp.json',
  '.gitignore',
  '.github/workflows/',
];

const DEFAULT_BRANCHES = ['main', 'master'];

// Split on shell separators (&&, ||, ;, |, newlines). Quotes are not parsed; splitting inside a
// quoted string can only produce extra segments to check, never hide one.
function segments(command) {
  return command.split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const norm = (s) => s.replace(/\\/g, '/');

function mentionsProtected(text) {
  const t = norm(text);
  return PROTECTED.find((p) => t.includes(p));
}

// Harmless redirections that would otherwise look like writes.
function stripNoiseRedirects(s) {
  return s.replace(/\d?>&\d/g, ' ').replace(/\d?>{1,2}\s*(\/dev\/null|\$null|nul)\b/gi, ' ');
}

// `git [global options] <sub> <rest>`: finds the real subcommand, so a commit message that
// mentions "push to main" is not mistaken for a push.
function gitCall(seg) {
  const m = seg.match(/(?:^|\s)git(?:\.exe)?\s+(.*)$/);
  if (!m) return null;
  const toks = m[1].trim().split(/\s+/);
  let i = 0;
  while (i < toks.length && toks[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(toks[i]) ? 2 : 1;
  return { sub: toks[i] || '', rest: ` ${toks.slice(i + 1).join(' ')} ` };
}

const git = (sub, test) => (s, ctx) => {
  const g = gitCall(s);
  return !!g && (Array.isArray(sub) ? sub.includes(g.sub) : g.sub === sub) && test(g.rest, ctx, g);
};

const RULES = [
  // --- git push ---
  {
    test: git('push', (r) => /\s--force(-with-lease|-if-includes)?(=\S*)?\s/.test(r) || /\s-[a-zA-Z]*f[a-zA-Z]*\s/.test(r)),
    decision: 'deny',
    reason: 'force-push is not allowed (rewrites published history)',
  },
  { test: git('push', (r) => /\s\+\S+/.test(r)), decision: 'deny', reason: 'force-push via a +refspec is not allowed' },
  {
    test: git('push', (r) => /\s--delete\s/.test(r) || /\s-d\s/.test(r) || /\s:\S+/.test(r)),
    decision: 'deny',
    reason: 'deleting remote branches/tags is not allowed',
  },
  {
    test: git('push', (r, ctx) => {
      const names = DEFAULT_BRANCHES.join('|');
      if (new RegExp(`(\\s|:|refs/heads/)(${names})\\s`).test(r)) return true;
      // Bare `git push` / `git push origin` while on the default branch.
      const args = r.trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
      return args.length <= 1 && DEFAULT_BRANCHES.includes(ctx.currentBranch);
    }),
    decision: 'deny',
    reason: 'pushing to main is not allowed; work reaches main only through a reviewed PR',
  },
  // --- local history / working tree ---
  { test: git('reset', (r) => /\s--hard\s/.test(r)), decision: 'deny', reason: 'git reset --hard discards work' },
  { test: git('clean', (r) => /\s-[a-zA-Z]*[fdx]/.test(r) || /\s--force\s/.test(r)), decision: 'deny', reason: 'git clean deletes untracked files' },
  { test: git('checkout', (r) => /\s--\s/.test(r) || /^\s+\.\s+$/.test(r)), decision: 'deny', reason: 'git checkout -- discards changes' },
  { test: git('restore', (r) => !/\s--staged\s/.test(r) || /\s(--worktree|-W)\s/.test(r)), decision: 'deny', reason: 'git restore without --staged discards changes' },
  { test: git('rm', (r) => !/\s--cached\s/.test(r)), decision: 'deny', reason: 'git rm deletes files (use --cached to only untrack)' },
  { test: git('branch', (r) => /\s(-D|-d|--delete)\s/.test(r) || /\s-[a-zA-Z]*[dD]\s/.test(r)), decision: 'deny', reason: 'deleting branches is not allowed' },
  { test: git('tag', (r) => /\s(-d|--delete)\s/.test(r)), decision: 'deny', reason: 'deleting tags is not allowed' },
  { test: git('stash', (r) => /^\s+(drop|clear)\s/.test(r)), decision: 'deny', reason: 'dropping stashes loses parked work' },
  { test: git(['filter-branch', 'filter-repo'], () => true), decision: 'deny', reason: 'history rewriting is not allowed' },
  { test: git('update-ref', (r) => /\s-d\s/.test(r)), decision: 'deny', reason: 'deleting refs is not allowed' },
  { test: git('reflog', (r) => /^\s+(expire|delete)\s/.test(r)), decision: 'deny', reason: 'pruning the reflog is not allowed' },
  { test: git(['rebase', 'merge'], () => true), decision: 'ask', reason: 'rebase/merge changes history: confirm first' },
  { test: git('commit', (r) => /\s--amend\s/.test(r)), decision: 'ask', reason: 'amending changes history: confirm first' },
  // --- GitHub ---
  { test: (s) => /\bgh\b.*\bpr\b\s+merge\b/.test(s), decision: 'deny', reason: 'merging PRs is the human reviewer\'s job' },
  { test: (s) => /\bgh\b.*\b(issue|pr)\b\s+(close|delete)\b/.test(s), decision: 'deny', reason: 'closing/deleting issues or PRs is the human reviewer\'s job' },
  { test: (s) => /\bgh\b.*\b(repo|release|run|cache|secret|variable)\b\s+delete\b/.test(s), decision: 'deny', reason: 'deleting GitHub resources is not allowed' },
  {
    test: (s) => (/\bgh\b\s+api\b/.test(s) || /\bcurl\b.*api\.github\.com/.test(s)) && /(-X|--method|--request)\s*=?\s*['"]?DELETE/i.test(s),
    decision: 'deny',
    reason: 'DELETE calls to the GitHub API are not allowed',
  },
  {
    test: (s) => (/\bgh\b\s+api\b/.test(s) || /\bcurl\b.*api\.github\.com/.test(s)) && /\/merge\b|state[\\"'=:\s]+closed/i.test(s),
    decision: 'deny',
    reason: 'merging PRs or closing issues via the API is the human reviewer\'s job',
  },
  // --- deleting files ---
  { test: (s) => /(^|\s)rm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR]/.test(s) || /(^|\s)rm\b.*--recursive\b/.test(s), decision: 'deny', reason: 'recursive delete is not allowed' },
  { test: (s) => /\bfind\b.*(\s-delete\b|-exec\s+rm\b|-execdir\s+rm\b)/.test(s), decision: 'deny', reason: 'find -delete / -exec rm is not allowed' },
  { test: (s) => /(^|\s)(rd|rmdir|del|erase)\b.*\s\/[sq]\b/i.test(s), decision: 'deny', reason: 'recursive delete (cmd) is not allowed' },
  { test: (s) => /\b(remove-item|ri|rm|rmdir|del)\b.*\s-(r|recurse)\b/i.test(s), decision: 'deny', reason: 'Remove-Item -Recurse is not allowed' },
  {
    test: (s) => /\b(node|deno|bun|python3?|py|perl|ruby)\b.*\s(-e|-c|--eval|-p)\b/.test(s) && /\b(rmSync|rmdirSync|unlinkSync|rimraf|rmtree|fs\.rm\(|os\.remove|os\.unlink|shutil)\b/.test(s),
    decision: 'deny',
    reason: 'deleting files from inline scripts is not allowed',
  },
];

// Writes to the guardrail files from the shell (Edit/Write tools are covered by deny rules).
function protectedWrite(seg) {
  const s = stripNoiseRedirects(seg);
  const redirect = [...s.matchAll(/(^|[^<\d])>{1,2}\s*["']?([^\s"'|;&]+)/g)].map((m) => m[2]);
  const target = redirect.find((t) => mentionsProtected(t));
  if (target) return target;
  const writes = /\b(sed\s+(-[a-zA-Z]*i|--in-place)|tee|cp|mv|install|truncate|chmod|ln|dd|set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|clear-content|writeFileSync|appendFileSync|writeFile|rm|unlink|del|erase|remove-item|git\s+(checkout|restore|rm|mv))\b/i;
  if (writes.test(s)) return mentionsProtected(s) || null;
  return null;
}

export function check(command, ctx = {}) {
  let ask = null;
  for (const seg of segments(String(command || ''))) {
    for (const rule of RULES) {
      if (rule.test(seg, ctx)) {
        if (rule.decision === 'deny') return { decision: 'deny', reason: `${rule.reason}: \`${seg}\`` };
        ask ??= { decision: 'ask', reason: `${rule.reason}: \`${seg}\`` };
      }
    }
    const target = protectedWrite(seg);
    if (target) return { decision: 'deny', reason: `changing guardrail file ${target} needs the user, not the agent: \`${seg}\`` };
  }
  return ask || { decision: 'allow', reason: '' };
}
