import { DB_NAME, DB_VERSION } from '../config/dbConfig.js';
import Logger from '../services/Logger.js';
import { Money } from '../utils/moneyMath.js';

const CHUNK_SIZE = 1000;
let activeDB = null;

// --- 1. GESTIÓN DE CONEXIÓN ROBUSTA (SINGLETON) ---
const getDB = async () => {
  if (activeDB) return activeDB;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onsuccess = (e) => {
      activeDB = e.target.result;

      activeDB.onversionchange = () => {
        if (activeDB) {
          activeDB.close();
          activeDB = null;
        }
      };
      resolve(activeDB);
    };

    request.onerror = (e) => reject(e.target.error);

    request.onblocked = () => {
      reject(new Error('DATABASE_BLOCKED_BY_OTHER_TAB'));
    };
  });
};

// --- 2. CÁLCULO OPTIMIZADO (CHUNKS + TIMEOUT) ---
const calculateInventoryValue = async () => {
  const db = await getDB();

  // Inicialización estricta con el motor financiero
  let inventoryValue = Money.init(0);
  let processedCount = 0;

  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('product_batches')) {
      return resolve({ inventoryValue: 0, totalProcessed: 0 });
    }

    const tx = db.transaction(['product_batches'], 'readonly');
    const store = tx.objectStore('product_batches');
    const request = store.openCursor();

    const timeoutId = setTimeout(() => {
      try { tx.abort(); } catch (e) { }
      reject(new Error('CALCULATION_TIMEOUT'));
    }, 30000);

    request.onsuccess = (event) => {
      const cursor = event.target.result;

      if (cursor) {
        const batch = cursor.value;

        if (batch.isActive && batch.stock > 0) {
          // Operaciones matemáticas puras sin tocar floats nativos
          const batchValue = Money.multiply(batch.cost, batch.stock);
          inventoryValue = Money.add(inventoryValue, batchValue);
        }

        processedCount++;

        if (processedCount % CHUNK_SIZE === 0) {
          self.postMessage({
            type: 'PROGRESS',
            payload: {
              processed: processedCount,
              // Serialización OBLIGATORIA para evitar la destrucción del prototipo Big.js
              currentValue: Money.toNumber(inventoryValue)
            }
          });
        }

        cursor.continue();
      } else {
        clearTimeout(timeoutId);
        resolve({
          // Retornar número primitivo seguro para la UI/hilo principal
          inventoryValue: Money.toNumber(inventoryValue),
          totalProcessed: processedCount
        });
      }
    };

    request.onerror = (e) => {
      clearTimeout(timeoutId);
      reject(e.target.error);
    };
  });
};

// --- 3. MANEJO DE MENSAJES ---
self.onmessage = async (e) => {
  try {
    switch (e.data.type) {
      case 'CALCULATE_STATS': {
        const result = await calculateInventoryValue();
        self.postMessage({
          success: true,
          type: 'STATS_RESULT',
          payload: result
        });
        break;
      }

      case 'CLEANUP': {
        if (activeDB) {
          activeDB.close();
          activeDB = null;
        }
        self.postMessage({ success: true, type: 'CLEANUP_COMPLETE' });
        break;
      }

      default:
        Logger.warn(`[Worker] Tipo de mensaje desconocido: ${e.data.type}`);
        break;
    }
  } catch (error) {
    self.postMessage({
      success: false,
      type: 'ERROR',
      error: {
        message: error.message,
        code: error.name || 'WORKER_INTERNAL_ERROR'
      }
    });
  }
};

self.addEventListener('close', () => {
  if (activeDB) {
    activeDB.close();
    activeDB = null;
  }
});