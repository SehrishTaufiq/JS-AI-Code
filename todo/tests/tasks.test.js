const test = require('node:test');
const assert = require('node:assert/strict');
const Tasks = require('../tasks.js');

const make = (title, createdAt, id, extra = {}) => Tasks.createTask({ title, ...extra }, createdAt, id);

test('createTask trims the title and starts not done with no due date or tags', () => {
  const task = make('  Buy milk  ', 1000, 'a');
  assert.deepEqual(task, {
    id: 'a', title: 'Buy milk', done: false, createdAt: 1000, dueDate: null, tags: [],
    repeat: null, repeatDay: null, nextId: null,
  });
});

test('createTask stores a due date and parsed tags', () => {
  const task = make('Report', 1, 'a', { dueDate: '2026-10-30', tags: 'Work, #urgent' });
  assert.equal(task.dueDate, '2026-10-30');
  assert.deepEqual(task.tags, ['work', 'urgent']);
});

test('createTask generates unique ids', () => {
  assert.notEqual(make('one').id, make('two').id);
});

test('createTask rejects empty and whitespace-only titles', () => {
  for (const title of ['', '   ', null, undefined]) {
    assert.throws(() => make(title), /title is required/);
  }
  assert.throws(() => Tasks.createTask(), /title is required/);
});

test('parseTags trims, lowercases, strips #, drops blanks and duplicates', () => {
  assert.deepEqual(Tasks.parseTags(' Work ,#urgent,, work, ##Home '), ['work', 'urgent', 'home']);
  assert.deepEqual(Tasks.parseTags(''), []);
  assert.deepEqual(Tasks.parseTags(undefined), []);
  assert.deepEqual(Tasks.parseTags(['A', 'a', ' b ']), ['a', 'b']);
});

test('parseDueDate accepts YYYY-MM-DD and rejects anything else', () => {
  assert.equal(Tasks.parseDueDate('2026-01-05'), '2026-01-05');
  for (const bad of ['', null, undefined, '05/01/2026', '2026-1-5', 'tomorrow']) {
    assert.equal(Tasks.parseDueDate(bad), null);
  }
});

test('normalizeTask upgrades tasks saved before due dates and tags', () => {
  const legacy = { id: 'a', title: 'old', done: true, createdAt: 1 };
  assert.deepEqual(Tasks.normalizeTask(legacy), { ...legacy, dueDate: null, tags: [], repeat: null, repeatDay: null, nextId: null });
});

test('toggleDone flips done without mutating the original', () => {
  const task = make('x', 1, 'a');
  const done = Tasks.toggleDone(task);
  assert.equal(done.done, true);
  assert.equal(task.done, false);
  assert.equal(Tasks.toggleDone(done).done, false);
});

