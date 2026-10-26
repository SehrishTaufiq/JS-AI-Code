// Pure task logic, no DOM or storage. Loaded as a classic script in the browser
// (exposes window.Tasks) and via require() in the Node tests.
(function (root) {
  function makeId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function createTask(title, now = Date.now(), id = makeId()) {
    const trimmed = String(title ?? '').trim();
    if (!trimmed) throw new Error('Task title is required');
    return { id, title: trimmed, done: false, createdAt: now };
  }

  function toggleDone(task) {
    return { ...task, done: !task.done };
  }

  // Oldest first, so tasks stay in the order they were added.
  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => a.createdAt - b.createdAt);
  }

  function countRemaining(tasks) {
    return tasks.filter((t) => !t.done).length;
  }

  const api = { createTask, toggleDone, sortTasks, countRemaining };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
