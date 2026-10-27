# Browser QA for UI tickets

Read this when a ticket changes something a person uses in a browser. The aim is to check what the
ticket asked for in a real browser, the way a user would, before calling it done.

## Setup

- Use the Chrome DevTools MCP tools (`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`). If they
  are deferred, load them with ToolSearch first. Prefer them over claude-in-chrome. That one drives
  the user's real browser profile, so test data would land in their own storage. If it is the
  only option, use a fresh tab and delete only the test records you created.
- Open the page with `new_page` at `file:///<absolute path>/index.html` and an `isolatedContext`
  name (e.g. `qa-ticket-<N>`). That gives clean storage that does not touch the user's own browser
  profile, and the data survives reloads within that context, which you need for persistence checks.
- Check state with `take_snapshot` (accessibility tree), not screenshots. Screenshots are the
  evidence set described below.

## Screenshots (attached to the PR and the ticket)

The approved plan lists the screenshots. They are evidence for the reviewer, so each one should
show a single checklist item in a state that makes the result obvious.

- Use a fixed viewport so screenshots line up: `resize_page` to 1280×800 before the first shot.
- Save straight into the repo:
  `take_screenshot` with `filePath: <project>/docs/screenshots/ticket-<N>/<NN>-<what>.png`, e.g.
  `01-empty-state.png`, `02-weekly-task-created.png`, `03-next-occurrence-after-tick.png`. The
  number gives the order; the rest becomes the caption.
- Use `fullPage: true` when the list is longer than the viewport.
- Typical set: the starting state, each feature from the ticket in action, one edge case
  (no-match filter, validation), and the final state after a reload (to show it persisted).
- Use a fresh `isolatedContext` per ticket (e.g. `qa-ticket-<N>`) so the screenshots show only this
  ticket's test data.

## Checklist

Work through what applies to the ticket:

1. **Happy path for every feature the ticket names**: create, toggle, delete, filter, whatever it lists.
2. **Persistence**: reload the page and confirm the state survived (client-side DB tickets).
3. **Validation**: empty and whitespace-only input are rejected without errors.
4. **Injection**: enter `<img src=x onerror=alert(1)> text`. It must show as literal text.
5. **Empty states**: an empty list, and a filter that matches nothing, both show a helpful message.
6. **Combinations**: filters combined with each other, and edits made while a filter is active.
7. **Edge of state**: delete the last item, delete the only item that has the tag a filter is set to.
8. **Old data still loads** (enhancement tickets that change the stored shape): with
   `evaluate_script`, write a record in the *old* shape straight into storage, reload, and confirm
   it appears and works.
9. **Console**: `list_console_messages` with `includePreservedMessages: true` shows no errors.
10. **Layout**: one screenshot. Nothing overlapping or cut off.

## Gotchas

- **Element IDs go stale after a re-render.** Apps that rebuild the list (`replaceChildren`) give
  every row new elements, so a uid from an earlier snapshot fails with "did not become
  interactive". That is the tool, not a bug. Pass `includeSnapshot: true` on the action before,
  or take a fresh snapshot.
- **Date inputs**: `fill` with `YYYY-MM-DD` works.
- **Select boxes**: `fill` with the option's visible text.
- `file://` blocks ES modules and `fetch` of local files. If the page is blank, check the console
  for that before debugging app code.
