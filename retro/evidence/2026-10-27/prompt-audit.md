# Prompt audit: `D:\contour-jonas-oct-2026-qa-sehrish-lodhi`

**The surface is mostly in good shape.** I found five medium-confidence problems worth fixing, all small, and four low-confidence items to flag. Nothing is high confidence, and I applied no edits.

**Assumptions**
- **Scope:** the repo's prompt surface. That is `CLAUDE.md`, the three skills (`factory-loop` with its `references/browser-qa.md`, `ticket-screen`, `e2e-test`), the two subagents (`qa-tester`, `security-reviewer`), and the two docs `CLAUDE.md` links to (`SECURITY.md`, `EVALS.md`). The eval runners count as request-building code.
- **Skipped:**
  - Your user-level `~/.claude/CLAUDE.md`, because it's outside the project and you didn't name it. An edit there would affect every project.
  - `.claude/settings*.json` and `.mcp.json`, which I didn't read because they can hold secrets.
- **Target model:** Claude Opus 5.5 (`claude-opus-5-5`), for every file. It's the model running Claude Code here, no skill or agent pins another model, and the eval runners default to it.
- **Provenance:** I wasn't allowed to run `git blame` or `git log`. Line ages come only from the repo's contents, and any conflict whose order history would settle is flagged rather than fixed.
- **No non-Anthropic provider markers** were found.

## Summary

The files are written at a normal volume. Every bolded "never" or "don't" comes with a reason or protects a destructive operation, so they stay. What I did find is mostly one Group 2 problem: copies of the same facts that have started to disagree.

1. **The browser QA reference disagrees with itself and with `qa-tester`.** One line says to take a single screenshot at the end. The same file, `qa-tester` and `CLAUDE.md` all ask for the full set of screenshots the plan lists.
2. **`qa-tester` says it "never edits source code", but nothing enforces that.** Without a `tools` line it gets every tool, including Edit and Write.
3. **The guardrail list in `CLAUDE.md` leaves out `.mcp.json`.** The guard, the skill and `SECURITY.md` all include it.

| Group | Findings |
|---|---|
| 1. Dated prompt text | 1 (an instruction nothing enforces). No over-emphasis, no reasoning scaffolds. |
| 2. Skill and config files | 4 proposed, 3 flagged |
| 3. Tool descriptions | No API tool definitions, so not applicable. 1 low-confidence flag on skill descriptions. |
| 4. Request config | Not applicable: there's no Messages API code. The eval runners pin `claude-opus-5-5`, which is current. The two subagents don't overlap. |

**What I checked and found correct:**
- Every command and flag the files name exists: the `github.mjs` subcommands, the `screen.mjs` flags, the `fetch-tickets` action strings, the npm scripts, the Playwright projects (`tz-auckland`, `tz-sao-paulo`, `mobile`), `Tasks.toDateString`, `allowConsole`, the hook files, the `prompt-log` branch and the CI jobs.
- The `factory-loop` description is long, but it is tuned against the trigger eval (18/18 in `EVALS.md:55`), so it stays.
- The line saying the loop replaces the brainstorming skill (`factory-loop/SKILL.md:25`) does real work against the superpowers session hook, so it stays.

## Findings

| # | Location | Evidence | Pattern | Why it no longer fits | Conf. | Action |
|---|---|---|---|---|---|---|
| 1 | `.claude/skills/factory-loop/references/browser-qa.md:15-16` | "Prefer `take_snapshot` … over screenshots for checking state; take one screenshot at the end to check the layout." | G2: instruction files that contradict each other | Lines 20-30 of the same file, `qa-tester.md:23-25` and `CLAUDE.md:36-37` all require the plan's full screenshot set. I'm assuming the screenshot section is the newer rule, since three places agree on it. | Medium | rewrite (hunk 1) |
| 2 | `browser-qa.md:13` vs `:31` vs `qa-tester.md:19` | Context name examples: `factory-qa` (shared), then `ticket-<N>` (one per ticket), then `qa-ticket-<N>` | G2: copies that drifted apart | The first example suggests one shared browser context. Line 31 and `qa-tester` say to use a fresh one per ticket so screenshots show only that ticket's data. | Medium | rewrite to `qa-ticket-<N>` (hunk 2) |
| 3 | `CLAUDE.md:51` | "Guardrail files (settings, hooks, factory scripts, `factory.json`, `.gitignore`, CI)" | G2: stale specifics | `guard-rules.mjs:14`, `factory-loop/SKILL.md:38` and `SECURITY.md:30` also protect `.mcp.json`. This change makes the rule stricter, not looser. | Medium | rewrite (hunk 3) |
| 4 | `.claude/skills/factory-loop/SKILL.md:45-47` | "Step 1: Read the factory rules / Read `CLAUDE.md` (conventions, project index)." | G2: telling the model what it already has | Claude Code loads the root `CLAUDE.md` into context automatically. The eval sandbox loads it too (`sandbox.mjs:69` uses `--setting-sources project,local`). Reading it again spends a tool call. The precedence rule that follows is the part that matters, and it stays. | Medium | rewrite (hunk 4) |
| 5 | `.claude/agents/qa-tester.md:1-4, 7` | No `tools:` line, but the body says "**Do not edit source code or tests.**" | G1d: instruction nothing enforces | A rule that could be a tool restriction is more reliable as one than as prose. The agent saves screenshots through `take_screenshot`, so it never needs Edit or Write. | Medium | add `disallowedTools` (hunk 5). Check the field against your Claude Code version's subagent docs. |
| 6 | `CLAUDE.md:53` vs `SECURITY.md:36, 72-74` | `CLAUDE.md` lists the plugins as "chrome-devtools-mcp, github, security-guidance, pr-review-toolkit". `SECURITY.md` names the `claude-security` and `semgrep` plugins and talks about `enabledPlugins`. | G2: conflict | Which list is current is recorded in `settings.json`, which I didn't read, and history wasn't available to order them. You need to decide which list is right. | Low | flag |
| 7 | `factory-loop/SKILL.md:37-39`, `security-reviewer.md:44-46`, `ticket-screen/SKILL.md:41-42`, `CLAUDE.md:51` | Guardrail lists; "then fix the rule in `scripts/screen.mjs`" | G2: will go stale | These are correct today. Once you apply `.claude/patches/security-tightening.patch`, it also locks `.claude/skills/ticket-screen/`, the agents, the `factory-loop` skill and CODEOWNERS (`SECURITY.md:30`). The patch doesn't touch these files, so they'd then list the wrong files and tell the agent to edit a file it can no longer change. Update them in the same commit as the patch. | Low | flag |
| 8 | `factory-loop/SKILL.md:64, 122, 197, 203` | Drafts and notes go in `.git/factory-loop/` | G1d: known failure | `EVALS.md:68` reports that unattended (`/loop` and headless) runs can't write under `.git/`. The fix belongs in `lib.mjs` and `.gitignore`, which only you can change, and the skill text should follow that fix, not lead it. | Low | flag |
| 9 | `e2e-test/SKILL.md:3`, `ticket-screen/SKILL.md:3` | Quoted example requests in the descriptions | G2/G3: listing trigger phrases | Unlike `factory-loop`'s, these descriptions have no trigger eval. They're short, so this is a heuristic only. | Low | flag |

