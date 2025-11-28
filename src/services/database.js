// src/services/database.js - VERSIÓN OPTIMIZADA PARA PAGINACIÓN

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 17;

// Objeto de conexión
const dbConnection = {
  instance: null,
  isOpening: false,
  openPromise: null
};

export const STORES = {
  MENU: 'menu',
  SALES: 'sales',
  STATS: 'global_stats',
  COMPANY: 'company',
  THEME: 'theme',
  INGREDIENTS: 'ingredients',
  CATEGORIES: 'categories',
  CUSTOMERS: 'customers',
  CAJAS: 'cajas',
  DELETED_MENU: 'deleted_menu',
  DELETED_CUSTOMERS: 'deleted_customers',
  DELETED_SALES: 'deleted_sales',
  DELETED_CATEGORIES: 'deleted_categories',
  MOVIMIENTOS_CAJA: 'movimientos_caja',
  PRODUCT_BATCHES: 'product_batches',
  WASTE: 'waste_logs',
  DAILY_STATS: 'daily_stats',
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
          STORES.DELETED_MENU, STORES.DELETED_CUSTOMERS,
          STORES.DELETED_CATEGORIES
        ];

        storeDefinitions.forEach(store => {
          if (!tempDb.objectStoreNames.contains(store)) {
            tempDb.createObjectStore(store, { keyPath: 'id' });
          }
        });

        if (!tempDb.objectStoreNames.contains(STORES.STATS)) {
          tempDb.createObjectStore(STORES.STATS, { keyPath: 'id' });
        }

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
        } else if (event.oldVersion < 17) {
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

        if (!tempDb.objectStoreNames.contains(STORES.WASTE)) {
          const wasteStore = tempDb.createObjectStore(STORES.WASTE, { keyPath: 'id' });
          wasteStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!tempDb.objectStoreNames.contains(STORES.DAILY_STATS)) {
          // KeyPath será la fecha string YYYY-MM-DD
          tempDb.createObjectStore(STORES.DAILY_STATS, { keyPath: 'date' });
        }

        if (event.oldVersion < 17) {
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

      // Lista de errores recuperables
      const recoverableErrors = [
        'InvalidStateError',
        'NotFoundError',
        'TransactionInactiveError',
        'UnknownError' // ✅ Agregado
      ];

      if (recoverableErrors.includes(error.name)) {
        console.warn(`🔄 Reintento ${attempt}/${maxRetries} por: ${error.name}`);
        dbConnection.instance = null;
        await new Promise(resolve => setTimeout(resolve, 200 * attempt));
      } else {
        // Error no recuperable, lanzar inmediatamente
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
 * Soporta valores simples y arrays compuestos (para índices compuestos).
 * @param {string} storeName - Nombre del almacén.
 * @param {string} indexName - Nombre del índice (ej: 'productId' o 'productId_isActive').
 * @param {any} value - Valor a buscar. Puede ser un valor simple o un array [productId, isActive].
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

      // Si value es un array (índice compuesto), usar IDBKeyRange.only con el array
      // Si es un valor simple, usar IDBKeyRange.only normal
      let range;
      if (Array.isArray(value)) {
        // Para índices compuestos, necesitamos usar el array completo
        range = IDBKeyRange.only(value);
      } else {
        range = IDBKeyRange.only(value);
      }

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

/**
 * Query por índice compuesto específicamente para productId + isActive
 * Esto maneja correctamente el caso donde isActive es un booleano en JavaScript
 * pero se guarda como 1/0 en IndexedDB
 */
export function queryBatchesByProductIdAndActive(productId, isActive = true) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([STORES.PRODUCT_BATCHES], 'readonly');
      const objectStore = transaction.objectStore(STORES.PRODUCT_BATCHES);

      // Usamos el índice 'productId' que es seguro (string/texto)
      // y filtramos por 'isActive' en memoria. Esto es rápido y evita el crash.
      const index = objectStore.index('productId');
      const range = IDBKeyRange.only(productId);
      const request = index.getAll(range);

      request.onsuccess = () => {
        const batches = request.result || [];
        // Filtrar manual en JavaScript (soporta true, 1, "true", etc.)
        const filtered = batches.filter(b => {
          // Convertimos ambos a booleano para asegurar la comparación
          return Boolean(b.isActive) === Boolean(isActive);
        });
        resolve(filtered);
      };

      request.onerror = (event) => reject(event.target.error);
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

/**
 * Busca un producto por código de barras usando el índice 'barcode'
 * Mucho más eficiente que cargar toda la BD
 */
export function searchProductByBarcode(barcode) {
  return executeWithRetry(async () => {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.MENU], 'readonly');
      const store = tx.objectStore(STORES.MENU);

      // Verificar que el índice existe
      if (!store.indexNames.contains('barcode')) {
        // Fallback: retornar null si no hay índice
        resolve(null);
        return;
      }

      const index = store.index('barcode');
      const request = index.get(barcode);

      request.onsuccess = () => {
        const product = request.result;
        // Solo retornar si está activo
        if (product && product.isActive !== false) {
          resolve(product);
        } else {
          resolve(null);
        }
      };

      request.onerror = (e) => reject(e.target.error);
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

export const saveBulk = saveBulkOptimized;

export function saveBulkOptimized(storeName, data, chunkSize = 100) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();

    if (!Array.isArray(data) || data.length === 0) {
      return;
    }

    // Helper interno para mantener la lógica de búsqueda
    const normalizeItem = (item) => {
      if (storeName === STORES.MENU && item.name) {
        return { ...item, name_lower: item.name.toLowerCase() };
      }
      return item;
    };

    // Procesar en chunks para no bloquear el thread principal
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);

      await new Promise((resolve, reject) => {
        const transaction = dbInstance.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
        transaction.onabort = (e) => reject(new Error('Transacción abortada'));

        chunk.forEach(item => {
          const normalized = normalizeItem(item);
          // Usamos put para crear o actualizar
          const request = store.put(normalized);

          request.onerror = (e) => {
            // Logueamos pero no rechazamos toda la transacción por un item fallido individual
            // a menos que sea error crítico de estructura
            console.error('Error guardando item en bulk:', normalized.id, e.target.error);
          };
        });
      });

      // "Yield" al event loop para que la UI no se congele
      if (i + chunkSize < data.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  });
}

/**
 * Procesa múltiples descuentos de stock en una sola transacción atómica.
 * Garantiza integridad: Si un lote falla, NINGUNO se descuenta (Rollback).
 */
export async function processBatchDeductions(deductions) {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    // 1. Abrimos una transacción que abarca todos los lotes
    const transaction = db.transaction([STORES.PRODUCT_BATCHES], 'readwrite');
    const store = transaction.objectStore(STORES.PRODUCT_BATCHES);

    // Contenedor para errores internos
    let aborted = false;

    transaction.oncomplete = () => resolve({ success: true });
    transaction.onerror = (e) => reject(e.target.error);
    transaction.onabort = (e) => reject(new Error('Transacción abortada: Stock insuficiente o error de escritura.'));

    // 2. Iteramos sobre los descuentos DENTRO de la transacción
    deductions.forEach(({ batchId, quantity }) => {
      if (aborted) return;

      const getRequest = store.get(batchId);

      getRequest.onsuccess = () => {
        const batch = getRequest.result;

        if (!batch) {
          aborted = true;
          transaction.abort(); // Cancelar TODO si falta un lote
          return;
        }

        if (batch.stock < quantity) {
          console.error(`Stock insuficiente en lote ${batchId}. Stock: ${batch.stock}, Req: ${quantity}`);
          aborted = true;
          transaction.abort(); // Cancelar TODO si falta stock
          return;
        }

        // Aplicar descuento
        batch.stock -= quantity;
        if (batch.stock <= 0.0001) {
          batch.stock = 0;
          batch.isActive = false;
        }

        // Guardar actualización
        store.put(batch);
      };

      getRequest.onerror = () => {
        aborted = true;
        transaction.abort();
      };
    });
  });
}

