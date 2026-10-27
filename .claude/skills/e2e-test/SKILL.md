---
name: e2e-test
description: Write and run Playwright end-to-end tests for the web projects in this repo (e.g. todo/). Use it whenever a ticket adds or changes something a user does in the browser, when asked to "add e2e/browser/UI tests", "test this in a real browser", "automate the QA checklist", or when a Playwright test fails and needs fixing. Covers file layout, conventions (file:// app, fixed clock, time-zone projects, accessible selectors) and the gotchas this repo has already hit.
---

# E2E tests (Playwright)

Browser behaviour is part of every UI ticket's definition of done: the factory's manual Chrome
DevTools walk-through produces screenshots for the reviewer, and these tests make the same checks
repeatable, run in CI on every PR.

## Layout and commands

- Tests: `<project>/e2e/*.spec.mjs`; config: `<project>/playwright.config.mjs`
  (copy `todo/playwright.config.mjs` for a new project).
- `@playwright/test` is a devDependency pinned to an exact version. Locally the config uses the
  installed Chrome (`channel: 'chrome'`), so no browser download; in CI (`CI=true`) it uses the
  bundled Chromium (`npx playwright install --with-deps chromium`).
- Run: `npm run test:e2e` (all projects), `npx playwright test -g "recurring"` (by title),
  `npx playwright test --project=tz-auckland`. Unit + e2e: `npm run test:all`.
- `node --test` does not pick up `*.spec.mjs`, so unit and e2e suites stay separate.

## Conventions

- **Import `test`/`expect` from `./fixtures.mjs`**, not `@playwright/test`. Every test then
  records the console and network (`browser-log.txt` in the report) and fails on console errors,
  uncaught exceptions, failed loads or requests outside the app folder. A test that causes an
  error on purpose allows it with `test.use({ allowConsole: [/pattern/] })` in its own `describe`.
- **Open the app the way users do:** `page.goto(pathToFileURL('<project>/index.html').href)`.
  Every test gets a fresh browser context, so IndexedDB starts empty. Never share state between tests.
- **Drive the real UI** (fill, press Enter, click, check), not internal functions. Use
  `page.evaluate` only to seed storage (e.g. old-format records) or to read "today" from the app.
- **Selectors:** `getByRole` / `getByLabel(name, { exact: true })`. A selector that only works
  with CSS classes or test ids usually means the UI is missing an accessible name, which is a bug
  to fix in the app.
- **Dates:** freeze time with `page.clock.setFixedTime(...)` before `goto`. Tag date-dependent
  tests `@dates`; they also run in the `tz-auckland` (UTC+13) and `tz-sao-paulo` (UTC-3) projects.
  Compute expectations from the browser's own today (`page.evaluate(() => Tasks.toDateString())`),
  never from the test machine's clock.
- **Phone width:** tag `@mobile`; the `mobile` project runs them at 390×844. Assert no horizontal
  overflow: `document.documentElement.scrollWidth <= innerWidth`.
- **No sleeps.** Use web-first assertions (`await expect(locator).toHaveText(...)`), which retry.
- Cover, per feature: the happy path, persistence after `page.reload()`, validation, HTML
  injection shown as text, filters/edge states, keyboard-only use, and old stored data still loading.

## Gotchas already hit here

- **Wrapping a control in its `<label>`** makes its accessible name include its value
  ("Repeat Never"), so `getByLabel('Repeat', { exact: true })` finds nothing. Use
  `<label for="id">`.
- **Duplicated titles:** after an action creates a second item with the same title (recurring
  tasks), `item(...).getByRole('checkbox').check()` hits a strict-mode violation when Playwright
  re-checks it. Target `.first()` / `.nth(i)`.
- **Visually-hidden inputs** (segmented radio buttons): clicking their text times out. Use
  `getByRole('radio', { name }).check()`.
- **Re-rendering lists** drops keyboard focus unless the app restores it; the keyboard test
  catches this.
- **Multi-tab tests:** use two pages from the same `context` (same storage); the app syncs them
  with `BroadcastChannel`.
- **`addInitScript`** runs before the app's scripts. Use it to simulate missing APIs
  (e.g. `indexedDB` undefined).