Separate from the audit: in `EVALS.md:51-57`, the footnote sits in the middle of the Results table. The last three rows (Triggers, Red team: screen, Red team: agent) therefore display as plain text instead of table rows.

## Proposed diff

Nothing has been applied. Hunks 1-4 come from Group 2 conflict and stale-fact findings, so they're for you to confirm. Take any of them separately.

```diff
# Hunk 1: finding 1
--- a/.claude/skills/factory-loop/references/browser-qa.md
+++ b/.claude/skills/factory-loop/references/browser-qa.md
@@ -15,2 +15,2 @@
-- Prefer `take_snapshot` (accessibility tree) over screenshots for checking state; take one
-  screenshot at the end to check the layout.
+- Check state with `take_snapshot` (accessibility tree), not screenshots. Screenshots are the
+  evidence set described below.
```

```diff
# Hunk 2: finding 2
--- a/.claude/skills/factory-loop/references/browser-qa.md
+++ b/.claude/skills/factory-loop/references/browser-qa.md
@@ -12,2 +12,2 @@
 - Open the page with `new_page` at `file:///<absolute path>/index.html` and an `isolatedContext`
-  name (e.g. `factory-qa`). That gives clean storage that does not touch the user's own browser
+  name (e.g. `qa-ticket-<N>`). That gives clean storage that does not touch the user's own browser
@@ -31,2 +31,2 @@
-- Use a fresh `isolatedContext` per ticket (e.g. `ticket-<N>`) so the screenshots show only this
+- Use a fresh `isolatedContext` per ticket (e.g. `qa-ticket-<N>`) so the screenshots show only this
   ticket's test data.
```

```diff
# Hunk 3: finding 3
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -51,2 +51,2 @@
-- **Guardrail files** (settings, hooks, factory scripts, `factory.json`, `.gitignore`, CI) can only
-  be changed by the user.
+- **Guardrail files** (settings, hooks, factory scripts, `factory.json`, `.mcp.json`, `.gitignore`,
+  CI) can only be changed by the user.
```

```diff
# Hunk 4: finding 4
--- a/.claude/skills/factory-loop/SKILL.md
+++ b/.claude/skills/factory-loop/SKILL.md
@@ -45,5 +45,5 @@
-## Step 1: Read the factory rules
+## Step 1: The factory rules
 
-Read `CLAUDE.md` (conventions, project index). Where it and this skill disagree, CLAUDE.md wins,
-except the review gates in rule 2 (PR per ticket; never merge, close, or push to `main`), which
-always apply.
+`CLAUDE.md` (conventions, project index) is already in context. Where it and this skill disagree,
+CLAUDE.md wins, except the review gates in rule 2 (PR per ticket; never merge, close, or push to
+`main`), which always apply.
```

```diff
# Hunk 5: finding 5
--- a/.claude/agents/qa-tester.md
+++ b/.claude/agents/qa-tester.md
@@ -3,2 +3,3 @@
 description: Independent QA of a built ticket before its PR is opened. ...
+disallowedTools: Edit, Write, NotebookEdit
 ---
```

I searched the whole repo for the strings these hunks change. Nothing depends on them: `repo-rules.test.mjs` checks only `CLAUDE.md`'s line count and its factory/progressive-disclosure wording, and hunk 3 keeps the file at 64 lines.

**Checking the changes:** hunks 1-4 are text fixes; after applying them, re-read the files. For hunk 5, start `qa-tester` once and confirm it can still run `npm test`, use the Chrome DevTools tools and save screenshots. Then re-run the scenario evals (`run-scenarios.mjs --only 1,3`), since they cover the QA step. Those runs cost money and need the reinstalled `claude.exe` mentioned in `EVALS.md:57`.
