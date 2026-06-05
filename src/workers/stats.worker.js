import Dexie from 'dexie';
import { DB_NAME } from '../config/dbConfig.js';
import Logger from '../services/Logger.js';
import { Money } from '../utils/moneyMath.js';

const CHUNK_SIZE = 1000;
let activeDB = null;

// --- 1. GESTIÓN DE CONEXIÓN ROBUSTA CON DEXIE ---
const getDB = async () => {
  if (activeDB && activeDB.isOpen()) return activeDB;

  // Instanciamos Dexie sin definir la versión. 
  // Esto hace que abra la BD dinámicamente y exponga todas las tablas existentes.
  const db = new Dexie(DB_NAME);
  
  // Dexie maneja internamente de manera segura onversionchange y onblocked,
  // evitando los deadlocks causados por conexiones crudas a IndexedDB.
  await db.open();
  activeDB = db;
  return activeDB;
};

// --- 2. CÁLCULO OPTIMIZADO (CHUNKS + TIMEOUT) ---
const calculateInventoryValue = async () => {
  const db = await getDB();

  // Inicialización estricta con el motor financiero
  let inventoryValue = Money.init(0);
  let processedCount = 0;

  // Verificamos si la tabla existe en el esquema dinámico
  if (!db.tables.some(table => table.name === 'product_batches')) {
    return { inventoryValue: Money.toNumber(inventoryValue), totalProcessed: 0 };
  }

  const table = db.table('product_batches');
  const hasOptimizedIndex = table.schema.indexes.some(idx => idx.name === '[isActive+stock]');

  let isTimedOut = false;
  const timeoutId = setTimeout(() => { isTimedOut = true; }, 30000);

  try {
    // Usamos una transacción de solo lectura de Dexie, lo que sincroniza los 
    // bloqueos correctamente con el hilo principal que también usa Dexie.
    await db.transaction('r', table, async () => {
      let collection;
      if (hasOptimizedIndex) {
        collection = table.where('[isActive+stock]').between([1, 0.000001], [1, Infinity], true, true);
      } else {
        collection = table.toCollection();
      }

      // collection.until() permite abortar la iteración limpiamente si se agota el tiempo
      await collection.until(() => isTimedOut).each((batch) => {
        // La validación se mantiene por seguridad y para soportar el modo fallback
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
      });
    });

    clearTimeout(timeoutId);

    if (isTimedOut) {
      throw new Error('CALCULATION_TIMEOUT');
    }

    return {
      // Retornar número primitivo seguro para la UI/hilo principal
      inventoryValue: Money.toNumber(inventoryValue),
      totalProcessed: processedCount
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
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