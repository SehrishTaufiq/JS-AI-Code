// IndexedDB storage: one object store of tasks keyed by id. Exposes window.TodoDB.
(function (root) {
  const DB_NAME = 'todo-app';
  const DB_VERSION = 1;
  const STORE = 'tasks';

  function open() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('this browser has no IndexedDB (private browsing, or site storage blocked?)'));
        return;
      }
      let req;
      try {
        req = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Another tab holds an older version open and is blocking the upgrade.
      req.onblocked = () => reject(new Error('another tab with an older version of this app is open; close it and reload'));
    });
  }

  // Runs fn against the store and resolves once the transaction commits.
  function run(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // onLost(message) is called if the connection goes away: another tab upgrades the database,
  // or the browser closes it (e.g. site data cleared).
  async function connect({ onLost } = {}) {
    const db = await open();
    db.onversionchange = () => {
      db.close();
      if (onLost) onLost('The task list was updated by a newer version in another tab. Reload this page.');
    };
    db.onclose = () => {
      if (onLost) onLost('The task database was closed by the browser. Reload this page.');
    };
    return {
      all: () => run(db, 'readonly', (s) => s.getAll()),
      put: (task) => run(db, 'readwrite', (s) => s.put(task)),
      // Writes several tasks in one transaction: all are saved or none are.
      putAll: (list) => run(db, 'readwrite', (s) => {
        list.forEach((t) => s.put(t));
      }),
      remove: (id) => run(db, 'readwrite', (s) => s.delete(id)),
    };
  }

  root.TodoDB = { connect };
})(window);