export async function deleteCategoryCascading(categoryId) {
  return executeWithRetry(async () => {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      // 1. Abrimos una transacción que abarca AMBOS almacenes
      const tx = db.transaction([STORES.CATEGORIES, STORES.MENU], 'readwrite');
      const catStore = tx.objectStore(STORES.CATEGORIES);
      const menuStore = tx.objectStore(STORES.MENU);

      // 2. Manejadores de éxito/error global de la transacción
      tx.oncomplete = () => resolve({ success: true });
      tx.onerror = (e) => reject(e.target.error);

      // 3. Eliminar la categoría
      catStore.delete(categoryId);

      // 4. Buscar y limpiar productos afectados usando un Cursor
      // (Más eficiente que cargar todo en memoria)
      const index = menuStore.index('categoryId'); // Asumiendo que existe índice, si no, usamos cursor normal
      // Si no tienes índice 'categoryId' definido en initDB, usamos cursor sobre todo el store (fallback)
      // Nota: En tu código actual no vi índice 'categoryId', así que usaremos cursor general seguro.

      const request = menuStore.openCursor();

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const product = cursor.value;
          if (product.categoryId === categoryId) {
            // ¡Encontramos uno! Lo actualizamos dentro de la MISMA transacción
            const updatedProduct = { ...product, categoryId: '' };
            cursor.update(updatedProduct);
          }
          cursor.continue();
        }
      };
    });
  });
}

export function deleteBulk(storeName, keys, chunkSize = 100) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();

    if (!Array.isArray(keys) || keys.length === 0) {
      return;
    }

    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);

      await new Promise((resolve, reject) => {
        const transaction = dbInstance.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);

        chunk.forEach(key => {
          store.delete(key);
        });
      });

      if (i + chunkSize < keys.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
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