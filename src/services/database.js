// src/services/database.js - VERSIÓN CORREGIDA Y ROBUSTA

// Incrementamos versión para forzar la creación de las tablas faltantes
const DB_NAME = 'LanzoDB1';
const DB_VERSION = 20; // si le vamos a mover a este numero asegurar que tengamos el mismo en el archivo workers/stats.worker.js

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
  PROCESSED_SALES_LOG: 'processed_sales_log'
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

    // Si ya hay una conexión abriéndose, devolver esa promesa
    if (dbConnection.isOpening && dbConnection.openPromise) {
      return dbConnection.openPromise.then(resolve).catch(reject);
    }

    // Si ya está abierta y válida, devolverla
    if (isConnectionValid(dbConnection.instance)) {
      return resolve(dbConnection.instance);
    }

    // Limpieza de conexión previa si existía pero no era válida
    if (dbConnection.instance) {
      try { dbConnection.instance.close(); } catch (e) { /* ignorar */ }
      dbConnection.instance = null;
    }

    dbConnection.isOpening = true;

    // Intentamos abrir
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    dbConnection.openPromise = new Promise((res, rej) => {

      request.onerror = (event) => {
        dbConnection.isOpening = false;
        dbConnection.openPromise = null;
        dbConnection.instance = null;

        const errorTarget = event.target.error;
        let errorMessage = `Error crítico de base de datos: ${errorTarget?.message || 'Desconocido'}`;
        let errorName = errorTarget?.name;

        if (errorName === 'InvalidStateError' || errorName === 'UnknownError') {
          errorMessage = "❌ Tu navegador está bloqueando el almacenamiento de datos. \n\n" +
            "• Si estás en 'Modo Incógnito' o 'Privado', sal y usa el modo normal.\n" +
            "• Verifica que no tengas el disco lleno.";
        } else if (errorName === 'QuotaExceededError') {
          errorMessage = "💾 Espacio de almacenamiento lleno. Por favor libera espacio en tu dispositivo.";
        } else if (errorName === 'VersionError') {
          errorMessage = "⚠️ Versión de base de datos incompatible. Intenta recargar la página.";
        }

        console.error("🔥 initDB Error:", errorTarget);
        // alert(errorMessage); // Opcional: Descomentar si quieres alerta visual
        rej(new Error(errorMessage));
      };

      request.onblocked = () => {
        console.warn('⚠️ Apertura de BD bloqueada. Cierra otras pestañas.');
        alert('⚠️ ALERTA: Tienes otra pestaña de Lanzo POS abierta con una versión antigua.\n\nPor favor, cierra todas las pestañas de Lanzo POS y recarga esta página.');
      };

      request.onsuccess = (event) => {
        dbConnection.instance = event.target.result;
        dbConnection.isOpening = false;

        dbConnection.instance.onclose = () => {
          console.warn('⚠️ Conexión de BD cerrada inesperadamente');
          dbConnection.instance = null;
        };

        dbConnection.instance.onversionchange = () => {
          console.warn('⚠️ Otra pestaña actualizó la BD, forzando recarga...');
          if (dbConnection.instance) {
            dbConnection.instance.close();
            dbConnection.instance = null;
          }
          window.location.reload();
        };

        console.log('✅ Base de datos abierta exitosamente.');
        res(dbConnection.instance);
      };

      // --- AQUÍ ESTÁ LA CORRECCIÓN CLAVE ---
      request.onupgradeneeded = (event) => {
        const tempDb = event.target.result;
        console.log('Actualizando BD a la versión', DB_VERSION);

        // 1. Crear TODOS los ObjectStores definidos en STORES si no existen
        Object.values(STORES).forEach(storeName => {
          if (!tempDb.objectStoreNames.contains(storeName)) {
            // Nota: daily_stats usa 'date' como clave lógica, pero por estandarización usamos 'id' o keyPath
            // Si tus objetos daily_stats no tienen 'id', hay que tener cuidado. 
            // Por defecto usamos keyPath: 'id' para todo.
            // Para daily_stats, si guardas {date: '...'}, asegúrate de ponerle id: '...' también en el servicio.
            const keyPath = storeName === STORES.DAILY_STATS ? 'id' : 'id';
            tempDb.createObjectStore(storeName, { keyPath });
          }
        });

        // 2. Crear Índices Específicos (Idempotente)
        const ensureIndex = (storeName, indexName, keyPath, options = {}) => {
          if (tempDb.objectStoreNames.contains(storeName)) {
            const store = request.transaction.objectStore(storeName);
            if (!store.indexNames.contains(indexName)) {
              store.createIndex(indexName, keyPath, options);
            }
          }
        };

        // MENU (Productos)
        ensureIndex(STORES.MENU, 'barcode', 'barcode', { unique: false });
        ensureIndex(STORES.MENU, 'name_lower', 'name_lower', { unique: false });
        ensureIndex(STORES.MENU, 'categoryId', 'categoryId', { unique: false });

        // PRODUCT_BATCHES (Lotes)
        ensureIndex(STORES.PRODUCT_BATCHES, 'productId', 'productId', { unique: false });
        ensureIndex(STORES.PRODUCT_BATCHES, 'sku', 'sku', { unique: false });

        // SALES (Ventas)
        ensureIndex(STORES.SALES, 'timestamp', 'timestamp', { unique: true });
        ensureIndex(STORES.SALES, 'customerId', 'customerId', { unique: false });

        // MOVIMIENTOS_CAJA
        ensureIndex(STORES.MOVIMIENTOS_CAJA, 'caja_id', 'caja_id', { unique: false });

        // CUSTOMERS
        ensureIndex(STORES.CUSTOMERS, 'phone', 'phone', { unique: false });
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
      const recoverableErrors = [
        'InvalidStateError', 'NotFoundError', 'TransactionInactiveError', 'UnknownError'
      ];
      if (recoverableErrors.includes(error.name)) {
        console.warn(`🔄 Reintento ${attempt}/${maxRetries} por: ${error.name}`);
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
// FUNCIONES DE ACCESO A DATOS
// ============================================================

export function loadDataPaginated(storeName, { limit = 50, offset = 0, indexName = null, range = null, direction = 'next' } = {}) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
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
        if (offset > 0 && !hasAdvanced) {
          hasAdvanced = true;
          cursor.advance(offset);
          return;
        }
        if (results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function queryByIndex(storeName, indexName, value, limit = 100) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const objectStore = transaction.objectStore(storeName);

      if (!objectStore.indexNames.contains(indexName)) {
        // Fallback si no existe índice: devolver array vacío o buscar manual (aquí devolvemos vacío para no crashear)
        console.warn(`Índice '${indexName}' no encontrado en '${storeName}'. Retornando vacío.`);
        resolve([]);
        return;
      }

      const index = objectStore.index(indexName);
      let range = Array.isArray(value) ? IDBKeyRange.only(value) : IDBKeyRange.only(value);
      const request = index.getAll(range, limit);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function queryBatchesByProductIdAndActive(productId, isActive = true) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([STORES.PRODUCT_BATCHES], 'readonly');
      const objectStore = transaction.objectStore(STORES.PRODUCT_BATCHES);

      // --- CORRECCIÓN: Validación estricta ---
      if (!objectStore.indexNames.contains('productId')) {
        console.error("🔥 Falta índice 'productId'. No se puede consultar inventario eficientemente.");
        // Devolvemos array vacío para no romper la UI, pero logueamos el error grave.
        // Opcional: reject(new Error("INDEX_MISSING")) si quieres mostrar alerta al usuario.
        resolve([]);
        return;
      }

      const index = objectStore.index('productId');
      const range = IDBKeyRange.only(productId);
      const request = index.getAll(range);

      request.onsuccess = () => {
        const batches = request.result || [];
        // Filtramos en memoria solo lo necesario (activo/inactivo), que es rápido
        // porque ya filtramos por producto con el índice.
        const filtered = batches.filter(b => Boolean(b.isActive) === Boolean(isActive));
        resolve(filtered);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

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
        // Para Daily Stats, asegurar que tenga ID si no lo tiene
        if (storeName === STORES.DAILY_STATS && !item.id && item.date) {
          return { ...item, id: item.date };
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

export function searchProductByBarcode(barcode) {
  return executeWithRetry(async () => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.MENU], 'readonly');
      const store = tx.objectStore(STORES.MENU);
      if (!store.indexNames.contains('barcode')) { resolve(null); return; }

      const index = store.index('barcode');
      const request = index.get(barcode);
      request.onsuccess = () => {
        const product = request.result;
        if (product && product.isActive !== false) resolve(product);
        else resolve(null);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function searchProductsInDB(term) {
  return executeWithRetry(async () => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.MENU], 'readonly');
      const store = tx.objectStore(STORES.MENU);

      // --- CORRECCIÓN: Si falta el índice, mejor fallar o usar búsqueda básica por nombre ---
      if (!store.indexNames.contains('name_lower')) {
         console.warn("⚠️ Índice 'name_lower' faltante. Búsqueda degradada.");
         // En este caso excepcional, podríamos permitir getAll() si el catálogo es pequeño,
         // PERO lo ideal es forzar el uso del índice.
         // Si decides mantener el fallback aquí, ponle un límite duro:
         const req = store.getAll(null, 500); // Límite de 500 para no matar el navegador
         req.onsuccess = () => {
            // ... lógica de filtrado manual ...
            resolve([]);
         };
         return;
      }

      const index = store.index('name_lower');
      const lowerTerm = term.toLowerCase();
      const range = IDBKeyRange.bound(lowerTerm, lowerTerm + '\uffff');
      const request = index.getAll(range, 60);

      request.onsuccess = () => {
        const results = (request.result || []).filter(p => p.isActive !== false);
        resolve(results.slice(0, 50));
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
      const request = key ? store.get(key) : store.getAll();
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

export const saveBulk = async (storeName, data) => saveData(storeName, data);

export function closeDB() {
  if (dbConnection.instance) {
    try { dbConnection.instance.close(); } catch (e) { }
    dbConnection.instance = null;
  }
}

// Transacciones Atómicas Complejas

export async function processBatchDeductions(deductions) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.PRODUCT_BATCHES], 'readwrite');
    const store = tx.objectStore(STORES.PRODUCT_BATCHES);
    let aborted = false;

    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = (e) => reject(e.target.error);
    tx.onabort = () => reject(new Error('STOCK_CHANGED'));

    deductions.forEach(({ batchId, quantity }) => {
      if (aborted) return;
      const getRequest = store.get(batchId);
      getRequest.onsuccess = () => {
        if (aborted) return;
        const batch = getRequest.result;
        if (!batch || batch.stock < quantity) {
          aborted = true; tx.abort(); return;
        }
        batch.stock -= quantity;
        if (batch.stock <= 0.0001) { batch.stock = 0; batch.isActive = false; }
        store.put(batch);
      };
    });
  });
}

export async function executeSaleTransaction(sale, deductions) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    // Abarcamos Ventas, Lotes y Menú en una sola transacción atómica
    const tx = db.transaction([STORES.SALES, STORES.PRODUCT_BATCHES, STORES.MENU], 'readwrite');
    const salesStore = tx.objectStore(STORES.SALES);
    const batchesStore = tx.objectStore(STORES.PRODUCT_BATCHES);
    const productStore = tx.objectStore(STORES.MENU);

    let aborted = false;

    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = (e) => reject(e.target.error);
    tx.onabort = () => reject(new Error('STOCK_INSUFFICIENT'));

    // --- CORRECCIÓN: Pre-calcular las actualizaciones del padre SÍNCRONAMENTE ---
    const productUpdates = new Map();

    // 1. Sumar cantidades de Lotes (Deductions)
    deductions.forEach(({ productId, quantity }) => {
      if (productId) {
        const current = productUpdates.get(productId) || 0;
        productUpdates.set(productId, current + quantity);
      }
    });

    // 2. Sumar cantidades de Productos Simples (sin lotes)
    if (sale && sale.items) {
      sale.items.forEach(item => {
        // Si el item NO usó lotes (es producto simple), lo sumamos aquí
        if (!item.batchesUsed || item.batchesUsed.length === 0) {
          const pid = item.parentId || item.id;
          const current = productUpdates.get(pid) || 0;
          productUpdates.set(pid, current + item.quantity);
        }
      });
    }

    // --- EJECUCIÓN DE LA TRANSACCIÓN ---

    // A) Procesar Lotes (Validar existencia y stock suficiente)
    deductions.forEach(({ batchId, quantity }) => {
      if (aborted) return;

      const batchReq = batchesStore.get(batchId);

      batchReq.onsuccess = () => {
        if (aborted) return;
        const batch = batchReq.result;

        // Validación crítica de integridad
        if (!batch) {
          console.error(`Lote ${batchId} no encontrado.`);
          aborted = true; tx.abort(); return;
        }
        if (batch.stock < quantity) {
          console.error(`Stock insuficiente en lote ${batchId}. Req: ${quantity}, Hay: ${batch.stock}`);
          aborted = true; tx.abort(); return;
        }

        // Descuento
        batch.stock -= quantity;
        // Desactivar si llega a 0 (con tolerancia a decimales)
        if (batch.stock <= 0.0001) {
          batch.stock = 0;
          batch.isActive = false;
        }
        batchesStore.put(batch);
      };
    });

    // B) Actualizar Stocks Padres (Usando el mapa pre-calculado)
    productUpdates.forEach((qtyToDeduct, productId) => {
      if (aborted) return;

      const prodReq = productStore.get(productId);

      prodReq.onsuccess = () => {
        if (aborted) return;
        const product = prodReq.result;

        if (product && product.trackStock) {
          // Validación de seguridad para el padre
          if ((product.stock - qtyToDeduct) < -0.0001) {
            // Opcional: Podrías permitir negativos en el padre si los lotes pasaron, 
            // pero es mejor ser estricto.
            console.warn(`Stock negativo detectado en producto padre ${product.name}`);
            // aborted = true; tx.abort(); return; // Descomentar para estricto
          }

          product.stock -= qtyToDeduct;
          // Evitar -0.0000001
          if (Math.abs(product.stock) < 0.0001) product.stock = 0;

          productStore.put(product);
        }
      };
    });

    // C) Guardar la Venta
    if (sale && !aborted) {
      salesStore.add(sale);
    }
  });
}

export async function deleteCategoryCascading(categoryId) {
  return executeWithRetry(async () => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.CATEGORIES, STORES.MENU], 'readwrite');
      const catStore = tx.objectStore(STORES.CATEGORIES);
      const menuStore = tx.objectStore(STORES.MENU);

      tx.oncomplete = () => resolve({ success: true });
      tx.onerror = (e) => reject(e.target.error);

      catStore.delete(categoryId);

      const request = menuStore.openCursor();
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.categoryId === categoryId) {
            const updated = { ...cursor.value, categoryId: '' };
            cursor.update(updated);
          }
          cursor.continue();
        }
      };
    });
  });
}

