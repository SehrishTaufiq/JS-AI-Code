# todo

A simple browser todo app. Tasks are stored client-side in **IndexedDB**, so they
survive page reloads and browser restarts. No server and no build step.

## Run

Open `index.html` in a browser (double-click it, or `file:///…/todo/index.html`).

## Test

```sh
cd todo
npm ci            # once: installs @playwright/test (pinned); no browser download
npm test          # unit tests: node's built-in runner, pure logic in tasks.js
npm run test:e2e  # Playwright browser tests in e2e/, using your installed Chrome
npm run test:all  # both
```

**Unit tests** (`tests/`) cover the pure task logic: parsing, dates (including impossible
dates, leap years, month ends), recurrence, filtering, and upgrading old or junk records.

**Browser tests** (`e2e/`, see the `e2e-test` skill) drive the real page over `file://`. They
cover every feature and persistence after reload, plus:
- HTML injection shown as text, and the Content-Security-Policy blocking injected scripts;
- old stored records loading; two open tabs staying in sync; no IndexedDB available; a newer
  version opened in another tab;
- keyboard-only use and accessible names;
- phone width (390px).

Date tests (`@dates`) run with a fixed clock in UTC, Auckland (UTC+13) and São Paulo (UTC−3).
CI runs both suites on every PR.

## Features

- Create a task (Enter or **Add**). Empty or whitespace-only titles are ignored.
- Mark a task done or not done with its checkbox.
- Delete a task.
- **Due date** (optional). Shown on the task; incomplete tasks past their date are
  marked *overdue* in red. A task due today shows "Due today".
- **Tags** (optional), comma-separated: `work, #urgent`. Tags are trimmed, lowercased,
  a leading `#` is dropped, and duplicates are removed.
- **Recurring tasks** (optional): repeat daily, weekly or monthly. A repeating task with no due
  date starts today. Ticking it off marks it done and creates the next occurrence (same title,
  tags and repeat), saved in one IndexedDB transaction. If the task was overdue, the next date
  skips ahead to today or later. Monthly repeats keep their day of month: the 31st becomes
  Feb 28 or 29, then the 31st again in March. Unticking and re-ticking does not create a second
  copy. To stop a series, delete its open occurrence.
- **Filters**: All / Incomplete / Completed, plus a tag dropdown listing every tag in
  use. Filters combine. Clicking a tag chip on a task filters by that tag. If the
  filtered tag disappears (its last task is deleted), the tag filter resets to all.
- **Several tabs**: a change in one open tab shows up in the others (`BroadcastChannel`).
  If another tab upgrades the database, or storage is unavailable (e.g. private browsing),
  the page says so and disables editing, so changes are never silently lost.
- **Keyboard and screen readers**: every control has a label; focus stays on the control you
  used when the list re-renders.

## Security

- User text is only ever rendered with `textContent`, never as HTML.
- A Content-Security-Policy (`index.html`) allows only the app's own files, so injected inline
  scripts don't run.

## Files

| File | Role |
|---|---|
| `index.html` | Page markup and CSP; loads the three scripts in order |
| `styles.css` | Styles, light and dark |
| `tasks.js` | Pure task logic (create, tags, due dates, repeats, filter, sort). Shared with tests |
| `db.js` | IndexedDB wrapper: database `todo-app`, store `tasks`, keyed by `id`; `putAll` for atomic multi-writes; reports lost connections |
| `app.js` | UI wiring: events, rendering, focus restore, cross-tab sync, error display |
| `tests/` | `node:test` unit tests for `tasks.js` |
| `e2e/`, `playwright.config.mjs` | Playwright browser tests and their config (time-zone and phone projects) |
| `docs/screenshots/ticket-<N>/` | Screenshots attached to each ticket's PR |

## Task shape

```js
{
  id: string,
  title: string,
  done: boolean,
  createdAt: number,          // ms timestamp; list order
  dueDate: string | null,     // "YYYY-MM-DD"
  tags: string[],             // lowercase, unique
  repeat: "daily" | "weekly" | "monthly" | null,  // needs a dueDate
  repeatDay: number | null,   // monthly only: day of month to return to
  nextId: string | null,      // id of the occurrence this one spawned, if any
}
```

Tasks saved by older versions (before due dates, tags or repeats existed) are upgraded on
load by `Tasks.normalizeTask` (missing fields become `null` / `[]`); no DB migration needed.
