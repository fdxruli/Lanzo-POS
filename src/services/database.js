// src/services/database.js - VERSIÓN CORREGIDA Y ROBUSTA

// Incrementamos versión para forzar la creación de las tablas faltantes
const DB_NAME = 'LanzoDB1';
const DB_VERSION = 25; // si le vamos a mover a este numero asegurar que tengamos el mismo en el archivo workers/stats.worker.js

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
  PROCESSED_SALES_LOG: 'processed_sales_log',
  TRANSACTION_LOG: 'transaction_log',
  SYNC_CACHE: 'sync_cache',
  IMAGES: 'images',
};

// ============================================================
// SISTEMA DE ERRORES (AUDITORÍA)
// ============================================================

export class DatabaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export const DB_ERROR_CODES = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_STATE: 'INVALID_STATE',
  NOT_FOUND: 'NOT_FOUND',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  TRANSACTION_INACTIVE: 'TRANSACTION_INACTIVE',
  VERSION_ERROR: 'VERSION_ERROR',
  BLOCKED: 'BLOCKED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Función interna para clasificar errores de IndexedDB
 */
function classifyError(error, storeName, operation) {
  let errorCode = DB_ERROR_CODES.UNKNOWN;
  let userMessage = 'Ocurrió un error inesperado en la base de datos.';
  let actionable = null;

  const errName = error.name || '';
  const errMsg = error.message || '';

  if (errName === 'QuotaExceededError' || errMsg.includes('quota')) {
    errorCode = DB_ERROR_CODES.QUOTA_EXCEEDED;
    userMessage = '💾 Espacio lleno. El navegador no permite guardar más datos. Libera espacio o realiza un respaldo y limpieza.';
    actionable = 'SUGGEST_BACKUP';
  } else if (errName === 'InvalidStateError' || errName === 'TransactionInactiveError') {
    errorCode = DB_ERROR_CODES.INVALID_STATE;
    userMessage = '⚠️ Conexión interrumpida con la base de datos. Por favor, recarga la página.';
    actionable = 'SUGGEST_RELOAD';
  } else if (errName === 'ConstraintError') {
    errorCode = DB_ERROR_CODES.CONSTRAINT_VIOLATION;
    userMessage = '⚠️ Duplicado: Ya existe un registro con este ID, Código de Barras o SKU.';
    actionable = 'SUGGEST_EDIT';
  } else if (errName === 'VersionError') {
    errorCode = DB_ERROR_CODES.VERSION_ERROR;
    userMessage = '⚠️ La base de datos está desactualizada. Cierra todas las pestañas y vuelve a abrir.';
    actionable = 'SUGGEST_RELOAD';
  } else if (errMsg.includes('TIMEOUT')) {
    errorCode = DB_ERROR_CODES.TIMEOUT;
    userMessage = '⏱️ La operación tardó demasiado. Intenta de nuevo.';
  }

  // Log técnico para depuración
  console.error(`[DB_ERROR:${errorCode}] Store: ${storeName} | Op: ${operation}`, {
    originalError: error,
    message: errMsg
  });

  return new DatabaseError(errorCode, userMessage, {
    storeName,
    originalError: errMsg,
    actionable
  });
}

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
      try { dbConnection.instance.close(); } catch (e) { }
      dbConnection.instance = null;
    }
    if (dbConnection.instance) {
      // VALIDACIÓN CLAVE: Verificar si la conexión sigue viva
      // A veces el objeto existe pero la conexión interna está 'closed'
      try {
        // Intentamos una transacción dummy muy ligera
        const tx = dbConnection.instance.transaction([STORES.MENU], 'readonly');
        tx.abort(); // Si no falla al crearla, está viva. Abortamos para no gastar.
        return resolve(dbConnection.instance);
      } catch (error) {
        console.warn("⚠️ Conexión IDB perdida en segundo plano. Reconectando...", error);
        dbConnection.instance = null; // Forzamos reconexión
      }
    }

    dbConnection.isOpening = true;
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    dbConnection.openPromise = new Promise((res, rej) => {
      request.onerror = (event) => {
        dbConnection.isOpening = false;
        rej(event.target.error);
      };

      request.onblocked = () => {
        alert('⚠️ Actualización de base de datos pendiente. Cierra otras pestañas de Lanzo POS.');
      };

      request.onsuccess = (event) => {
        dbConnection.instance = event.target.result;
        dbConnection.isOpening = false;
        res(dbConnection.instance);
        recoverPendingTransactions().catch(console.error);
      };

      // ✅ PASO 2: Aquí aplicamos la solución de la auditoría
      request.onupgradeneeded = (event) => {
        const tempDb = event.target.result;
        console.log('Actualizando BD a la versión', DB_VERSION);

        // 1. Crear almacenes si no existen
        Object.values(STORES).forEach(storeName => {
          if (!tempDb.objectStoreNames.contains(storeName)) {
            // SYNC_CACHE usa 'key' como índice porque guardaremos por nombre (ej: "devices_LANZO-123")
            const keyPath = storeName === STORES.SYNC_CACHE ? 'key' : 'id';
            tempDb.createObjectStore(storeName, { keyPath });
          }
        });

        const tx = request.transaction;

        // Función auxiliar segura para crear índices
        const ensureIndex = (storeName, indexName, keyPath, options = {}) => {
          if (tempDb.objectStoreNames.contains(storeName)) {
            const store = tx.objectStore(storeName);
            if (!store.indexNames.contains(indexName)) {
              console.log(`Creando índice: ${indexName} en ${storeName}`);
              store.createIndex(indexName, keyPath, options);
            }
          }
        };

        // --- ÍNDICES BÁSICOS (Existentes) ---
        ensureIndex(STORES.MENU, 'barcode', 'barcode', { unique: false });
        ensureIndex(STORES.MENU, 'name_lower', 'name_lower', { unique: false });
        ensureIndex(STORES.MENU, 'categoryId', 'categoryId', { unique: false });
        ensureIndex(STORES.PRODUCT_BATCHES, 'productId', 'productId', { unique: false });
        ensureIndex(STORES.PRODUCT_BATCHES, 'sku', 'sku', { unique: false });
        ensureIndex(STORES.SALES, 'timestamp', 'timestamp', { unique: true });
        ensureIndex(STORES.SALES, 'customerId', 'customerId', { unique: false }); // Básico existente
        ensureIndex(STORES.MOVIMIENTOS_CAJA, 'caja_id', 'caja_id', { unique: false });
        ensureIndex(STORES.CUSTOMERS, 'phone', 'phone', { unique: false });
        ensureIndex(STORES.TRANSACTION_LOG, 'status', 'status', { unique: false });
        ensureIndex(STORES.TRANSACTION_LOG, 'timestamp', 'timestamp', { unique: false });

        // --- 🚀 MEJORAS DE LA AUDITORÍA (Nuevos Índices Compuestos) ---

        // A. SALES: Para filtrar pedidos por estado (KDS) y por Cliente+Fecha
        ensureIndex(STORES.SALES, 'fulfillment_status', 'fulfillmentStatus', { unique: false });
        ensureIndex(STORES.SALES, 'customer_date', ['customerId', 'timestamp'], { unique: false });

        // B. PRODUCT_BATCHES: Para selección FIFO ultra-rápida (Producto + Activo + Fecha Creación)
        ensureIndex(STORES.PRODUCT_BATCHES, 'product_active_date', ['productId', 'isActive', 'createdAt'], { unique: false });

        // C. CAJAS: Para encontrar la caja abierta actual sin recorrer todo el historial
        ensureIndex(STORES.CAJAS, 'estado', 'estado', { unique: false });
      };
    });

    dbConnection.openPromise.then(resolve).catch(reject);
  });
}

