// src/services/database.js - VERSIÓN OPTIMIZADA PARA PAGINACIÓN

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 14;

// Objeto de conexión
const dbConnection = {
  instance: null,
  isOpening: false,
  openPromise: null
};

export const STORES = {
  MENU: 'menu',
  SALES: 'sales',
  COMPANY: 'company',
  THEME: 'theme',
  INGREDIENTS: 'ingredients',
  CATEGORIES: 'categories',
  CUSTOMERS: 'customers',
  CAJAS: 'cajas',
  DELETED_MENU: 'deleted_menu',
  DELETED_CUSTOMERS: 'deleted_customers',
  DELETED_SALES: 'deleted_sales',
  MOVIMIENTOS_CAJA: 'movimientos_caja',
  PRODUCT_BATCHES: 'product_batches',
};

/**
 * Validación robusta de conexión
 */
function isConnectionValid(db) {
  if (!db) return false;
  try {
    if (db.objectStoreNames.length === 0) return false;
    const testTransaction = db.transaction([STORES.MENU], 'readonly');
    testTransaction.abort();
    return true;
  } catch (error) {
    console.warn('Conexión inválida detectada:', error.name);
    return false;
  }
}

/**
 * Inicialización con manejo de concurrencia
 */
export function initDB() {
  return new Promise((resolve, reject) => {

    if (dbConnection.isOpening && dbConnection.openPromise) {
      return dbConnection.openPromise.then(resolve).catch(reject);
    }

    if (isConnectionValid(dbConnection.instance)) {
      return resolve(dbConnection.instance);
    }

    if (dbConnection.instance) {
      try {
        dbConnection.instance.close();
      } catch (e) {
        console.warn('Error cerrando conexión anterior:', e);
      }
      dbConnection.instance = null;
    }

    dbConnection.isOpening = true;
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    dbConnection.openPromise = new Promise((res, rej) => {
      request.onerror = (event) => {
        dbConnection.isOpening = false;
        dbConnection.openPromise = null;
        dbConnection.instance = null;
        const error = new Error(`Error al abrir BD: ${event.target.errorCode || event.target.error?.message}`);
        console.error(error);
        rej(error);
      };

      request.onsuccess = (event) => {
        dbConnection.instance = event.target.result;
        dbConnection.isOpening = false;

        dbConnection.instance.onclose = () => {
          console.warn('⚠️ Conexión de BD cerrada inesperadamente');
          dbConnection.instance = null;
        };

        dbConnection.instance.onversionchange = () => {
          console.warn('⚠️ Otra pestaña actualizó la BD, recargando...');
          dbConnection.instance.close();
          dbConnection.instance = null;
          window.location.reload();
        };

        console.log('✅ Base de datos abierta exitosamente.');
        res(dbConnection.instance);
      };

      request.onupgradeneeded = (event) => {
        const tempDb = event.target.result;
        console.log('Actualizando BD a la versión', DB_VERSION);

        // Crear stores si no existen (Lógica original conservada)
        const storeDefinitions = [
          STORES.MENU, STORES.COMPANY, STORES.THEME, STORES.INGREDIENTS,
          STORES.CATEGORIES, STORES.CUSTOMERS, STORES.CAJAS,
          STORES.DELETED_MENU, STORES.DELETED_CUSTOMERS
        ];

        storeDefinitions.forEach(store => {
          if (!tempDb.objectStoreNames.contains(store)) {
            tempDb.createObjectStore(store, { keyPath: 'id' });
          }
        });

        if (!tempDb.objectStoreNames.contains(STORES.DELETED_SALES)) {
          tempDb.createObjectStore(STORES.DELETED_SALES, { keyPath: 'timestamp' });
        }

        if (!tempDb.objectStoreNames.contains(STORES.MOVIMIENTOS_CAJA)) {
          const movStore = tempDb.createObjectStore(STORES.MOVIMIENTOS_CAJA, { keyPath: 'id' });
          movStore.createIndex('caja_id', 'caja_id', { unique: false });
        }

        // Product Batches Store
        if (!tempDb.objectStoreNames.contains(STORES.PRODUCT_BATCHES)) {
          const batchStore = tempDb.createObjectStore(STORES.PRODUCT_BATCHES, { keyPath: 'id' });
          batchStore.createIndex('productId', 'productId', { unique: false });
          batchStore.createIndex('productId_isActive', ['productId', 'isActive'], { unique: false });
          batchStore.createIndex('expiryDate', 'expiryDate', { unique: false });
          batchStore.createIndex('createdAt', 'createdAt', { unique: false });
          batchStore.createIndex('sku', 'sku', { unique: false });
        } else if (event.oldVersion < 13) {
          const batchStore = event.target.transaction.objectStore(STORES.PRODUCT_BATCHES);
          if (!batchStore.indexNames.contains('sku')) {
            batchStore.createIndex('sku', 'sku', { unique: false });
          }
        }

        if (!tempDb.objectStoreNames.contains(STORES.SALES)) {
          const salesStore = tempDb.createObjectStore(STORES.SALES, { keyPath: 'timestamp' });
          salesStore.createIndex('customerId', 'customerId', { unique: false });
          salesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (event.oldVersion < 14) {
          // CORRECCIÓN: Usamos la transacción activa del evento
          const txn = event.target.transaction;
          const menuStore = txn.objectStore(STORES.MENU);

          // Ahora sí funcionará
          if (!menuStore.indexNames.contains('name_lower')) {
            menuStore.createIndex('name_lower', 'name_lower', { unique: false });
          }

          if (!menuStore.indexNames.contains('barcode')) {
            menuStore.createIndex('barcode', 'barcode', { unique: false });
          }
        }
      };

      request.onblocked = () => {
        console.warn('⚠️ Apertura de BD bloqueada. Cierra otras pestañas.');
        alert('Por favor, cierra otras pestañas de Lanzo POS para continuar.');
      };
    });

    dbConnection.openPromise.then(resolve).catch(reject);
  });
}

/**
 * Retry automático en operaciones
 */
async function executeWithRetry(operation, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // Si es error de conexión, intentar recuperar
      if (error.name === 'InvalidStateError' || error.name === 'NotFoundError' || error.name === 'TransactionInactiveError') {
        console.warn(`Reintento ${attempt} por error de conexión:`, error.name);
        dbConnection.instance = null;
        await new Promise(resolve => setTimeout(resolve, 200 * attempt));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

// ============================================================
// ✅ NUEVAS FUNCIONES OPTIMIZADAS (SOLUCIÓN AL PROBLEMA CRÍTICO)
// ============================================================

/**
 * Carga datos usando un cursor para paginación.
 * Evita cargar toda la base de datos en memoria.
 * * @param {string} storeName - Nombre del almacén.
 * @param {object} options - { limit, offset, indexName, range, direction }
 */
export function loadDataPaginated(storeName, { limit = 50, offset = 0, indexName = null, range = null, direction = 'next' } = {}) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      // Usar índice si se especifica, sino usar el store principal
      const source = indexName ? store.index(indexName) : store;

      const request = source.openCursor(range, direction);
      const results = [];
      let hasAdvanced = false;

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (!cursor) {
          resolve(results);
          return;
        }

        // Optimización: Saltar registros usando advance() nativo si hay offset
        if (offset > 0 && !hasAdvanced) {
          hasAdvanced = true;
          cursor.advance(offset);
          return;
        }

        // Recolectar datos hasta llegar al límite
        if (results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (event) => {
        console.error(`Error paginando ${storeName}:`, event.target.error);
        reject(event.target.error);
      };
    });
  });
}

