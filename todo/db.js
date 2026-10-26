// IndexedDB storage: one object store of tasks keyed by id. Exposes window.TodoDB.
(function (root) {
  const DB_NAME = 'todo-app';
  const DB_VERSION = 1;
  const STORE = 'tasks';

  function open() {
    return new Promise((resolve, reject) => {
      const req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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

  async function connect() {
    const db = await open();
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