// ============================================================
// WRAPPERS SEGUROS (SAFE) - IMPLEMENTACIÓN DE LA AUDITORÍA
// ============================================================

/**
 * Guarda un registro de forma segura, retornando un objeto de resultado estructurado.
 */
export async function saveDataSafe(storeName, data) {
  try {
    await saveData(storeName, data);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: classifyError(error, storeName, 'saveData')
    };
  }
}

/**
 * Guarda múltiples registros de forma segura.
 */
export async function saveBulkSafe(storeName, dataArray) {
  try {
    await saveBulk(storeName, dataArray);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: classifyError(error, storeName, 'saveBulk')
    };
  }
}

export async function executeSaleTransactionSafe(sale, deductions) {
  try {
    const result = await executeSaleTransaction(sale, deductions);
    return { success: true, transactionId: result.transactionId };
  } catch (error) {
    // Si es un error de lógica de negocio (Stock cambió), lo dejamos pasar tal cual
    if (error.message === 'STOCK_CHANGED' || error.message === 'TRANSACTION_ABORTED_OR_STOCK_ERROR') {
      // Retornamos un objeto de error específico para que salesService sepa que fue concurrencia
      return { success: false, isConcurrencyError: true, originalError: error };
    }

    // Para errores técnicos (Disco, DB cerrada), usamos el clasificador
    return {
      success: false,
      error: classifyError(error, STORES.SALES, 'executeSaleTransaction')
    };
  }
}