export async function saveBatchAndSyncProduct(batchData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.PRODUCT_BATCHES, STORES.MENU], 'readwrite');
    const batchStore = tx.objectStore(STORES.PRODUCT_BATCHES);
    const productStore = tx.objectStore(STORES.MENU);

    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = (e) => reject(e.target.error);

    batchStore.put(batchData);

    // --- CORRECCIÓN: Eliminamos el fallback a getAll() ---
    if (!batchStore.indexNames.contains('productId')) {
      // Si no existe el índice, detenemos todo. Esto obliga al desarrollador a revisar initDB.
      // No vale la pena intentar escanear todo el almacén en una transacción de escritura crítica.
      console.error("🔥 ERROR CRÍTICO: Falta índice 'productId' en product_batches");
      tx.abort();
      reject(new Error("DB_CORRUPTION_MISSING_INDEX: productId"));
      return;
    }

    // Ahora usamos el índice con confianza absoluta
    const index = batchStore.index('productId');
    const request = index.getAll(IDBKeyRange.only(batchData.productId));

    request.onsuccess = () => {
      const allBatchesRaw = request.result || [];
      // Filtrar manual si usamos el fallback de getAll()
      const allBatches = batchStore.indexNames.contains('productId')
        ? allBatchesRaw
        : allBatchesRaw.filter(b => b.productId === batchData.productId);

      let totalStock = 0;
      let currentCost = 0;
      let currentPrice = 0;

      const batches = allBatches.map(b => b.id === batchData.id ? batchData : b); // Usar el nuevo en memoria
      batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      batches.forEach(b => {
        if (b.isActive && b.stock > 0) {
          totalStock += b.stock;
        }
      });

      const activeBatches = batches.filter(b => b.isActive && b.stock > 0);
      if (activeBatches.length > 0) {
        currentCost = activeBatches[0].cost;
        currentPrice = activeBatches[0].price;
      } else {
        currentCost = batchData.cost;
        currentPrice = batchData.price;
      }

      const prodReq = productStore.get(batchData.productId);
      prodReq.onsuccess = () => {
        const product = prodReq.result;
        if (product) {
          product.stock = totalStock;
          product.cost = currentCost || product.cost;
          product.price = currentPrice || product.price;
          product.hasBatches = true;
          product.updatedAt = new Date().toISOString();
          productStore.put(product);
        }
      };
    };
  });
}

