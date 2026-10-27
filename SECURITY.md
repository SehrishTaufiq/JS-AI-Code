# Security

This repo is a **public** software factory: GitHub issues become work that an AI agent builds,
commits and opens PRs for. The main risks follow from that: anyone can write an issue or a PR
comment, that text reaches an agent that runs commands, and everything pushed is public.

## The hardening loop

Each layer assumes the one before it failed.

```
 ticket / PR comment arrives
 1. GATE     author allowlisted?                 no  -> skipped, reported
 2. SCREEN   injection or malicious request?     yes -> BLOCK: reported / REVIEW: ask the user
 3. CONTAIN  guard hook, deny rules, locked guardrail files, least-privilege token
 4. VERIFY   security-reviewer on the diff, tests, CI (screen, audit), secret filter
 5. HUMAN    PR review + branch protection; the agent never merges
 6. LEARN    every attack -> red-team case, guard test row, mutant  -> back to 1
```

## Threats and controls

| Threat | Control | Where |
|---|---|---|
| A stranger's issue tells the agent to do something harmful (prompt injection) | Only tickets from allowlisted authors are built; others show as `skipped (untrusted author)` | `.claude/factory.json`, `fetch-tickets.mjs` |
| A trusted-looking ticket or PR comment hides instructions (HTML comments, invisible characters, base64, fake `SYSTEM:` lines, "ignore previous instructions", requests for secrets, guardrail changes, `curl \| sh`) | **Ticket screen**: rule-based SAFE/REVIEW/BLOCK before the agent acts; `security-reviewer` ticket mode for intent; the loop reports BLOCK and asks on REVIEW. A repo writer can clear a false alarm with the label `screen-approved` | `.claude/skills/ticket-screen/`, factory-loop Step 2b (+ `fetch-tickets.mjs` after the patch) |
| Strangers steer the agent through PR comments | After the patch: only comments from allowlisted authors count as feedback; each is screened, BLOCKed ones are withheld | `fetch-tickets.mjs`, `github.mjs pr-feedback` |
| Hostile text arrives through a tool (GitHub plugin, web fetch, `curl`) | After the patch: a PostToolUse hook screens that output and warns the agent in context to treat it as data | `.claude/hooks/screen-tool-output.mjs` |
| Agent runs a destructive command (force-push, `rm -rf`, `reset --hard`, deleting branches/issues) | PreToolUse guard reads every Bash/PowerShell command, including variants prefix rules miss; plus deny rules. After the patch also: quoted refs, `HEAD` on main, `--mirror/--all/--prune`, abbreviated options, git by path, `-c`/alias/hook config, `cd` + write, perl/python/.NET writes, piped and .NET deletes, GraphQL mutations | `.claude/hooks/guard.mjs`, `guard-rules.mjs`, `.claude/settings.json` |
| Agent weakens its own guardrails | Edit/Write deny rules and the guard block changes to settings, hooks, factory scripts, `factory.json`, `.gitignore`, `.mcp.json`, CI workflows (after the patch also agents, the factory-loop skill, the ticket screen, CODEOWNERS). Only you change them | `.claude/settings.json` |
| The GitHub plugin merges or pushes directly | After the patch: its merge/update/push/delete/workflow tools are denied; creating PRs and comments asks first | `.claude/settings.json` |
| Work reaches `main` without review | Every ticket goes through a PR; the agent cannot push to `main`, merge PRs or close issues | skill, guard, deny rules; branch protection (below) |
| A secret gets committed | Auto-commit leaves out files that look like secrets by name **or content** (GitHub/OpenAI/Anthropic/AWS/Slack tokens, JWTs, private keys, credentials in URLs; after the patch also Google, npm, Stripe live, Azure, GitLab, Hugging Face) | `.claude/hooks/auto-commit.mjs`, `secrets.mjs` |
| A secret pasted in a prompt is published | The prompt log masks token-like strings before writing; it lives on the public `prompt-log` branch | `.claude/hooks/log-prompts.mjs` |
| XSS in the todo app | User text rendered with `textContent` only; Content-Security-Policy blocks inline/injected scripts; e2e test checks both | `todo/index.html`, `todo/e2e/` |
| Unsafe code or a bad dependency slips into a PR | `security-reviewer` reviews each PR; `security-guidance`, `claude-security` and `semgrep` plugins; CI runs all tests, `npm audit`, and screens the PR text. After the patch, actions are pinned to commit SHAs and checkout keeps no credentials | `.claude/agents/`, `.github/workflows/test.yml` |

## Apply the hardening patch (locked files, so it's yours to apply)

`.claude/patches/security-tightening.patch` changes the locked guardrail files (13 files: guard,
secrets, the new tool-output hook, settings, fetch-tickets, github.mjs, CI, and their tests).
It was built and tested in a throwaway clone: all 256 factory tests pass with it.

```sh
git apply --check .claude/patches/security-tightening.patch   # dry run
git apply .claude/patches/security-tightening.patch
node --test ".claude/tests/*.test.mjs"                        # should be all green
```

Then restart Claude Code so the new settings and hooks load. Read the diff first: it is a change
to the factory's guardrails, so review it like code.

## Things only you can set up

1. **A fine-grained GitHub token** (github.com → Settings → Developer settings → Fine-grained
   tokens): *Only select repositories* → this repo; permissions **Contents: Read and write**,
   **Pull requests: Read and write**, **Issues: Read and write**, **Metadata: Read**. Nothing else,
   no admin. Expiry 30 days or less. Put it in an environment variable, never in a file:
   `GITHUB_PERSONAL_ACCESS_TOKEN` (read by the GitHub MCP plugin and by the factory scripts;
   `GITHUB_TOKEN` also works for the scripts).
2. **Branch protection on `main`** (Settings → Branches → Add rule, or a ruleset): require a pull
   request before merging, require the `tests` workflow checks to pass, block force pushes and
   deletions, and require review from code owners. This makes "never push to main" a server-side
   rule, not just a local one.
3. **CODEOWNERS** so guardrail changes always need your review. Create `.github/CODEOWNERS` with
   a reviewer who has write access to the repo:
   ```
   /.claude/          @<reviewer>
   /.github/          @<reviewer>
   /SECURITY.md       @<reviewer>
   ```
4. **Semgrep CLI** for the semgrep plugin: it needs Python (`pip install semgrep`) or WSL/Docker on
   Windows. Without it the plugin has nothing to run; drop it from `enabledPlugins` if you don't
   install it.
5. **Optional: Claude Code's sandbox** (`/sandbox`) for OS-level limits on what commands can touch.
   It is the only control that covers a script the agent writes and then runs. It is not enabled by
   default here because on native Windows it can block git and network access the factory needs.
6. **Changing the guardrails** (allowlist, deny rules, hooks): edit the files yourself; the agent is
   blocked from doing it. Review such changes as carefully as code.

## What this does not cover

- The screen and the guard read text; a determined attacker can word around rules. They make
  attacks visible and expensive; branch protection, the token's limits, review and the sandbox are
  what hold when they miss.
- A script file the agent writes and then runs is not inspected by the guard.
- A compromised allowlisted account passes the gate; the screen and review still apply.

## Reporting a problem

This is a training repo. If you find a way around these controls, open an issue (titled
"Security: …") or tell the workshop instructor directly. Don't include working exploit steps or
real secrets in a public issue.
