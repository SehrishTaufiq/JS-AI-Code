const test = require('node:test');
const assert = require('node:assert/strict');
const Tasks = require('../tasks.js');

const make = (title, createdAt, id, extra = {}) => Tasks.createTask({ title, ...extra }, createdAt, id);

test('createTask trims the title and starts not done with no due date or tags', () => {
  const task = make('  Buy milk  ', 1000, 'a');
  assert.deepEqual(task, {
    id: 'a', title: 'Buy milk', done: false, createdAt: 1000, dueDate: null, tags: [],
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
  assert.deepEqual(Tasks.normalizeTask(legacy), { ...legacy, dueDate: null, tags: [] });
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
