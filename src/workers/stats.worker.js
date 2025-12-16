import { DB_NAME, DB_VERSION } from '../config/dbConfig.js';
const CHUNK_SIZE = 1000;

let activeDB = null;

// --- 1. GESTIÓN DE CONEXIÓN ROBUSTA (SINGLETON) ---
const getDB = async () => {
  if (activeDB) return activeDB;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onsuccess = (e) => {
      activeDB = e.target.result;
      
      // Si la versión cambia en otra pestaña, cerramos esta conexión para evitar bloqueos
      activeDB.onversionchange = () => {
        if (activeDB) {
          activeDB.close();
          activeDB = null;
        }
      };
      resolve(activeDB);
    };

    request.onerror = (e) => reject(e.target.error);

    // CRÍTICO: Si otra pestaña está intentando actualizar la BD, fallamos rápido
    request.onblocked = () => {
      reject(new Error('DATABASE_BLOCKED_BY_OTHER_TAB'));
    };
  });
};

// --- 2. CÁLCULO OPTIMIZADO (CHUNKS + TIMEOUT) ---
const calculateInventoryValue = async () => {
  const db = await getDB();
  let inventoryValue = 0;
  let processedCount = 0;

  return new Promise((resolve, reject) => {
    // Verificación defensiva: ¿Existe el almacén?
    if (!db.objectStoreNames.contains('product_batches')) {
      return resolve({ inventoryValue: 0, totalProcessed: 0 });
    }

    const tx = db.transaction(['product_batches'], 'readonly');
    const store = tx.objectStore('product_batches');
    const request = store.openCursor();

    // Timeout de seguridad: Si tarda más de 30s, abortamos para liberar memoria
    const timeoutId = setTimeout(() => {
      try { tx.abort(); } catch (e) {}
      reject(new Error('CALCULATION_TIMEOUT'));
    }, 30000);

    request.onsuccess = (event) => {
      const cursor = event.target.result;

      if (cursor) {
        const batch = cursor.value;

        // Sumar solo lotes activos y con stock positivo
        if (batch.isActive && batch.stock > 0) {
          // Usamos Math.round para evitar errores de decimales flotantes (ej: 10.0000001)
          inventoryValue += Math.round((batch.cost * batch.stock) * 100) / 100;
        }

        processedCount++;

        // Reportar progreso cada 1000 items (Opcional, pero buena práctica)
        if (processedCount % CHUNK_SIZE === 0) {
          self.postMessage({
            type: 'PROGRESS',
            payload: { processed: processedCount, currentValue: inventoryValue }
          });
        }

        cursor.continue();
      } else {
        // Fin del cursor
        clearTimeout(timeoutId);
        resolve({ inventoryValue, totalProcessed: processedCount });
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
        console.warn(`[Worker] Tipo de mensaje desconocido: ${e.data.type}`);
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

// Limpieza automática si el worker se cierra
self.addEventListener('close', () => {
  if (activeDB) {
    activeDB.close();
    activeDB = null;
  }
});