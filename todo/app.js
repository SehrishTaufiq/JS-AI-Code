// UI wiring: reads/writes tasks through TodoDB and renders them with Tasks helpers.
(async function () {
  const form = document.getElementById('new-task-form');
  const input = document.getElementById('new-task-title');
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('task-count');
  const errorBox = document.getElementById('error');

  let store;
  let tasks = [];

  try {
    store = await TodoDB.connect();
    tasks = await store.all();
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
      task = Tasks.createTask(input.value);
    } catch {
      input.focus();
      return;
    }
    if (await persist(() => store.put(task))) {
      tasks.push(task);
      input.value = '';
      render();
    }
    input.focus();
  });

  list.addEventListener('change', async (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const id = event.target.closest('li').dataset.id;
    const updated = Tasks.toggleDone(tasks.find((t) => t.id === id));
    if (await persist(() => store.put(updated))) {
      tasks = tasks.map((t) => (t.id === id ? updated : t));
    }
    render();
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('button.delete');
    if (!button) return;
    const id = button.closest('li').dataset.id;
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
    list.replaceChildren(...Tasks.sortTasks(tasks).map(renderItem));
    empty.hidden = tasks.length > 0;
    const left = Tasks.countRemaining(tasks);
    count.textContent = tasks.length ? `${left} of ${tasks.length} left` : '';
  }

  function renderItem(task) {
    const li = document.createElement('li');
    li.dataset.id = task.id;
    li.className = task.done ? 'task done' : 'task';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.id = 'task-' + task.id;

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = task.title;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete "${task.title}"`);

    li.append(checkbox, label, del);
    return li;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }
})();
