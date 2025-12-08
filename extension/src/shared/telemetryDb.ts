import type { TabTelemetryRecord } from './types';

const DB_NAME = 'sleepyTabsTelemetry';
const DB_VERSION = 1;
const STORE_NAME = 'telemetry';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('critical', 'critical');
          store.createIndex('tabId', 'tabId');
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  let result: T | Promise<T>;

  try {
    result = fn(store);
  } catch (error) {
    tx.abort();
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const finalize = () => {
      Promise.resolve(result).then(resolve).catch(reject);
    };

    tx.oncomplete = finalize;
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function saveTelemetry(record: TabTelemetryRecord): Promise<void> {
  await withStore('readwrite', (store) => {
    store.add({ ...record, timestamp: record.timestamp ?? Date.now() });
  });
}

export async function getRecentTelemetry(limit = 100): Promise<TabTelemetryRecord[]> {
  return withStore('readonly', (store) => {
    const index = store.index('timestamp');
    const results: TabTelemetryRecord[] = [];
    const request = index.openCursor(null, 'prev');

    return new Promise<TabTelemetryRecord[]>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value as TabTelemetryRecord);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor error'));
    });
  });
}

export async function getCriticalTelemetry(limit = 20): Promise<TabTelemetryRecord[]> {
  return withStore('readonly', (store) => {
    const index = store.index('critical');
    const results: TabTelemetryRecord[] = [];
    const request = index.openCursor(IDBKeyRange.only(true), 'prev');

    return new Promise<TabTelemetryRecord[]>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value as TabTelemetryRecord);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor error'));
    });
  });
}

export async function clearTelemetry(): Promise<void> {
  await withStore('readwrite', (store) => {
    store.clear();
  });
}
