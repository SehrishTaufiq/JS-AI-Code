// Pure task logic, no DOM or storage. Loaded as a classic script in the browser
// (exposes window.Tasks) and via require() in the Node tests.
(function (root) {
  const STATUSES = ['all', 'incomplete', 'completed'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function makeId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // "Work, #urgent, work ,," -> ["work", "urgent"]
  function parseTags(input) {
    const list = Array.isArray(input) ? input : String(input ?? '').split(',');
    const tags = list
      .map((t) => String(t).trim().replace(/^#+/, '').trim().toLowerCase())
      .filter(Boolean);
    return [...new Set(tags)];
  }

  // Accepts "YYYY-MM-DD" (what <input type="date"> produces); anything else is no due date.
  function parseDueDate(value) {
    const s = String(value ?? '').trim();
    return DATE_RE.test(s) ? s : null;
  }

  function createTask({ title, dueDate, tags } = {}, now = Date.now(), id = makeId()) {
    const trimmed = String(title ?? '').trim();
    if (!trimmed) throw new Error('Task title is required');
    return {
      id,
      title: trimmed,
      done: false,
      createdAt: now,
      dueDate: parseDueDate(dueDate),
      tags: parseTags(tags),
    };
  }

  // Fills fields missing from tasks saved before due dates and tags existed.
  function normalizeTask(task) {
    return { ...task, dueDate: parseDueDate(task.dueDate), tags: parseTags(task.tags || []) };
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

  // status: "all" | "incomplete" | "completed"; tag: "" for any tag.
  function filterTasks(tasks, { status = 'all', tag = '' } = {}) {
    return tasks.filter((t) => {
      if (status === 'completed' && !t.done) return false;
      if (status === 'incomplete' && t.done) return false;
      if (tag && !(t.tags || []).includes(tag)) return false;
      return true;
    });
  }

  // Every tag used by any task, sorted alphabetically.
  function collectTags(tasks) {
    return [...new Set(tasks.flatMap((t) => t.tags || []))].sort();
  }

  // Local calendar date as "YYYY-MM-DD", comparable with dueDate strings.
  function toDateString(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isOverdue(task, today = toDateString()) {
    return !task.done && !!task.dueDate && task.dueDate < today;
  }

  const api = {
    STATUSES,
    parseTags,
    parseDueDate,
    createTask,
    normalizeTask,
    toggleDone,
    sortTasks,
    countRemaining,
    filterTasks,
    collectTags,
    toDateString,
    isOverdue,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