test('sortTasks orders oldest first without mutating input', () => {
  const input = [make('c', 3, 'c'), make('a', 1, 'a'), make('b', 2, 'b')];
  assert.deepEqual(Tasks.sortTasks(input).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(input.map((t) => t.id), ['c', 'a', 'b']);
});

test('countRemaining counts tasks not done', () => {
  const a = make('a', 1, 'a');
  const b = Tasks.toggleDone(make('b', 2, 'b'));
  assert.equal(Tasks.countRemaining([a, b]), 1);
  assert.equal(Tasks.countRemaining([]), 0);
});

test('filterTasks by status', () => {
  const open = make('open', 1, 'open');
  const done = Tasks.toggleDone(make('done', 2, 'done'));
  const ids = (status) => Tasks.filterTasks([open, done], { status }).map((t) => t.id);
  assert.deepEqual(ids('all'), ['open', 'done']);
  assert.deepEqual(ids('incomplete'), ['open']);
  assert.deepEqual(ids('completed'), ['done']);
  assert.deepEqual(Tasks.filterTasks([open, done]).length, 2);
});

test('filterTasks by tag, combined with status', () => {
  const a = make('a', 1, 'a', { tags: 'work' });
  const b = Tasks.toggleDone(make('b', 2, 'b', { tags: 'work, home' }));
  const c = make('c', 3, 'c', { tags: 'home' });
  const ids = (filter) => Tasks.filterTasks([a, b, c], filter).map((t) => t.id);
  assert.deepEqual(ids({ tag: 'work' }), ['a', 'b']);
  assert.deepEqual(ids({ tag: 'home', status: 'incomplete' }), ['c']);
  assert.deepEqual(ids({ tag: 'home', status: 'completed' }), ['b']);
  assert.deepEqual(ids({ tag: 'missing' }), []);
});

test('collectTags returns unique tags sorted', () => {
  const tasks = [make('a', 1, 'a', { tags: 'work, home' }), make('b', 2, 'b', { tags: 'errands,work' }), make('c', 3, 'c')];
  assert.deepEqual(Tasks.collectTags(tasks), ['errands', 'home', 'work']);
  assert.deepEqual(Tasks.collectTags([]), []);
});

test('toDateString formats a local date as YYYY-MM-DD', () => {
  assert.equal(Tasks.toDateString(new Date(2026, 0, 5)), '2026-01-05');
});

test('isOverdue only for incomplete tasks due before today', () => {
  const today = '2026-10-26';
  assert.equal(Tasks.isOverdue(make('x', 1, 'x', { dueDate: '2026-10-25' }), today), true);
  assert.equal(Tasks.isOverdue(make('x', 1, 'x', { dueDate: '2026-10-26' }), today), false);
  assert.equal(Tasks.isOverdue(make('x', 1, 'x', { dueDate: '2026-10-27' }), today), false);
  assert.equal(Tasks.isOverdue(make('x', 1, 'x'), today), false);
  const doneLate = Tasks.toggleDone(make('x', 1, 'x', { dueDate: '2026-01-01' }));
  assert.equal(Tasks.isOverdue(doneLate, today), false);
});

test('parseRepeat accepts daily/weekly/monthly only', () => {
  assert.equal(Tasks.parseRepeat('Weekly'), 'weekly');
  for (const bad of ['', null, undefined, 'none', 'yearly']) assert.equal(Tasks.parseRepeat(bad), null);
});

test('createTask with repeat defaults the due date to today', () => {
  const now = new Date(2026, 9, 26, 12).getTime();
  const t = Tasks.createTask({ title: 'Stand-up', repeat: 'daily' }, now, 'a');
  assert.equal(t.repeat, 'daily');
  assert.equal(t.dueDate, '2026-10-26');
  assert.equal(t.nextId, null);
  assert.equal(make('plain', 1, 'p').repeat, null);
});

test('createTask monthly remembers the day of month', () => {
  const t = make('Rent', 1, 'a', { repeat: 'monthly', dueDate: '2026-01-31' });
  assert.equal(t.repeatDay, 31);
});

test('nextDueDate steps daily, weekly and monthly', () => {
  const today = '2026-01-01';
  assert.equal(Tasks.nextDueDate(make('d', 1, 'd', { repeat: 'daily', dueDate: '2026-01-01' }), today), '2026-01-02');
  assert.equal(Tasks.nextDueDate(make('w', 1, 'w', { repeat: 'weekly', dueDate: '2026-12-28' }), today), '2027-01-04');
  assert.equal(Tasks.nextDueDate(make('m', 1, 'm', { repeat: 'monthly', dueDate: '2026-03-15' }), today), '2026-04-15');
  assert.equal(Tasks.nextDueDate(make('n', 1, 'n'), today), null);
});

test('monthly repeats clamp to short months and return to the original day', () => {
  let t = make('Rent', 1, 'a', { repeat: 'monthly', dueDate: '2026-01-31' });
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const { next } = Tasks.completeTask(t, '2000-01-01', i, 'n' + i);
    seen.push(next.dueDate);
    t = next;
  }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30']);
  const leap = make('Leap', 1, 'l', { repeat: 'monthly', dueDate: '2028-01-31' });
  assert.equal(Tasks.nextDueDate(leap, '2000-01-01'), '2028-02-29');
});

test('nextDueDate skips past dates for overdue tasks', () => {
  const t = make('Water plants', 1, 'a', { repeat: 'weekly', dueDate: '2026-10-01' });
  assert.equal(Tasks.nextDueDate(t, '2026-10-26'), '2026-10-29');
  const d = make('Daily', 1, 'b', { repeat: 'daily', dueDate: '2026-10-20' });
  assert.equal(Tasks.nextDueDate(d, '2026-10-26'), '2026-10-26');
});

