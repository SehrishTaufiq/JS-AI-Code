# Fixes per failure group (2026-10-27)

Audit of the 463 failures / 214 distinct issues in `REPORT.md`, one group at a time. Issue ids are
stable (`I-xxxxxx`, see `issues.json`).

**Check whether a group comes back:** after a few sessions, run
`node .claude/logs/failure-traces/collect.mjs . --since 2026-10-28` and compare its `REPORT.md`
(written to `since-2026-10-28/`) with this table.

| # | Group | × | Root cause | Fix | Where | Status |
|---|---|---|---|---|---|---|
| 1 | Python missing (I-6da9c2, I-d9778d) | 19 | Only the Microsoft Store stub `python.exe`; hookify runs `python3` on **every** tool call and at stop, so it failed silently all the time | Installed Python 3.12.10 (winget, user scope; PATH puts it ahead of the stub); added `python3.exe` next to `python.exe` because hookify calls `python3`. Verified: `python3 --version` → 3.12.10 with the real PATH order; hookify's three hooks exit 0 | your PC | **Fixed** (new sessions) |
| 2 | Page element not found (I-5fac71 ×22, I-372190 ×11, I-ff3081 ×10) | 45 | `evaluate_script` doing `querySelector(...).click()` before the element exists; clicking while the page still loads | User-level hook `~/.claude/hooks/browser-guard.mjs` rejects un-null-checked element calls in `evaluate_script` and says how to write them (self-test + pipe tests pass); rules in `~/.claude/CLAUDE.md`: snapshot + click by uid, wait first, null-check | `~/.claude` | **Fixed** (hook + rule) |
| 3 | Browser session (I-6d2814, I-9f1a42, I-b63d87, stale uids) | 29 | Second DevTools session on the same profile; page navigated or reconnected; stale uids | Same hook adds the right recovery step after a browser-tool failure (isolated context / re-snapshot / wait for the new page) instead of blind retries; rules | `~/.claude` | **Fixed** (advice + rule) |
| 4 | Script / quoting errors (I-4c5241, I-897610, I-896d7a, sed, PowerShell) | 46 | Long inline `node -e` / `sed` / `Invoke-Expression` one-liners breaking on quotes | Rule: anything multi-line or with nested quotes goes in a temp script file | `~/.claude/CLAUDE.md` | **Rule** |
| 5 | Edit precondition (I-27ee74 ×12, I-5c8d30) | 20 | Editing from memory or after a hook/formatter changed the file | Rule: Read before editing; on mismatch Read again and copy exact text | `~/.claude/CLAUDE.md` | **Rule** |
| 6 | Invalid tool input | 8 | `AskUserQuestion` with <2 options; wrong MCP argument shapes | Rule | `~/.claude/CLAUDE.md` | **Rule** |
| 7 | Limits (I-01222c session limit ×22, I-88a805, I-56aa35, I-dd3c8d) | 37 | Whole reports read into context; ~24 parallel agents | Rule: grep/jq first, Read with offset; ≤5 agents per wave, each saves results before the next | `~/.claude/CLAUDE.md` | **Rule** |
| 8 | Paths not found | 27 | Windows backslashes eaten by Bash; unquoted paths with spaces | Rule: forward slashes + quotes | `~/.claude/CLAUDE.md` | **Rule** |
| 9 | Timeouts | 27 | Long runs in the foreground; `sleep` polling | Rule: `run_in_background` + explicit timeouts, no sleep | `~/.claude/CLAUDE.md` | **Rule** |
| 10 | Git Bash crash, Grep/Glob `uv_spawn` (I-43d1b0, I-1bb5ee) | 13 | Windows process start-up failures (Git Bash heap, ripgrep spawn) | Rule: retry once, then PowerShell / `grep` via Bash; don't loop | `~/.claude/CLAUDE.md` | **Workaround** (not fixable from here) |
| 11 | GitHub 403 | 13 | Work account is a read-only Enterprise Managed User | Rule: check permissions before any write; factory: `github.mjs access` runs before the first push (exit 4 = will be refused) | `~/.claude/CLAUDE.md` + patch | **Rule now; script in patch** |
| 12 | `.git/` writes denied (drafts) | 4 | Claude Code refuses tool writes inside `.git/` | `github.mjs draft --name … < text` saves drafts; skill updated to use it | patch | **In patch** (apply it) |
| 13 | Missing agent type ×5 | 5 | Agents in `.claude/agents/` load only at session start | Rule: fall back to a general-purpose agent with the file's instructions, ask for a restart | `~/.claude/CLAUDE.md` | **Rule** |
| 14 | Auto mode denials | 24 | Mostly correct calls (credentials, shared resources, irreversible deletes) | None needed; `/auto-mode-setup` teaches it your environment | — | **Expected** |
| 15 | Network (ENOTFOUND ×25), login expired | 28 | Connection drops, DNS, expired login | None (external) | — | **External** |
| 16 | Guard blocks, Claude Code blocks, user rejections | 25 | The controls working (one guard false positive is fixed in the patch) | — | — | **Expected** |
| 17 | "Exited non-zero" | 43 | Mostly diagnostics (`grep` with no match, report scripts) | None | — | **Not bugs** |
| 18 | Session friction: misunderstood request ×17 | 17 | Short multi-part prompts read one way | Rule: restate the interpretation in one line; `git fetch` before audits | `~/.claude/CLAUDE.md` | **Rule** |
