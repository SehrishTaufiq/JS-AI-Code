// Pure task logic, no DOM or storage. Loaded as a classic script in the browser
// (exposes window.Tasks) and via require() in the Node tests.
(function (root) {
  const STATUSES = ['all', 'incomplete', 'completed'];
  const REPEATS = ['daily', 'weekly', 'monthly'];
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

  function parseRepeat(value) {
    const s = String(value ?? '').trim().toLowerCase();
    return REPEATS.includes(s) ? s : null;
  }

  // A repeating task needs a date to repeat from, so it defaults to due today.
  function createTask({ title, dueDate, tags, repeat } = {}, now = Date.now(), id = makeId(), today = toDateString(new Date(now))) {
    const trimmed = String(title ?? '').trim();
    if (!trimmed) throw new Error('Task title is required');
    const rep = parseRepeat(repeat);
    const due = parseDueDate(dueDate) ?? (rep ? today : null);
    return {
      id,
      title: trimmed,
      done: false,
      createdAt: now,
      dueDate: due,
      tags: parseTags(tags),
      repeat: rep,
      // Day of month monthly repeats return to (so the 31st comes back after a short month).
      repeatDay: rep === 'monthly' ? Number(due.slice(8, 10)) : null,
      nextId: null,
    };
  }

  // Fills fields missing from tasks saved by older versions of the app.
  function normalizeTask(task) {
    const dueDate = parseDueDate(task.dueDate);
    const repeat = dueDate ? parseRepeat(task.repeat) : null;
    return {
      ...task,
      dueDate,
      tags: parseTags(task.tags || []),
      repeat,
      repeatDay: repeat === 'monthly' ? Number(task.repeatDay) || Number(dueDate.slice(8, 10)) : null,
      nextId: task.nextId ?? null,
    };
  }

  // Date arithmetic on "YYYY-MM-DD" strings, in UTC so DST never shifts a day.
  function parseUTC(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function formatUTC(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(s, n) {
    const d = parseUTC(s);
    d.setUTCDate(d.getUTCDate() + n);
    return formatUTC(d);
  }

  // Next month on `day`, clamped to the month's length (31 -> Feb 28/29 -> Mar 31).
  function addMonth(s, day) {
    const d = parseUTC(s);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return formatUTC(new Date(Date.UTC(y, m, Math.min(day, lastDay))));
  }

  function step(task, s) {
    if (task.repeat === 'daily') return addDays(s, 1);
    if (task.repeat === 'weekly') return addDays(s, 7);
    return addMonth(s, task.repeatDay || Number(s.slice(8, 10)));
  }

  // The next due date after this one that is not in the past, so finishing an
  // overdue repeating task does not leave a trail of already-overdue copies.
  function nextDueDate(task, today = toDateString()) {
    if (!task.repeat || !task.dueDate) return null;
    let next = step(task, task.dueDate);
    while (next < today) next = step(task, next);
    return next;
  }

  // Marks a task done. For a repeating task that has not spawned its next
  // occurrence yet, also returns that occurrence: same title, tags and repeat.
  function completeTask(task, today = toDateString(), now = Date.now(), id = makeId()) {
    const done = { ...task, done: true };
    if (!task.repeat || task.nextId) return { done, next: null };
    const next = {
      ...createTask({ title: task.title, tags: task.tags, repeat: task.repeat }, now, id),
      dueDate: nextDueDate(task, today),
      repeatDay: task.repeatDay,
    };
    done.nextId = next.id;
    return { done, next };
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
    REPEATS,
    parseTags,
    parseDueDate,
    parseRepeat,
    createTask,
    normalizeTask,
    nextDueDate,
    completeTask,
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