test('completeTask on a repeating task spawns the next occurrence once', () => {
  const t = make('Stand-up', 5, 'a', { repeat: 'daily', dueDate: '2026-10-26', tags: 'work' });
  const first = Tasks.completeTask(t, '2026-10-26', 99, 'b');
  assert.equal(first.done.done, true);
  assert.equal(first.done.nextId, 'b');
  assert.deepEqual(
    { id: first.next.id, title: first.next.title, done: first.next.done, dueDate: first.next.dueDate, tags: first.next.tags, repeat: first.next.repeat },
    { id: 'b', title: 'Stand-up', done: false, dueDate: '2026-10-27', tags: ['work'], repeat: 'daily' },
  );
  // Untick and tick again: no second copy.
  const again = Tasks.completeTask(Tasks.toggleDone(first.done), '2026-10-26', 100, 'c');
  assert.equal(again.next, null);
  assert.equal(again.done.done, true);
});

test('completeTask on a plain task only marks it done', () => {
  const { done, next } = Tasks.completeTask(make('x', 1, 'a'), '2026-10-26');
  assert.equal(done.done, true);
  assert.equal(next, null);
});

test('normalizeTask upgrades v2 tasks (no repeat fields) and drops repeat without a date', () => {
  const v2 = { id: 'a', title: 't', done: false, createdAt: 1, dueDate: '2026-10-26', tags: ['x'] };
  const n = Tasks.normalizeTask(v2);
  assert.equal(n.repeat, null);
  assert.equal(n.nextId, null);
  assert.equal(Tasks.normalizeTask({ ...v2, dueDate: null, repeat: 'daily' }).repeat, null);
  assert.equal(Tasks.normalizeTask({ ...v2, dueDate: '2026-01-31', repeat: 'monthly' }).repeatDay, 31);
});

// --- Edge cases (hardening) ---

test('parseDueDate rejects impossible calendar dates', () => {
  for (const bad of ['2026-13-01', '2026-00-10', '2026-02-30', '2026-04-31', '2025-02-29', '2026-1-1x']) {
    assert.equal(Tasks.parseDueDate(bad), null, bad);
  }
  assert.equal(Tasks.parseDueDate('2028-02-29'), '2028-02-29', 'leap day is real');
  assert.equal(Tasks.parseDueDate(' 2026-12-31 '), '2026-12-31', 'surrounding spaces trimmed');
});

test('normalizeTask survives junk stored data', () => {
  const junk = { id: 'j', title: 'x', done: false, createdAt: 1, dueDate: 'not a date', tags: 'Work, home', repeat: 'WEEKLY', nextId: undefined };
  const n = Tasks.normalizeTask(junk);
  assert.equal(n.dueDate, null);
  assert.deepEqual(n.tags, ['work', 'home'], 'a tags string is parsed');
  assert.equal(n.repeat, null, 'repeat without a valid date is dropped');
  assert.equal(n.nextId, null);
  assert.deepEqual(Tasks.normalizeTask({ ...junk, tags: 42 }).tags, ['42']);
  assert.deepEqual(Tasks.normalizeTask({ ...junk, tags: null }).tags, []);
  assert.equal(Tasks.normalizeTask({ ...junk, dueDate: '2026-10-26', repeat: 'Weekly ' }).repeat, 'weekly');
  assert.equal(Tasks.normalizeTask({ ...junk, dueDate: '2026-10-26', repeat: 'hourly' }).repeat, null);
});

test('tags: unicode and emoji kept, a lone # dropped', () => {
  assert.deepEqual(Tasks.parseTags('#Ürgent, 日本, 🚀, #, ##, ÜRGENT'), ['ürgent', '日本', '🚀']);
});

test('very long and unicode titles are kept intact', () => {
  const long = 'é'.repeat(5000);
  assert.equal(make(long, 1, 'a').title, long);
  assert.equal(make('  Привет 👋  ', 1, 'b').title, 'Привет 👋');
});

