const test = require('node:test');
const assert = require('node:assert/strict');
const Tasks = require('../tasks.js');

test('createTask trims the title and starts not done', () => {
  const task = Tasks.createTask('  Buy milk  ', 1000, 'a');
  assert.deepEqual(task, { id: 'a', title: 'Buy milk', done: false, createdAt: 1000 });
});

test('createTask generates unique ids', () => {
  assert.notEqual(Tasks.createTask('one').id, Tasks.createTask('two').id);
});

test('createTask rejects empty and whitespace-only titles', () => {
  for (const title of ['', '   ', null, undefined]) {
    assert.throws(() => Tasks.createTask(title), /title is required/);
  }
});

test('toggleDone flips done without mutating the original', () => {
  const task = Tasks.createTask('x', 1, 'a');
  const done = Tasks.toggleDone(task);
  assert.equal(done.done, true);
  assert.equal(task.done, false);
  assert.equal(Tasks.toggleDone(done).done, false);
});

test('sortTasks orders oldest first without mutating input', () => {
  const input = [
    Tasks.createTask('c', 3, 'c'),
    Tasks.createTask('a', 1, 'a'),
    Tasks.createTask('b', 2, 'b'),
  ];
  assert.deepEqual(Tasks.sortTasks(input).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(input.map((t) => t.id), ['c', 'a', 'b']);
});

test('countRemaining counts tasks not done', () => {
  const a = Tasks.createTask('a', 1, 'a');
  const b = Tasks.toggleDone(Tasks.createTask('b', 2, 'b'));
  assert.equal(Tasks.countRemaining([a, b]), 1);
  assert.equal(Tasks.countRemaining([]), 0);
});
