// End-to-end tests for the todo app, run against index.html over file:// like a real user opens it.
// Each test gets a fresh browser context, so IndexedDB starts empty.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;
// Fixed instant for date tests: local date is Oct 26 in UTC and Sao Paulo, Oct 27 in Auckland.
const NOW = new Date('2026-10-26T12:00:00Z');

async function open(page, { clock = true } = {}) {
  if (clock) await page.clock.setFixedTime(NOW);
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();
}

// Adds a task through the real form.
async function add(page, title, { due, tags, repeat } = {}) {
  if (due) await page.getByLabel('Due date', { exact: true }).fill(due);
  if (tags) await page.getByLabel('Tags', { exact: true }).fill(tags);
  if (repeat) await page.getByLabel('Repeat', { exact: true }).selectOption(repeat);
  await page.getByLabel('New task').fill(title);
  await page.getByLabel('New task').press('Enter');
}

const items = (page) => page.locator('#task-list li');
const item = (page, title) => items(page).filter({ has: page.getByText(title, { exact: true }) });
const count = (page) => page.locator('#task-count');

// "Today" as the app sees it (browser time zone), plus UTC day arithmetic like the app's.
const browserToday = (page) => page.evaluate(() => Tasks.toDateString());
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const pretty = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

test.describe('#3 basics', () => {
  test('empty state, add with Enter and with the button', async ({ page }) => {
    await open(page);
    await expect(page.getByText('No tasks yet. Add one above.')).toBeVisible();
    await add(page, 'Buy milk');
    await page.getByLabel('New task').fill('Book dentist');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(items(page)).toHaveCount(2);
    await expect(count(page)).toHaveText('2 of 2 left');
    await expect(page.getByLabel('New task')).toHaveValue('');
  });

  test('whitespace-only titles are ignored', async ({ page }) => {
    await open(page);
    await add(page, '   \t ');
    await expect(items(page)).toHaveCount(0);
  });

  test('HTML in a title is shown as text, never run', async ({ page }) => {
    let dialog = false;
    page.on('dialog', (d) => {
      dialog = true;
      d.dismiss();
    });
    await open(page);
    const evil = '<img src=x onerror=alert(1)> Write report';
    await add(page, evil);
    await expect(item(page, evil)).toHaveCount(1);
    await expect(page.locator('#task-list img')).toHaveCount(0);
    expect(dialog).toBe(false);
  });

  test('done and delete survive a reload', async ({ page }) => {
    await open(page);
    for (const t of ['A', 'B', 'C']) await add(page, t);
    await item(page, 'A').getByRole('checkbox').check();
    await item(page, 'C').getByRole('button', { name: 'Delete "C"' }).click();
    await page.reload();
    await expect(items(page)).toHaveCount(2);
    await expect(item(page, 'A').getByRole('checkbox')).toBeChecked();
    await expect(item(page, 'B').getByRole('checkbox')).not.toBeChecked();
    await expect(count(page)).toHaveText('1 of 2 left');
  });
});