test('title made only of whitespace characters (tabs, newlines, nbsp) is rejected', () => {
  assert.throws(() => make('\t\n \u00a0'), /title is required/);
});

test('createTask with repeat and an invalid date falls back to due today', () => {
  const now = new Date(2026, 9, 26, 12).getTime();
  const t = Tasks.createTask({ title: 'x', repeat: 'daily', dueDate: '2026-02-30' }, now, 'a');
  assert.equal(t.dueDate, '2026-10-26');
});

test('completeTask on a stored repeating task without a date only marks it done', () => {
  const stored = Tasks.normalizeTask({ id: 'a', title: 'x', done: false, createdAt: 1, dueDate: null, tags: [], repeat: 'daily' });
  const { done, next } = Tasks.completeTask(stored, '2026-10-26');
  assert.equal(done.done, true);
  assert.equal(next, null);
});

test('filterTasks with an unknown status behaves like all', () => {
  const tasks = [make('a', 1, 'a'), Tasks.toggleDone(make('b', 2, 'b'))];
  assert.equal(Tasks.filterTasks(tasks, { status: 'bogus' }).length, 2);
});

test('parseSearch lowercases, splits on whitespace and drops a leading #', () => {
  assert.deepEqual(Tasks.parseSearch('  Buy   #Work\tURGENT '), ['buy', 'work', 'urgent']);
  assert.deepEqual(Tasks.parseSearch('   '), []);
  assert.deepEqual(Tasks.parseSearch('#'), []);
  assert.deepEqual(Tasks.parseSearch(undefined), []);
});

test('search: every word must appear in the title or a tag, partial words match', () => {
  const milk = make('Buy milk', 1, 'a', { tags: 'urgent, home' });
  const report = make('Write report', 2, 'b', { tags: 'work' });
  const search = (text) => Tasks.filterTasks([milk, report], { search: text }).map((t) => t.id);
  assert.deepEqual(search('MILK'), ['a']);
  assert.deepEqual(search('milk urgent'), ['a']);
  assert.deepEqual(search('#wor'), ['b']);
  assert.deepEqual(search('milk work'), []);
  assert.deepEqual(search(''), ['a', 'b']);
  assert.deepEqual(search('  '), ['a', 'b']);
});

test('due filter: overdue, due today, no due date; any date keeps everything', () => {
  const today = '2026-10-26';
  const late = make('late', 1, 'late', { dueDate: '2026-10-25' });
  const lateDone = Tasks.toggleDone(make('late done', 2, 'lateDone', { dueDate: '2026-10-25' }));
  const now = make('now', 3, 'now', { dueDate: today });
  const nowDone = Tasks.toggleDone(make('now done', 4, 'nowDone', { dueDate: today }));
  const later = make('later', 5, 'later', { dueDate: '2026-10-27' });
  const none = make('none', 6, 'none');
  const all = [late, lateDone, now, nowDone, later, none];
  const due = (value) => Tasks.filterTasks(all, { due: value, today }).map((t) => t.id);
  assert.deepEqual(due('overdue'), ['late']);
  assert.deepEqual(due('today'), ['now', 'nowDone']);
  assert.deepEqual(due('none'), ['none']);
  assert.deepEqual(due(''), all.map((t) => t.id));
  assert.deepEqual(due('bogus'), all.map((t) => t.id));
  assert.deepEqual(Tasks.DUE_FILTERS, ['overdue', 'today', 'none']);
});

test('search, status, tag and due filters all combine', () => {
  const today = '2026-10-26';
  const tasks = [
    make('Buy milk', 1, 'a', { tags: 'home', dueDate: today }),
    Tasks.toggleDone(make('Buy bread', 2, 'b', { tags: 'home', dueDate: today })),
    make('Buy stamps', 3, 'c', { tags: 'work', dueDate: today }),
    make('Buy eggs', 4, 'd', { tags: 'home' }),
  ];
  const ids = Tasks.filterTasks(tasks, { search: 'buy', status: 'incomplete', tag: 'home', due: 'today', today }).map((t) => t.id);
  assert.deepEqual(ids, ['a']);
});