/**
 * Búsqueda rápida usando índices.
 * Mucho más eficiente que filtrar arrays en memoria con .filter().
 * * @param {string} storeName - Nombre del almacén.
 * @param {string} indexName - Nombre del índice (ej: 'productId').
 * @param {any} value - Valor a buscar.
 * @param {number} limit - Límite opcional (default 100).
 */
export function queryByIndex(storeName, indexName, value, limit = 100) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const objectStore = transaction.objectStore(storeName);

      if (!objectStore.indexNames.contains(indexName)) {
        reject(new Error(`Índice '${indexName}' no existe en '${storeName}'`));
        return;
      }

      const index = objectStore.index(indexName);
      const range = IDBKeyRange.only(value);

      // getAll es muy rápido para búsquedas exactas
      const request = index.getAll(range, limit);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (event) => {
        console.error(`Error consultando índice ${indexName}:`, event.target.error);
        reject(event.target.error);
      };
    });
  });
}

// ============================================================
// FUNCIONES EXISTENTES (Mantenidas por compatibilidad)
// ============================================================

export function saveData(storeName, data) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      const normalizeItem = (item) => {
        if (storeName === STORES.MENU && item.name) {
          return { ...item, name_lower: item.name.toLowerCase() };
        }
        return item;
      };

      if (Array.isArray(data)) {
        data.forEach(item => store.put(normalizeItem(item)));
      } else {
        store.put(normalizeItem(data));
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });
  });
}

export function searchProductsInDB(term) {
  return executeWithRetry(async () => {
    const db = await initDB();
    const results = [];
    const limit = 50; // Traer máx 50 resultados para no saturar

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.MENU], 'readonly');
      const store = tx.objectStore(STORES.MENU);
      const index = store.index('name_lower');

      // Rango: Todo lo que empiece con el término
      // Ej: "coca" -> de "coca" a "coca" + caracter final unicode
      const lowerTerm = term.toLowerCase();
      const range = IDBKeyRange.bound(lowerTerm, lowerTerm + '\uffff');

      const request = index.openCursor(range);

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }

        const product = cursor.value;
        if (product.isActive !== false) { // Solo activos
          results.push(product);
        }
        cursor.continue();
      };

      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function loadData(storeName, key = null) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = key ? store.get(key) : store.getAll(); // ⚠️ Usar con cuidado en tablas grandes

      request.onsuccess = () => resolve(request.result || (key ? null : []));
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function deleteData(storeName, key) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export const saveBulk = saveData;

export function loadBulk(storeName, keys) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const results = [];
      let pending = keys.length;
      if (pending === 0) { resolve([]); return; }
      let hasError = false;

      keys.forEach(key => {
        if (hasError) return;
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result) results.push(request.result);
          pending--;
          if (pending === 0) resolve(results);
        };
        request.onerror = (e) => {
          hasError = true;
          reject(e.target.error);
        };
      });
    });
  });
}

export function closeDB() {
  if (dbConnection.instance) {
    try {
      dbConnection.instance.close();
      console.log('✅ Conexión de BD cerrada manualmente.');
    } catch (e) { console.warn(e); }
    dbConnection.instance = null;
  }
}

export async function checkDBHealth() {
  try {
    const db = await initDB();
    if (!isConnectionValid(db)) throw new Error('Conexión inválida');
    await loadData(STORES.COMPANY, 'company');
    return { healthy: true, message: 'BD funcionando correctamente' };
  } catch (error) {
    return { healthy: false, message: error.message };
  }
}