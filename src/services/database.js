// src/services/database.js - VERSIÓN MEJORADA

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 13;

// ✅ MEJORA: Objeto en lugar de variable simple
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
 * ✅ MEJORA: Validación robusta de conexión
 */
function isConnectionValid(db) {
  if (!db) return false;
  
  try {
    // Verificación más robusta
    if (db.objectStoreNames.length === 0) return false;
    
    // Verificar que no esté cerrada
    const testTransaction = db.transaction([STORES.MENU], 'readonly');
    testTransaction.abort();
    return true;
  } catch (error) {
    console.warn('Conexión inválida detectada:', error.name);
    return false;
  }
}

/**
 * ✅ MEJORA: Inicialización con manejo de concurrencia
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    
    // Si ya hay una apertura en progreso, esperar a que termine
    if (dbConnection.isOpening && dbConnection.openPromise) {
      return dbConnection.openPromise.then(resolve).catch(reject);
    }
    
    // Si ya tenemos una conexión válida, devolverla
    if (isConnectionValid(dbConnection.instance)) {
      return resolve(dbConnection.instance);
    }
    
    // Resetear conexión inválida
    if (dbConnection.instance) {
      try {
        dbConnection.instance.close();
      } catch (e) {
        console.warn('Error cerrando conexión anterior:', e);
      }
      dbConnection.instance = null;
    }
    
    // Marcar que estamos abriendo
    dbConnection.isOpening = true;
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    // Guardar la promesa para manejar concurrencia
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
        
        // ✅ NUEVO: Manejar cierre inesperado
        dbConnection.instance.onclose = () => {
          console.warn('⚠️ Conexión de BD cerrada inesperadamente');
          dbConnection.instance = null;
        };
        
        // ✅ NUEVO: Manejar errores de versión
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
        
        // Crear stores si no existen
        if (!tempDb.objectStoreNames.contains(STORES.MENU)) {
          tempDb.createObjectStore(STORES.MENU, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.COMPANY)) {
          tempDb.createObjectStore(STORES.COMPANY, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.THEME)) {
          tempDb.createObjectStore(STORES.THEME, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.INGREDIENTS)) {
          tempDb.createObjectStore(STORES.INGREDIENTS, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.CATEGORIES)) {
          tempDb.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.CUSTOMERS)) {
          tempDb.createObjectStore(STORES.CUSTOMERS, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.CAJAS)) {
          tempDb.createObjectStore(STORES.CAJAS, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.DELETED_MENU)) {
          tempDb.createObjectStore(STORES.DELETED_MENU, { keyPath: 'id' });
        }
        if (!tempDb.objectStoreNames.contains(STORES.DELETED_CUSTOMERS)) {
          tempDb.createObjectStore(STORES.DELETED_CUSTOMERS, { keyPath: 'id' });
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
          console.log('Almacén PRODUCT_BATCHES creado.');
        } else if (event.oldVersion < 13) {
          const batchStore = event.target.transaction.objectStore(STORES.PRODUCT_BATCHES);
          if (!batchStore.indexNames.contains('sku')) {
            batchStore.createIndex('sku', 'sku', { unique: false });
            console.log('Índice "sku" añadido a PRODUCT_BATCHES.');
          }
        }
        
        if (!tempDb.objectStoreNames.contains(STORES.SALES)) {
          const salesStore = tempDb.createObjectStore(STORES.SALES, { keyPath: 'timestamp' });
          salesStore.createIndex('customerId', 'customerId', { unique: false });
          salesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        if (event.oldVersion < 12) {
          console.log('Detectada versión antigua, iniciando migración de productos a lotes...');
          localStorage.setItem('run_batch_migration', 'true');
        }
      };
      
      request.onblocked = () => {
        console.warn('⚠️ Apertura de BD bloqueada. Cierra otras pestañas de Lanzo POS.');
        alert('Por favor, cierra otras pestañas de Lanzo POS para continuar.');
      };
      
    });
    
    dbConnection.openPromise.then(resolve).catch(reject);
  });
}

/**
 * ✅ MEJORA: Retry automático en operaciones
 */
async function executeWithRetry(operation, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`Intento ${attempt} falló:`, error.name);
      
      // Si es un error de conexión, resetear e intentar de nuevo
      if (error.name === 'InvalidStateError' || error.name === 'NotFoundError') {
        dbConnection.instance = null;
        await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Backoff exponencial
      } else {
        throw error; // Otros errores no son recuperables
      }
    }
  }
  
  throw lastError;
}

/**
 * ✅ MEJORA: saveData con reintentos
 */
export function saveData(storeName, data) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) => {
        console.error(`Error en transacción de ${storeName}:`, event.target.error);
        reject(event.target.error);
      };
      transaction.onabort = (event) => {
        console.error(`Transacción de ${storeName} abortada:`, event.target.error);
        reject(new Error('Transacción abortada'));
      };
      
      if (Array.isArray(data)) {
        data.forEach(item => store.put(item));
      } else {
        store.put(data);
      }
    });
  });
}

/**
 * ✅ MEJORA: loadData con reintentos
 */
export function loadData(storeName, key = null) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = key ? store.get(key) : store.getAll();
      
      request.onsuccess = () => resolve(request.result || (key ? null : []));
      request.onerror = (event) => {
        console.error(`Error leyendo de ${storeName}:`, event.target.error);
        reject(event.target.error);
      };
    });
  });
}

/**
 * ✅ MEJORA: deleteData con reintentos
 */
export function deleteData(storeName, key) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      
      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        console.error(`Error eliminando de ${storeName}:`, event.target.error);
        reject(event.target.error);
      };
    });
  });
}

export const saveBulk = saveData;

/**
 * ✅ MEJORA: loadBulk optimizado
 */
export function loadBulk(storeName, keys) {
  return executeWithRetry(async () => {
    const dbInstance = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const results = [];
      let pending = keys.length;
      
      if (pending === 0) {
        resolve([]);
        return;
      }
      
      let hasError = false;
      
      keys.forEach(key => {
        if (hasError) return;
        
        const request = store.get(key);
        
        request.onsuccess = () => {
          if (request.result) {
            results.push(request.result);
          }
          pending--;
          if (pending === 0) {
            resolve(results);
          }
        };
        
        request.onerror = (event) => {
          hasError = true;
          reject(event.target.error);
          try { transaction.abort(); } catch (e) {}
        };
      });
    });
  });
}

/**
 * ✅ NUEVO: Función para cerrar la conexión manualmente
 */
export function closeDB() {
  if (dbConnection.instance) {
    try {
      dbConnection.instance.close();
      console.log('✅ Conexión de BD cerrada manualmente.');
    } catch (e) {
      console.warn('Error cerrando BD:', e);
    }
    dbConnection.instance = null;
  }
}

/**
 * ✅ NUEVO: Health check de la BD
 */
export async function checkDBHealth() {
  try {
    const db = await initDB();
    const isValid = isConnectionValid(db);
    
    if (!isValid) {
      throw new Error('Conexión inválida');
    }
    
    // Test de lectura
    await loadData(STORES.COMPANY, 'company');
    
    return { healthy: true, message: 'BD funcionando correctamente' };
  } catch (error) {
    return { healthy: false, message: error.message };
  }
}