test.describe('#4 due dates, tags, filters', () => {
  test('due today, overdue and future labels follow the browser\'s local date @dates', async ({ page }) => {
    await open(page);
    const today = await browserToday(page);
    await add(page, 'Late', { due: addDays(today, -3) });
    await add(page, 'Now', { due: today });
    await add(page, 'Later', { due: addDays(today, 2) });
    await expect(item(page, 'Late').locator('.due')).toHaveText(`Due ${pretty(addDays(today, -3))} · overdue`);
    await expect(item(page, 'Late').locator('.due')).toHaveClass(/overdue/);
    await expect(item(page, 'Now').locator('.due')).toHaveText('Due today');
    await expect(item(page, 'Later').locator('.due')).toHaveText(`Due ${pretty(addDays(today, 2))}`);
    // Finishing an overdue task removes the overdue marker.
    await item(page, 'Late').getByRole('checkbox').check();
    await expect(item(page, 'Late').locator('.due')).not.toHaveClass(/overdue/);
  });

  test('tags are cleaned up and filters combine', async ({ page }) => {
    await open(page);
    await add(page, 'Report', { tags: 'Work, #urgent, work' });
    await add(page, 'Plants', { tags: 'home' });
    await add(page, 'Slides', { tags: 'work' });
    await expect(item(page, 'Report').locator('.tag')).toHaveText(['#work', '#urgent']);
    await item(page, 'Slides').getByRole('checkbox').check();

    await page.getByLabel('Tag', { exact: true }).selectOption('work');
    await expect(items(page)).toHaveCount(2);
    await page.getByRole('radio', { name: 'Incomplete' }).check();
    await expect(items(page)).toHaveCount(1);
    await expect(item(page, 'Report')).toHaveCount(1);
    await page.getByRole('radio', { name: 'Completed' }).check();
    await expect(items(page)).toHaveCount(1);
    await expect(item(page, 'Slides')).toHaveCount(1);
    await page.getByLabel('Tag', { exact: true }).selectOption('home');
    await expect(items(page)).toHaveCount(0);
    await expect(page.getByText('No tasks match these filters.')).toBeVisible();
    await expect(count(page)).toHaveText('2 of 3 left · showing 0');
  });

  test('clicking a tag chip filters; deleting its last task resets the filter', async ({ page }) => {
    await open(page);
    await add(page, 'Plants', { tags: 'home' });
    await add(page, 'Report', { tags: 'work' });
    await item(page, 'Plants').getByRole('button', { name: 'Show tasks tagged home' }).click();
    await expect(page.getByLabel('Tag', { exact: true })).toHaveValue('home');
    await expect(items(page)).toHaveCount(1);
    await item(page, 'Plants').getByRole('button', { name: /Delete/ }).click();
    await expect(page.getByLabel('Tag', { exact: true })).toHaveValue('');
    await expect(items(page)).toHaveCount(1);
    await expect(page.getByLabel('Tag', { exact: true }).locator('option')).toHaveText(['All tags', '#work']);
  });
});

test.describe('#5 recurring tasks', () => {
  test('repeating task without a date starts today; ticking it creates the next one @dates', async ({ page }) => {
    await open(page);
    const today = await browserToday(page);
    await add(page, 'Standup', { repeat: 'daily', tags: 'work' });
    await expect(item(page, 'Standup').locator('.due')).toHaveText('Due today');
    await expect(item(page, 'Standup').locator('.repeat')).toHaveText('↻ Repeats daily');
    await item(page, 'Standup').first().getByRole('checkbox').check();
    await expect(item(page, 'Standup')).toHaveCount(2);
    const next = item(page, 'Standup').nth(1);
    await expect(next.locator('.due')).toHaveText(`Due ${pretty(addDays(today, 1))}`);
    await expect(next.locator('.tag')).toHaveText(['#work']);
  });

  test('overdue weekly task jumps to the next date that is not in the past @dates', async ({ page }) => {
    await open(page);
    const today = await browserToday(page);
    await add(page, 'Review', { due: addDays(today, -15), repeat: 'weekly' });
    await item(page, 'Review').first().getByRole('checkbox').check();
    // -15 + 7k >= 0 -> k = 3 -> +6 days
    await expect(item(page, 'Review').nth(1).locator('.due')).toHaveText(`Due ${pretty(addDays(today, 6))}`);
  });

  test('monthly on the 31st clamps to short months and comes back to the 31st @dates', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
    await page.goto(APP);
    await add(page, 'Rent', { due: '2026-01-31', repeat: 'monthly' });
    await item(page, 'Rent').first().getByRole('checkbox').check();
    await item(page, 'Rent').nth(1).getByRole('checkbox').check();
    await expect(item(page, 'Rent').locator('.due')).toHaveText(['Due Jan 31, 2026', 'Due Feb 28, 2026', 'Due Mar 31, 2026']);
  });

  test('re-ticking never creates a duplicate, and the series survives a reload', async ({ page }) => {
    await open(page);
    await add(page, 'Weekly', { repeat: 'weekly' });
    const first = item(page, 'Weekly').first().getByRole('checkbox');
    await first.check();
    await first.uncheck();
    await first.check();
    await expect(item(page, 'Weekly')).toHaveCount(2);
    await page.reload();
    await expect(item(page, 'Weekly')).toHaveCount(2);
    await expect(count(page)).toHaveText('1 of 2 left');
  });
});

