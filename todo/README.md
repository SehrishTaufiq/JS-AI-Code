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
- **Filters**: All / Incomplete / Completed, plus a tag dropdown listing every tag in
  use. Filters combine. Clicking a tag chip on a task filters by that tag. If the
  filtered tag disappears (its last task is deleted), the tag filter resets to all.

## Files

| File | Role |
|---|---|
| `index.html` | Page markup; loads the three scripts in order |
| `styles.css` | Styles, light and dark |
| `tasks.js` | Pure task logic (create, tags, due dates, filter, sort). Shared with tests |
| `db.js` | IndexedDB wrapper: database `todo-app`, store `tasks`, keyed by `id` |
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
}
```

Tasks saved before due dates and tags existed are upgraded on load by
`Tasks.normalizeTask` (missing fields become `null` / `[]`); no DB migration needed.
