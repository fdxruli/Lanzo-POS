import Dexie from 'dexie';
import Logger from '../services/Logger.js';
import { Money } from '../utils/moneyMath.js';
import {
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE,
  areLocalTenantAliasesCompatible,
  isTenantWorkerDatabaseName
} from '../services/tenant/localTenantPolicy.js';

const CHUNK_SIZE = 1000;
let activeDB = null;

// --- 1. GESTIÓN DE CONEXIÓN ROBUSTA CON DEXIE ---
const getDB = async (databaseName) => {
  if (!isTenantWorkerDatabaseName(databaseName)) {
    throw new Error('LOCAL_TENANT_WORKER_DATABASE_INVALID');
  }
  if (activeDB && activeDB.isOpen() && activeDB.name === databaseName) return activeDB;
  if (activeDB) {
    activeDB.close();
    activeDB = null;
  }

  // Instanciamos Dexie sin definir la versión. 
  // Esto hace que abra la BD dinámicamente y exponga todas las tablas existentes.
  const db = new Dexie(databaseName);
  
  // Dexie maneja internamente de manera segura onversionchange y onblocked,
  // evitando los deadlocks causados por conexiones crudas a IndexedDB.
  await db.open();
  activeDB = db;
  return activeDB;
};

const requireMatchingTenantBinding = async (db, tenantAliases) => {
  if (!Array.isArray(tenantAliases) || tenantAliases.length === 0) {
    throw new Error('LOCAL_TENANT_WORKER_IDENTITY_MISSING');
  }
  if (!db.tables.some((table) => table.name === LOCAL_TENANT_BINDING_STORE)) {
    throw new Error('LOCAL_TENANT_WORKER_BINDING_MISSING');
  }

  const binding = await db.table(LOCAL_TENANT_BINDING_STORE).get(LOCAL_TENANT_BINDING_KEY);
  const boundAliases = binding?.tenantAliases || [binding?.tenantIdentity].filter(Boolean);
  if (!areLocalTenantAliasesCompatible(boundAliases, tenantAliases)) {
    throw new Error('LOCAL_TENANT_WORKER_MISMATCH');
  }
};

// --- 2. CÁLCULO OPTIMIZADO (CHUNKS + TIMEOUT) ---
const calculateInventoryValue = async ({ databaseName, tenantAliases }) => {
  const db = await getDB(databaseName);
  await requireMatchingTenantBinding(db, tenantAliases);

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
        const result = await calculateInventoryValue(e.data.context || {});
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