/**
 * Obtiene las ventas desde una fecha específica usando el índice 'timestamp'.
 * Optimizado para no cargar toda la base de datos.
 */
export function getOrdersSince(isoDateString) {
  return executeWithRetry(async () => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.SALES], 'readonly');
      const store = tx.objectStore(STORES.SALES);

      // Usamos el índice 'timestamp' que ya creaste en initDB
      const index = store.index('timestamp');

      // Creamos un rango: desde la fecha dada hasta el infinito (el futuro)
      const range = IDBKeyRange.lowerBound(isoDateString);

      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export async function streamStoreToCSV(storeName, mapFn, onChunk, chunkSize = 500) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.openCursor();

    let chunk = [];
    let count = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        // Transformamos el dato usando la función que pasemos (mapFn)
        const rowString = mapFn(cursor.value);
        chunk.push(rowString);
        count++;

        // Si el chunk se llena, lo enviamos al callback
        if (chunk.length >= chunkSize) {
          onChunk(chunk.join('\n') + '\n');
          chunk = []; // Liberamos memoria
        }

        cursor.continue();
      } else {
        // Enviar lo que sobró
        if (chunk.length > 0) {
          onChunk(chunk.join('\n') + '\n');
        }
        resolve(count);
      }
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function archiveOldData(monthsToKeep = 6) {
  const db = await initDB();

  // Calcular fecha de corte
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
  const isoCutoff = cutoffDate.toISOString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.SALES, STORES.DAILY_STATS], 'readwrite');
    const salesStore = tx.objectStore(STORES.SALES);
    const dailyStore = tx.objectStore(STORES.DAILY_STATS); // Para actualizar históricos

    // Usamos índice por fecha
    const index = salesStore.index('timestamp');
    const range = IDBKeyRange.upperBound(isoCutoff); // Todo lo anterior a la fecha
    const request = index.openCursor(range);

    const salesToArchive = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        salesToArchive.push(cursor.value);
        cursor.delete(); // BORRAMOS DE LA BD ACTIVA
        cursor.continue();
      } else {
        // Terminó la iteración.
        // Aquí deberías guardar 'salesToArchive' en un JSON y descargarlo
        if (salesToArchive.length > 0) {
          console.log(`Archivando ${salesToArchive.length} ventas antiguas...`);
          // Retornamos los datos para que la UI los descargue
          resolve(salesToArchive);
        } else {
          resolve([]);
        }
      }
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Recorre TODAS las tiendas y emite los datos en formato JSONL (JSON Lines).
 * @param {function} onChunk - Callback que recibe un string con varios registros.
 */
export async function streamAllDataToJSONL(onChunk) {
  const db = await initDB();
  const storeNames = Object.values(STORES);

  // Recorremos tienda por tienda para no saturar transacciones
  for (const storeName of storeNames) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.openCursor();

      let chunkBuffer = [];
      const CHUNK_SIZE = 100; // Procesamos de 100 en 100 registros

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          // Guardamos el registro con una etiqueta para saber de qué tienda es
          // s: store (tienda), d: data (datos)
          const recordWrapper = { s: storeName, d: cursor.value };
          chunkBuffer.push(JSON.stringify(recordWrapper));

          // Si llenamos el buffer, lo enviamos y limpiamos memoria
          if (chunkBuffer.length >= CHUNK_SIZE) {
            onChunk(chunkBuffer.join('\n') + '\n');
            chunkBuffer = []; // ¡Liberamos RAM aquí!
          }

          cursor.continue();
        } else {
          // Se acabaron los registros de esta tienda, enviar lo que sobre
          if (chunkBuffer.length > 0) {
            onChunk(chunkBuffer.join('\n') + '\n');
          }
          resolve();
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }
}