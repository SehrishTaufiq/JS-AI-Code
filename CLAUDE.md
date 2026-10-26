# Software Factory

This repo is a **software factory**: tickets arrive as GitHub issues (`Ticket #N`),
an agent picks each one up, builds it, and pushes the result to `main`.
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

1. Read the issue: `Ticket #N` on GitHub.
2. Find the project in the index (or create a new folder + README + index row).
3. Build the change. Add or update tests where the project has them.
4. Run the project's tests and check the result in a browser for UI work.
5. Commit with `Closes #N` in the message and push to `main`.

## Project index

| Folder | What it is | Tickets | Details |
|---|---|---|---|
| [`research/`](research/README.md) | Answers to question tickets, with sources | #1 | [README](research/README.md) |
