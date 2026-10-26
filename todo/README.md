# todo

A simple browser todo app. Tasks are stored client-side in **IndexedDB**, so they
survive page reloads and browser restarts. No server and no build step.

## Run

Open `index.html` in a browser (double-click it, or `file:///…/todo/index.html`).

## Test

```sh
cd todo
npm test        # Node's built-in test runner, no dependencies
```

Unit tests cover the pure task logic in `tasks.js`. Storage and UI are checked in a
real browser: add, toggle, delete, reload to confirm persistence.

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

## Files

| File | Role |
|---|---|
| `index.html` | Page markup; loads the three scripts in order |
| `styles.css` | Styles, light and dark |
| `tasks.js` | Pure task logic (create, tags, due dates, repeats, filter, sort). Shared with tests |
| `db.js` | IndexedDB wrapper: database `todo-app`, store `tasks`, keyed by `id`; `putAll` for atomic multi-writes |
| `app.js` | UI wiring: events, rendering, error display |
| `tests/` | `node:test` unit tests for `tasks.js` |

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
