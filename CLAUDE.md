# Software Factory

This repo is a **software factory**: tickets arrive as GitHub issues (`Ticket #N`),
an agent picks each one up, builds it on a branch and opens a PR; a human reviews and merges to `main`.
We improve the factory (this file, conventions, checks); the factory builds the features.

## Progressive disclosure

Keep context small. Load only what the current ticket needs:

1. **This file** is the entry point and the index. Read it first, always.
2. **A project's own `README.md`** holds its details (how to run, structure, decisions).
   Open it only when a ticket touches that project.
3. **Source files** come last, and only the ones the change needs.

Never copy project details up into this file. Link to them from the index instead.

## Rules

- **One project per folder** at the repo root (e.g. `todo/`). Nothing project-specific at the root.
- **Every project folder has a `README.md`** covering: purpose, how to run, how to test, file map.
- **Update the index below** whenever a project is added, renamed, or removed, in the same commit.
- **This file stays under 100 lines.** If an edit would push it over, move detail into a
  project README and leave a one-line link here.
- No real keys, secrets, or Jonas/Contour code. Training repo only.

## Ticket workflow

Run it with the **`factory-loop`** skill ([`.claude/skills/factory-loop/`](.claude/skills/factory-loop/SKILL.md)).
Every ticket ends as committed files, never only a chat answer, and nothing destructive.

1. Read the issue: `Ticket #N` on GitHub. Work on a branch `ticket/<N>-<slug>`, never on `main`.
2. Building a project or feature? Ask clarifying questions, then get the plan approved first.
3. Build in the project's folder (or a new folder + README + index row), with unit and
   Playwright tests (`e2e-test` skill).
4. Verify: `qa-tester` subagent runs the tests and checks the UI in Chrome DevTools, with
   screenshots in `<project>/docs/screenshots/ticket-<N>/`; `security-reviewer` checks the diff.
5. Push the branch and open a PR (`Closes #N`, screenshots); comment on the ticket with them.
6. A human reviews and merges. The loop never merges PRs or closes issues.

Only tickets from authors in `.claude/factory.json` are built (the repo is public).

## Automation and security (`.claude/`, see [SECURITY.md](SECURITY.md))

- **Hooks** ([`.claude/settings.json`](.claude/settings.json)): a *PreToolUse guard* blocks destructive
  shell commands and writes to guardrail files; *PostToolUse* runs the related tests after edits;
  on *Stop*, prompts (secrets masked) go to the `prompt-log` branch and the ticket branch is
  committed and pushed (never on `main`, never forced).
- **Guardrail files** (settings, hooks, factory scripts, `factory.json`, `.gitignore`, CI) can only
  be changed by the user.
- **Plugins**: chrome-devtools-mcp, github, security-guidance, pr-review-toolkit.
- **Tests**: `node --test ".claude/tests/*.test.mjs"` (factory); `cd todo && npm run test:all` (app). CI runs both.
- **Evals** ([EVALS.md](EVALS.md)): mutation testing and a requirements matrix check the tests;
  scenario and trigger evals check the AI follows the loop. Add a case whenever it gets something wrong.

## Project index

| Folder | What it is | Tickets | Details |
|---|---|---|---|
| [`research/`](research/README.md) | Answers to question tickets, with sources | #1 | [README](research/README.md) |
| [`todo/`](todo/README.md) | Browser todo app: IndexedDB storage, filters, due dates, tags, recurring tasks | #3, #4, #5 | [README](todo/README.md) |