/**
 * Elimina un registro de forma segura.
 */
export async function deleteDataSafe(storeName, key) {
  try {
    await deleteData(storeName, key);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: classifyError(error, storeName, 'deleteData')
    };
  }
}

/**
 * Wrapper especial para la función compleja de lotes.
 */
export async function saveBatchAndSyncProductSafe(batchData) {
  try {
    await saveBatchAndSyncProduct(batchData);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: classifyError(error, STORES.PRODUCT_BATCHES, 'saveBatchAndSyncProduct')
    };
  }
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

export async function saveImageToDB(id, blob) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.IMAGES], 'readwrite');
    const store = tx.objectStore(STORES.IMAGES);
    //Guardamos el blob
    const request = store.put({ id, blob });
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function getImageFromDB(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.IMAGES], 'readonly');
    const store = tx.objectStore(STORES.IMAGES);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = () => resolve(null);
  });
}

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
  const TRANSACTION_TIMEOUT = 15000; // 5 segundos máximo

  return new Promise((resolve, reject) => {
    // Incluimos TRANSACTION_LOG en la transacción atómica
    const tx = db.transaction(
      [STORES.SALES, STORES.PRODUCT_BATCHES, STORES.MENU, STORES.TRANSACTION_LOG],
      'readwrite'
    );

    const salesStore = tx.objectStore(STORES.SALES);
    const batchesStore = tx.objectStore(STORES.PRODUCT_BATCHES);
    const productStore = tx.objectStore(STORES.MENU);
    const logStore = tx.objectStore(STORES.TRANSACTION_LOG);

    let aborted = false;
    let completed = false;

    // A. TIMEOUT DE SEGURIDAD
    const timeoutId = setTimeout(() => {
      if (!completed && !aborted) {
        console.error('⏱️ Transacción excedió timeout (5s)');
        aborted = true;
        try {
          tx.abort();
        } catch (e) {
          console.warn("No se pudo abortar (posiblemente ya finalizó):", e);
        }
        reject(new Error('TRANSACTION_TIMEOUT'));
      }
    }, TRANSACTION_TIMEOUT);

    // B. GENERAR ID Y LOG (Write-Ahead Log dentro de la transacción)
    // Si la transacción falla, este log también se borra (atomicidad),
    // pero si se comete y falla el código posterior (UI), queda rastro.
    const transactionId = `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    logStore.add({
      id: transactionId,
      type: 'SALE',
      status: 'PENDING',
      timestamp: new Date().toISOString(),
      amount: sale.total,
      payload: { saleId: sale.id, itemsCount: sale.items.length }
    });

    // C. HANDLERS DE TRANSACCIÓN
    tx.oncomplete = () => {
      clearTimeout(timeoutId);
      completed = true;
      // Éxito: Marcar log como completado en una nueva transacción asíncrona
      markTransactionComplete(transactionId);
      resolve({ success: true, transactionId });
    };

    tx.onerror = (e) => {
      clearTimeout(timeoutId);
      console.error('❌ Transaction error:', e.target.error);
      reject(e.target.error);
    };

    tx.onabort = () => {
      clearTimeout(timeoutId);
      aborted = true;
      // Nota: Si se aborta la transacción, el registro 'PENDING' en logStore 
      // TAMBIÉN se deshace (porque es parte de la misma transacción ACID).
      // Esto es correcto para IndexedDB. El log persistente 'FAILED' 
      // se usaría si tuviéramos un sistema multi-paso no atómico.
      reject(new Error('TRANSACTION_ABORTED_OR_STOCK_ERROR'));
    };

    // D. LÓGICA DE NEGOCIO (Pre-cálculo)
    const productUpdates = new Map();

    // Sumar lotes
    deductions.forEach(({ productId, quantity }) => {
      if (productId) {
        const current = productUpdates.get(productId) || 0;
        productUpdates.set(productId, current + quantity);
      }
    });

    // Sumar productos simples
    if (sale && sale.items) {
      sale.items.forEach(item => {
        if (!item.batchesUsed || item.batchesUsed.length === 0) {
          const pid = item.parentId || item.id;
          const current = productUpdates.get(pid) || 0;
          productUpdates.set(pid, current + item.quantity);
        }
      });
    }

    try {
      // E. EJECUCIÓN (Lecturas y Escrituras)

      // 1. Procesar Lotes
      deductions.forEach(({ batchId, quantity }) => {
        if (aborted) return;
        const batchReq = batchesStore.get(batchId);
        batchReq.onsuccess = () => {
          if (aborted) return;
          const batch = batchReq.result;
          if (!batch || batch.stock < quantity) {
            aborted = true;
            tx.abort();
            return;
          }
          batch.stock -= quantity;
          if (batch.stock <= 0.0001) { batch.stock = 0; batch.isActive = false; }
          batchesStore.put(batch);
        };
      });

      // 2. Actualizar Productos Padre
      productUpdates.forEach((qtyToDeduct, productId) => {
        if (aborted) return;
        const prodReq = productStore.get(productId);
        prodReq.onsuccess = () => {
          if (aborted) return;
          const product = prodReq.result;
          if (product && product.trackStock) {
            product.stock -= qtyToDeduct;
            if (Math.abs(product.stock) < 0.0001) product.stock = 0;
            productStore.put(product);
          }
        };
      });

      // 3. Guardar Venta
      if (sale && !aborted) {
        salesStore.add(sale);
      }

    } catch (error) {
      // Captura errores síncronos en la lógica
      aborted = true;
      tx.abort();
    }
  });
}

async function markTransactionComplete(transactionId) {
  try {
    // Usamos una transacción separada rápida
    await saveData(STORES.TRANSACTION_LOG, {
      id: transactionId,
      status: 'COMPLETED',
      completedAt: new Date().toISOString()
      // Nota: saveData hace un merge/put, pero si quieres preservar los datos originales
      // deberías leer primero. Para eficiencia, aquí solo actualizamos el estado si es simple
      // o usamos 'readwrite' manual.
    });

    // Versión manual más segura para preservar payload:
    const db = await initDB();
    const tx = db.transaction(STORES.TRANSACTION_LOG, 'readwrite');
    const store = tx.objectStore(STORES.TRANSACTION_LOG);
    const req = store.get(transactionId);

    req.onsuccess = () => {
      const data = req.result;
      if (data) {
        data.status = 'COMPLETED';
        data.completedAt = new Date().toISOString();
        store.put(data);
      }
    };
  } catch (e) { console.error("Error marking tx complete", e); }
}

async function markTransactionFailed(transactionId, errorMsg = 'Unknown') {
  try {
    const db = await initDB();
    const tx = db.transaction(STORES.TRANSACTION_LOG, 'readwrite');
    const store = tx.objectStore(STORES.TRANSACTION_LOG);
    const req = store.get(transactionId);

    req.onsuccess = () => {
      const data = req.result;
      if (data) {
        data.status = 'FAILED';
        data.error = errorMsg;
        data.failedAt = new Date().toISOString();
        store.put(data);
      }
    };
  } catch (e) { console.error("Error marking tx failed", e); }
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

export async function recoverPendingTransactions() {
  try {
    const db = await initDB();

    // ✅ CORRECCIÓN DE SEGURIDAD:
    // Verificamos si la tabla existe antes de intentar abrir la transacción.
    // Esto evita el "NotFoundError" si la actualización de versión apenas está ocurriendo.
    if (!db.objectStoreNames.contains(STORES.TRANSACTION_LOG)) {
      console.warn("⚠️ La tabla 'transaction_log' aún no está disponible. Saltando recuperación inicial.");
      return;
    }

    // Revisamos logs pendientes
    const tx = db.transaction(STORES.TRANSACTION_LOG, 'readonly');
    const store = tx.objectStore(STORES.TRANSACTION_LOG);
    const index = store.index('status');
    const request = index.getAll('PENDING');

    request.onsuccess = async () => {
      const pending = request.result;
      if (pending && pending.length > 0) {
        console.warn(`⚠️ Detectadas ${pending.length} transacciones incompletas.`);

        // Procesar las que son viejas (> 1 minuto)
        for (const log of pending) {
          const age = Date.now() - new Date(log.timestamp).getTime();
          if (age > 60000) {
            console.log(`Marcando transacción ${log.id} como FALLIDA (Timeout post-reinicio)`);
            await markTransactionFailed(log.id, 'Stale transaction found on startup');
          }
        }
      }
    };
  } catch (error) {
    // Si falla (ej. base de datos bloqueada), solo lo registramos y no rompemos la app
    console.warn("Recuperación de transacciones omitida por estado de BD:", error.name);
  }
}

/**
 * Verifica la cuota de almacenamiento disponible en el navegador.
 * @returns {Promise<{warning: boolean, message?: string}>}
 */
export async function checkStorageQuota() {
  // Verificamos si el navegador soporta la API
  if (!navigator.storage || !navigator.storage.estimate) {
    return { warning: false };
  }

  try {
    const estimate = await navigator.storage.estimate();

    const usage = estimate.usage || 0; // Bytes usados
    const quota = estimate.quota || 1; // Bytes totales permitidos (evitar 0)

    const percentUsed = (usage / quota) * 100;
    const remainingMB = (quota - usage) / (1024 * 1024);

    console.log(`💾 Estado de Disco: ${(usage / 1024 / 1024).toFixed(2)}MB usados de ${(quota / 1024 / 1024).toFixed(2)}MB (${percentUsed.toFixed(1)}%)`);

    // UMBRAL DE ALERTA: 80%
    if (percentUsed > 80) {
      return {
        warning: true,
        message: `⚠️ ALERTA CRÍTICA DE ESPACIO\n\nEl almacenamiento del navegador está al ${percentUsed.toFixed(0)}% de su capacidad.\nQuedan aprox. ${remainingMB.toFixed(0)} MB.\n\nPor favor, ve a Configuración > Mantenimiento y usa "Archivar Historial" para liberar espacio.`
      };
    }

    return { warning: false };

  } catch (error) {
    console.error("Error verificando cuota de disco:", error);
    return { warning: false };
  }
}