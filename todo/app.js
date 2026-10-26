// UI wiring: reads/writes tasks through TodoDB and renders them with Tasks helpers.
(async function () {
  const form = document.getElementById('new-task-form');
  const titleInput = document.getElementById('new-task-title');
  const dueInput = document.getElementById('new-task-due');
  const tagsInput = document.getElementById('new-task-tags');
  const repeatInput = document.getElementById('new-task-repeat');
  const statusFilter = document.getElementById('status-filter');
  const tagFilter = document.getElementById('tag-filter');
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('task-count');
  const errorBox = document.getElementById('error');

  let store;
  let tasks = [];
  const filter = { status: 'all', tag: '' };

  try {
    store = await TodoDB.connect();
    tasks = (await store.all()).map(Tasks.normalizeTask);
  } catch (err) {
    showError('Could not open the task database: ' + (err && err.message ? err.message : err));
    form.querySelector('button').disabled = true;
    return;
  }
  render();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    let task;
    try {
      task = Tasks.createTask({
        title: titleInput.value,
        dueDate: dueInput.value,
        tags: tagsInput.value,
        repeat: repeatInput.value,
      });
    } catch {
      titleInput.focus();
      return;
    }
    if (await persist(() => store.put(task))) {
      tasks.push(task);
      form.reset();
      render();
    }
    titleInput.focus();
  });

  statusFilter.addEventListener('change', (event) => {
    filter.status = event.target.value;
    render();
  });

  tagFilter.addEventListener('change', () => {
    filter.tag = tagFilter.value;
    render();
  });

  list.addEventListener('change', async (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const id = event.target.closest('li').dataset.id;
    const task = tasks.find((t) => t.id === id);
    // Completing a repeating task also creates its next occurrence, saved together.
    const { done, next } = task.done
      ? { done: Tasks.toggleDone(task), next: null }
      : Tasks.completeTask(task, Tasks.toDateString());
    const changed = next ? [done, next] : [done];
    if (await persist(() => store.putAll(changed))) {
      tasks = tasks.map((t) => (t.id === id ? done : t));
      if (next) tasks.push(next);
    }
    render();
  });

  list.addEventListener('click', async (event) => {
    const chip = event.target.closest('button.tag');
    if (chip) {
      filter.tag = chip.dataset.tag;
      render();
      return;
    }
    const del = event.target.closest('button.delete');
    if (!del) return;
    const id = del.closest('li').dataset.id;
    if (await persist(() => store.remove(id))) {
      tasks = tasks.filter((t) => t.id !== id);
      render();
    }
  });

  // Runs a storage write; on failure shows the error and leaves state unchanged.
  async function persist(write) {
    try {
      await write();
      showError('');
      return true;
    } catch (err) {
      showError('Could not save your change: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  function render() {
    renderTagOptions();
    const today = Tasks.toDateString();
    const visible = Tasks.sortTasks(Tasks.filterTasks(tasks, filter));
    list.replaceChildren(...visible.map((t) => renderItem(t, today)));

    empty.hidden = visible.length > 0;
    empty.textContent = tasks.length ? 'No tasks match these filters.' : 'No tasks yet. Add one above.';

    const left = Tasks.countRemaining(tasks);
    const filtered = filter.status !== 'all' || filter.tag;
    count.textContent = !tasks.length
      ? ''
      : `${left} of ${tasks.length} left` + (filtered ? ` · showing ${visible.length}` : '');
  }

  // Rebuilds the tag dropdown from tags in use; drops the tag filter if its tag is gone.
  function renderTagOptions() {
    const tags = Tasks.collectTags(tasks);
    if (filter.tag && !tags.includes(filter.tag)) filter.tag = '';
    const options = tags.map((tag) => new Option('#' + tag, tag));
    tagFilter.replaceChildren(new Option('All tags', ''), ...options);
    tagFilter.value = filter.tag;
    tagFilter.disabled = tags.length === 0;
  }

  function renderItem(task, today) {
    const li = document.createElement('li');
    li.dataset.id = task.id;
    li.className = task.done ? 'task done' : 'task';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.id = 'task-' + task.id;

    const body = document.createElement('div');
    body.className = 'body';

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = task.title;
    body.append(label);

    if (task.dueDate || task.tags.length) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      if (task.dueDate) meta.append(renderDue(task, today));
      if (task.repeat) {
        const rep = document.createElement('span');
        rep.className = 'repeat';
        rep.textContent = '↻ Repeats ' + task.repeat;
        meta.append(rep);
      }
      for (const tag of task.tags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag';
        chip.dataset.tag = tag;
        chip.textContent = '#' + tag;
        chip.setAttribute('aria-label', `Show tasks tagged ${tag}`);
        meta.append(chip);
      }
      body.append(meta);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete "${task.title}"`);

    li.append(checkbox, body, del);
    return li;
  }

  function renderDue(task, today) {
    const due = document.createElement('time');
    due.dateTime = task.dueDate;
    const overdue = Tasks.isOverdue(task, today);
    due.className = overdue ? 'due overdue' : 'due';
    const [y, m, d] = task.dueDate.split('-').map(Number);
    const pretty = new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    due.textContent = (task.dueDate === today ? 'Due today' : 'Due ' + pretty) + (overdue ? ' · overdue' : '');
    return due;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }
})();