test.describe('data and storage', () => {
  test('records saved by older versions still load', async ({ page }) => {
    await open(page);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('todo-app', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('tasks', 'readwrite');
        tx.objectStore('tasks').put({ id: 'v1', title: 'From v1', done: false, createdAt: 1 });
        tx.objectStore('tasks').put({ id: 'v2', title: 'From v2', done: true, createdAt: 2, dueDate: '2026-01-01', tags: ['old'] });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload();
    await expect(item(page, 'From v1')).toHaveCount(1);
    await expect(item(page, 'From v2').locator('.tag')).toHaveText(['#old']);
    await expect(page.locator('#error')).toBeHidden();
  });

  test('two open tabs stay in sync', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a, { clock: false });
    await open(b, { clock: false });
    await add(a, 'Added in tab A');
    await expect(item(b, 'Added in tab A')).toHaveCount(1);
    await item(b, 'Added in tab A').getByRole('checkbox').check();
    await expect(item(a, 'Added in tab A').getByRole('checkbox')).toBeChecked();
  });

  test('no IndexedDB: explains the problem and disables the form', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined });
    });
    await page.goto(APP);
    await expect(page.locator('#error')).toContainText('no IndexedDB');
    await expect(page.getByLabel('New task')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  test('a newer version opened in another tab locks this one with a reload message', async ({ context }) => {
    const a = await context.newPage();
    await open(a, { clock: false });
    await add(a, 'Existing');
    const b = await context.newPage();
    await b.goto('about:blank');
    await b.goto(APP.replace('index.html', 'README.md')); // same file:// origin, not the app
    await b.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('todo-app', 2);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onupgradeneeded = () => {};
    }));
    await expect(a.locator('#error')).toContainText('Reload this page');
    await expect(a.getByLabel('New task')).toBeDisabled();
  });
});

test.describe('security and accessibility', () => {
  test('Content-Security-Policy blocks injected inline scripts', async ({ page }) => {
    await open(page);
    const ran = await page.evaluate(async () => {
      const s = document.createElement('script');
      s.textContent = 'window.__pwned = true';
      document.body.append(s);
      await new Promise((r) => setTimeout(r, 50));
      return window.__pwned === true;
    });
    expect(ran).toBe(false);
  });

  test('every control has an accessible name', async ({ page }) => {
    await open(page);
    await add(page, 'Labelled', { tags: 'a' });
    for (const name of ['New task', 'Due date', 'Repeat', 'Tags']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'All' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Labelled' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete "Labelled"' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tasks' })).toBeVisible();
    await expect(count(page)).toHaveAttribute('aria-live', 'polite');
  });

  test('works with the keyboard only', async ({ page }) => {
    await open(page);
    await page.getByLabel('New task').focus();
    await page.keyboard.type('Keyboard task');
    await page.keyboard.press('Enter');
    await expect(item(page, 'Keyboard task')).toHaveCount(1);
    const box = item(page, 'Keyboard task').getByRole('checkbox');
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await page.keyboard.press('Tab'); // label is not focusable; next stop is the Delete button
    await expect(page.getByRole('button', { name: 'Delete "Keyboard task"' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(items(page)).toHaveCount(0);
  });

  test('phone width: no horizontal scrolling, adding still works @mobile', async ({ page }) => {
    await open(page);
    await add(page, 'A fairly long task title that needs to wrap on a narrow phone screen', { tags: 'one, two, three, four', due: '2026-10-30' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(items(page)).toHaveCount(1);
  });
});
