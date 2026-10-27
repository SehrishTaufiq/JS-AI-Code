# retro

Retrospectives on the factory itself: what went wrong while working tickets, grouped by cause,
with one minimal edit to `factory-loop/SKILL.md` or `CLAUDE.md` per cause for the user to pick.

## How to run

Nothing to run. A retro is written from evidence: `/skill-doctor`, `/doctor prompt-audit .`,
the `/insights` report, the tickets, the git log, the prompt log (`prompt-log` branch) and the
failure traces (`.claude/logs/failure-traces/`, local).

## How to test

`node --test .claude/tests/repo-rules.test.mjs` checks this folder has a README and an index row.
Check a retro by following its links: every item must point at its source.

## Files

| File | What it is |
|---|---|
| `YYYY-MM-DD.md` | One retro: sources, baseline, causes with edits E1…, doc fixes D1…, what needs the user |
| `evidence/YYYY-MM-DD/` | Raw audit output the retro links to (skill-doctor before/after, prompt audit) |
