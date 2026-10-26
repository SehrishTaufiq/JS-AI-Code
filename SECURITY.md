# Security

This repo is a **public** software factory: GitHub issues become work that an AI agent builds,
commits and opens PRs for. The main risks follow from that: anyone can write an issue, the agent
runs commands, and everything pushed is public.

## Threats and controls

| Threat | Control | Where |
|---|---|---|
| A stranger's issue tells the agent to do something harmful (prompt injection) | Only tickets from allowlisted authors are built; others show as `skipped (untrusted author)` | `.claude/factory.json`, `fetch-tickets.mjs` |
| Agent runs a destructive command (force-push, `rm -rf`, `reset --hard`, deleting branches/issues) | PreToolUse guard reads every Bash/PowerShell command, including variants prefix rules miss (`--force-with-lease`, `+refspec`, `git -C`, `find -delete`, `node -e rmSync`); plus deny rules | `.claude/hooks/guard.mjs`, `guard-rules.mjs`, `.claude/settings.json` |
| Agent weakens its own guardrails | Edit/Write deny rules and the guard block changes to settings, hooks, factory scripts, `factory.json`, `.gitignore`, `.mcp.json`, CI workflows. Only you change them | `.claude/settings.json` |
| Work reaches `main` without review | Every ticket goes through a PR; the agent cannot push to `main`, merge PRs or close issues | skill, guard, deny rules; branch protection (below) |
| A secret gets committed | Auto-commit leaves out files that look like secrets by name **or content** (GitHub/OpenAI/Anthropic/AWS/Slack tokens, JWTs, private keys, credentials in URLs) | `.claude/hooks/auto-commit.mjs`, `secrets.mjs` |
| A secret pasted in a prompt is published | The prompt log masks token-like strings before writing; it lives on the public `prompt-log` branch | `.claude/hooks/log-prompts.mjs` |
| XSS in the todo app | User text rendered with `textContent` only; Content-Security-Policy blocks inline/injected scripts; e2e test checks both | `todo/index.html`, `todo/e2e/` |
| Unsafe code slips into a PR | `security-reviewer` subagent reviews each PR before it opens; `security-guidance` plugin warns on edits; CI runs all tests | `.claude/agents/`, `.github/workflows/test.yml` |

## Things only you can set up

1. **A fine-grained GitHub token** (github.com → Settings → Developer settings → Fine-grained
   tokens): *Only select repositories* → this repo; permissions **Contents: Read and write**,
   **Pull requests: Read and write**, **Issues: Read and write**, **Metadata: Read**. Nothing else,
   no admin. Expiry 30 days or less. Put it in an environment variable, never in a file:
   `GITHUB_PERSONAL_ACCESS_TOKEN` (read by the GitHub MCP plugin and by the factory scripts;
   `GITHUB_TOKEN` also works for the scripts).
2. **Branch protection on `main`** (Settings → Branches → Add rule, or a ruleset): require a pull
   request before merging, require the `tests` workflow checks (*Factory hooks and scripts* and
   *Todo app (unit + Playwright)*) to pass, block force pushes and deletions. This makes "never
   push to main" a server-side rule, not just a local one.
3. **Optional: Claude Code's sandbox** (`/sandbox`) for OS-level limits on what commands can touch.
   It is not enabled by default here because on native Windows it can block git and network access
   the factory needs; try it and keep it if the loop still works.
4. **Changing the guardrails** (allowlist, deny rules, hooks): edit the files yourself; the agent is
   blocked from doing it. Review such changes as carefully as code.

## Reporting a problem

This is a training repo. If you find a way around these controls, open an issue (titled
"Security: …") or tell the workshop instructor directly. Don't include working exploit steps or
real secrets in a public issue.
