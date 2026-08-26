import {
  BROWSER_STORAGE_UNAVAILABLE_MESSAGE,
  createBrowserStorageUnavailableError
} from './databaseRecoveryState';

export const INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX = 'LanzoIndexedDbCapabilityProbe';
export const INDEXED_DB_CAPABILITY_PROBE_STORE = 'capability';
export const INDEXED_DB_CAPABILITY_PROBE_TIMEOUT_MS = 4_000;

let probeSequence = 0;
let inFlightProbe = null;

const isProbeDatabaseName = (databaseName) => (
  typeof databaseName === 'string'
  && databaseName.startsWith(`${INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX}_`)
);

const nextProbeDatabaseName = () => {
  probeSequence += 1;
  return `${INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX}_${Date.now().toString(36)}_${probeSequence}`;
};

const createTimeoutError = (databaseName) => {
  const error = new Error(`IndexedDB capability probe timed out for ${databaseName}.`);
  error.name = 'DatabaseOpenTimeoutError';
  return error;
};

const openProbeDatabase = (factory, databaseName, timeoutMs) => new Promise((resolve, reject) => {
  let request;
  let settled = false;
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(createTimeoutError(databaseName));
  }, timeoutMs);

  const settle = (handler, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    handler(value);
  };

  try {
    request = factory.open(databaseName);
  } catch (error) {
    settle(reject, error);
    return;
  }

  request.onupgradeneeded = () => {
    try {
      if (!request.result.objectStoreNames.contains(INDEXED_DB_CAPABILITY_PROBE_STORE)) {
        request.result.createObjectStore(INDEXED_DB_CAPABILITY_PROBE_STORE, { keyPath: 'key' });
      }
    } catch (error) {
      try { request.transaction?.abort(); } catch { /* best effort */ }
      settle(reject, error);
    }
  };
  request.onerror = () => settle(reject, request.error || new Error('IndexedDB open failed.'));
  request.onblocked = () => {
    // No other Lanzo database is touched. The bounded timeout converts a
    // permanently blocked probe into the same actionable local condition.
  };
  request.onsuccess = () => settle(resolve, request.result);
});

const runProbeTransaction = (database, timeoutMs) => new Promise((resolve, reject) => {
  let transaction;
  let settled = false;
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(createTimeoutError(database.name));
    try { transaction?.abort(); } catch { /* best effort */ }
  }, timeoutMs);

  const settle = (handler, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    handler(value);
  };

  try {
    transaction = database.transaction(INDEXED_DB_CAPABILITY_PROBE_STORE, 'readwrite');
    const store = transaction.objectStore(INDEXED_DB_CAPABILITY_PROBE_STORE);
    const expectedValue = `probe-${Date.now()}`;
    const putRequest = store.put({ key: 'health-check', value: expectedValue });

    putRequest.onerror = () => settle(reject, putRequest.error || new Error('IndexedDB write failed.'));
    putRequest.onsuccess = () => {
      const getRequest = store.get('health-check');
      getRequest.onerror = () => settle(reject, getRequest.error || new Error('IndexedDB read failed.'));
      getRequest.onsuccess = () => {
        if (getRequest.result?.value !== expectedValue) {
          settle(reject, new Error('IndexedDB capability probe read-back failed.'));
        }
      };
    };
    transaction.onerror = () => settle(reject, transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => settle(reject, transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.oncomplete = () => settle(resolve);
  } catch (error) {
    settle(reject, error);
  }
});

const cleanupProbeDatabase = async (factory, databaseName, timeoutMs) => {
  if (typeof factory?.deleteDatabase !== 'function') return;

  await new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, timeoutMs);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };

    try {
      const request = factory.deleteDatabase(databaseName);
      request.onerror = finish;
      request.onblocked = () => { /* bounded cleanup; never touch real data */ };
      request.onsuccess = finish;
    } catch {
      finish();
    }
  });
};

const executeCapabilityProbe = async ({
  factory = globalThis.indexedDB,
  databaseName: requestedDatabaseName,
  timeoutMs = INDEXED_DB_CAPABILITY_PROBE_TIMEOUT_MS
} = {}) => {
  // Never allow a caller-provided name to point the probe at a business DB.
  // This keeps the cleanup boundary safe even if test/configuration options
  // are accidentally reused by a production caller.
  const databaseName = isProbeDatabaseName(requestedDatabaseName)
    ? requestedDatabaseName
    : nextProbeDatabaseName();

  if (!factory || typeof factory.open !== 'function') {
    throw createBrowserStorageUnavailableError(
      new Error('The browser does not expose a usable IndexedDB factory.'),
      { databaseName }
    );
  }

  let database = null;
  try {
    database = await openProbeDatabase(factory, databaseName, timeoutMs);
    database.onversionchange = () => database.close();
    await runProbeTransaction(database, timeoutMs);
    return { status: 'pass' };
  } catch (error) {
    throw createBrowserStorageUnavailableError(error, {
      databaseName,
      message: BROWSER_STORAGE_UNAVAILABLE_MESSAGE
    });
  } finally {
    try { database?.close(); } catch { /* best effort */ }
    await cleanupProbeDatabase(factory, databaseName, timeoutMs);
  }
};

/**
 * Proves browser-native IndexedDB usability without opening or inspecting any
 * Lanzo database. Concurrent callers share one bounded operation; a failure
 * releases the promise so a later retry can probe again.
 */
export const preflightIndexedDbCapability = (options = {}) => {
  if (inFlightProbe) return inFlightProbe;

  const operation = executeCapabilityProbe(options);
  const trackedOperation = operation.finally(() => {
    if (inFlightProbe === trackedOperation) inFlightProbe = null;
  });
  inFlightProbe = trackedOperation;
  return trackedOperation;
};

export const resetIndexedDbCapabilityPreflightForTests = () => {
  inFlightProbe = null;
};
