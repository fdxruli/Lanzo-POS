/**
 * Worker de mantenimiento para poblar activeStockStatus por lotes.
 *
 * Este worker NO es propietario del esquema. Abre IndexedDB sin versión para
 * conectarse únicamente a la versión existente y nunca provocar upgrades.
 */

import { runChunkedMigration } from './migrationCore';

let isRunning = false;
let shouldStop = false;
let activeDatabase = null;

const processBatch = async (database, storeName, offset, limit) => (
  new Promise((resolve, reject) => {
    if (!database.objectStoreNames.contains(storeName)) {
      resolve({ processed: 0, scanned: 0, hasMore: false, nextOffset: offset });
      return;
    }

    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    let processed = 0;
    let scanned = 0;
    let skipped = 0;
    let settled = false;
    const request = store.openCursor();

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    transaction.onabort = () => {
      if (!settled) reject(transaction.error || new Error(`Transacción abortada en ${storeName}`));
    };
    transaction.onerror = () => {
      if (!settled) reject(transaction.error || new Error(`Error de transacción en ${storeName}`));
    };

    request.onerror = () => reject(request.error || new Error(`Error al abrir cursor en ${storeName}`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        finish({ processed, scanned, hasMore: false, nextOffset: offset + scanned });
        return;
      }

      if (skipped < offset) {
        skipped += 1;
        cursor.continue();
        return;
      }

      if (scanned >= limit) {
        finish({ processed, scanned, hasMore: true, nextOffset: offset + scanned });
        return;
      }

      const record = cursor.value;
      scanned += 1;

      if (record.activeStockStatus === undefined || record.activeStockStatus === null) {
        const isActive = record.isActive !== false;
        const hasStock = Number(record.stock) > 0;
        record.activeStockStatus = isActive && hasStock ? 1 : 0;
        const updateRequest = cursor.update(record);
        updateRequest.onerror = () => reject(updateRequest.error || new Error(`No se pudo actualizar ${storeName}`));
        updateRequest.onsuccess = () => {
          processed += 1;
          cursor.continue();
        };
        return;
      }

      cursor.continue();
    };
  })
);

const openExistingDatabase = (dbName) => new Promise((resolve, reject) => {
  // Omitir el argumento version es deliberado: un worker de mantenimiento no
  // puede registrar ni disparar cambios de esquema.
  const request = indexedDB.open(dbName);
  request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos'));
  request.onblocked = () => {
    const error = new Error('La base está bloqueada por otra pestaña.');
    error.name = 'DatabaseBlockedError';
    error.code = 'DB_BLOCKED';
    reject(error);
  };
  request.onsuccess = () => {
    const database = request.result;
    database.onversionchange = () => database.close();
    resolve(database);
  };
});

const runMigration = async (config) => {
  const {
    dbName,
    stores = ['menu', 'product_batches'],
    batchSize = 500,
    delayBetweenBatches = 10
  } = config;

  isRunning = true;
  shouldStop = false;

  try {
    activeDatabase = await openExistingDatabase(dbName);
    const results = {
      totalProcessed: 0,
      stores: {},
      startTime: Date.now(),
      endTime: null,
      nativeVersion: activeDatabase.version,
      error: null
    };

    for (const storeName of stores) {
      if (shouldStop) break;

      self.postMessage({ type: 'STORE_START', store: storeName });
      const migrationResult = await runChunkedMigration({
        chunkSize: batchSize,
        delayBetweenChunks: delayBetweenBatches,
        shouldStop: () => shouldStop,
        processChunk: (offset, limit) => processBatch(activeDatabase, storeName, offset, limit),
        onProgress: ({ processed, currentBatch }) => {
          self.postMessage({
            type: 'PROGRESS',
            store: storeName,
            processed,
            currentBatch
          });
        }
      });

      results.stores[storeName] = migrationResult.processed;
      results.totalProcessed += migrationResult.processed;
      self.postMessage({
        type: 'STORE_COMPLETE',
        store: storeName,
        processed: migrationResult.processed
      });
    }

    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;
    self.postMessage({ type: 'COMPLETE', results });
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error?.message || String(error),
      code: error?.code || error?.name || 'MIGRATION_WORKER_ERROR'
    });
  } finally {
    activeDatabase?.close();
    activeDatabase = null;
    isRunning = false;
  }
};

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START':
      if (isRunning) {
        self.postMessage({ type: 'ERROR', error: 'Ya hay una migración en curso' });
        return;
      }
      void runMigration(payload);
      break;
    case 'STOP':
      shouldStop = true;
      self.postMessage({ type: 'STOPPING' });
      break;
    case 'STATUS':
      self.postMessage({ type: 'STATUS', isRunning });
      break;
    default:
      self.postMessage({ type: 'ERROR', error: `Tipo de mensaje desconocido: ${type}` });
  }
};

export default {};
