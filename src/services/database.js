// src/services/database.js

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 13; // ¡Versión incrementada para las variantes!

export const STORES = {
    MENU: 'menu', // Este será tu almacén "PRODUCTS"
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
    PRODUCT_BATCHES: 'product_batches', // ¡NUEVA COLECCIÓN!
};

let db = null;

/**
 * Inicializa y abre la conexión con la base de datos IndexedDB.
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            // ¡NUEVO! Verificar que la conexión sigue válida
            try {
                // Intenta acceder a la lista de stores como prueba rápida
                db.objectStoreNames;
                return resolve(db);
            } catch (error) {
                // Si falla, la conexión está rota
                console.warn('Conexión de BD rota, recreando...', error);
                db = null; // ¡RESETEAR!
            }
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            db = null; // ¡RESETEAR EN ERROR!
            reject('Error al abrir la base de datos: ' + event.target.errorCode);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('Base de datos centralizada abierta exitosamente.');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            console.log('Actualizando la base de datos a la versión', DB_VERSION);

            // Aseguramos que TODAS las tiendas existan
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

            // ======================================================
            // ¡INICIO DE LA MODIFICACIÓN PARA VARIANTES (v13)!
            // ======================================================
            if (!tempDb.objectStoreNames.contains(STORES.PRODUCT_BATCHES)) {
                // Creando el store por primera vez (nuevo usuario)
                const batchStore = tempDb.createObjectStore(STORES.PRODUCT_BATCHES, { keyPath: 'id' });
                batchStore.createIndex('productId', 'productId', { unique: false });
                console.log('Almacén PRODUCT_BATCHES creado.');
                batchStore.createIndex('productId_isActive', ['productId', 'isActive'], { unique: false });
                batchStore.createIndex('expiryDate', 'expiryDate', { unique: false });
                batchStore.createIndex('createdAt', 'createdAt', { unique: false });
                
                // Añadido en v13 para Variantes (Ropa/Ferretería)
                batchStore.createIndex('sku', 'sku', { unique: false });

            } else if (event.oldVersion < 13) {
                // El store ya existe, pero actualizamos desde una v < 13 (usuario existente)
                console.log('Actualizando almacén PRODUCT_BATCHES a v13...');
                const batchStore = event.target.transaction.objectStore(STORES.PRODUCT_BATCHES);
                
                // Añadimos el nuevo índice 'sku' si no existe
                if (!batchStore.indexNames.contains('sku')) {
                    batchStore.createIndex('sku', 'sku', { unique: false });
                    console.log('Índice "sku" añadido a PRODUCT_BATCHES.');
                }
            }
            // ======================================================
            // ¡FIN DE LA MODIFICACIÓN PARA VARIANTES (v13)!
            // ======================================================

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
    });
}

/**
 * Guarda datos en un store específico.
 * @param {string} storeName - Nombre del store (de STORES)
 * @param {object|array} data - Datos a guardar (objeto o array de objetos)
 */
export function saveData(storeName, data) {
    return new Promise(async (resolve, reject) => {
        try {
            const dbInstance = await initDB();
            const transaction = dbInstance.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => {
                // ¡RESETEAR SI HAY ERROR DE TRANSACCIÓN!
                if (event.target.error.name === 'NotFoundError') {
                    console.error('Store no encontrado, reseteando conexión...');
                    db = null;
                }
                reject(event.target.error);
            };

            if (Array.isArray(data)) {
                data.forEach(item => store.put(item));
            } else {
                store.put(data);
            }
        } catch (error) {
            // ¡RESETEAR SI initDB falla!
            console.error('Error en saveData, reseteando conexión...', error);
            db = null;
            reject(error);
        }
    });
}

/**
 * Carga datos de un store.
 * @param {string} storeName - Nombre del store
 * @param {string|number} key - (Opcional) Clave específica del objeto a cargar
 * @returns {Promise<object|array>} Los datos cargados
 */
export function loadData(storeName, key = null) {
    return new Promise(async (resolve, reject) => {
        try {
            const dbInstance = await initDB();
            const transaction = dbInstance.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = key ? store.get(key) : store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => {
                // ¡RESETEAR SI HAY ERROR!
                if (event.target.error.name === 'NotFoundError') {
                    console.error('Store no encontrado, reseteando conexión...');
                    db = null;
                }
                reject(event.target.error);
            };
        } catch (error) {
            // ¡RESETEAR SI initDB falla!
            console.error('Error en loadData, reseteando conexión...', error);
            db = null;
            reject(error);
        }
    });
}

/**
 * Elimina un dato específico de un store.
 * @param {string} storeName - Nombre del store
 * @param {string|number} key - Clave del objeto a eliminar
 */
export function deleteData(storeName, key) {
    return new Promise(async (resolve, reject) => {
        try {
            const dbInstance = await initDB();
            const transaction = dbInstance.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                // ¡RESETEAR SI HAY ERROR!
                if (event.target.error.name === 'NotFoundError') {
                    console.error('Store no encontrado, reseteando conexión...');
                    db = null;
                }
                reject(event.target.error);
            };
        } catch (error) {
            // ¡RESETEAR SI initDB falla!
            console.error('Error en deleteData, reseteando conexión...', error);
            db = null;
            reject(error);
        }
    });
}

/**
 * Guarda un array de objetos en el store en una sola transacción.
 * (saveData ya hace esto, así que esto es un alias por claridad).
 */
export const saveBulk = saveData;

/**
 * Carga un array de objetos desde un store usando sus claves (IDs).
 * @param {string} storeName - Nombre del store
 * @param {Array<string|number>} keys - Array de IDs a cargar
 * @returns {Promise<Array<object>>} Los objetos encontrados
 */
export function loadBulk(storeName, keys) {
    return new Promise(async (resolve, reject) => {
        try {
            const dbInstance = await initDB();
            const transaction = dbInstance.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const results = [];
            let requestCount = keys.length;

            if (requestCount === 0) {
                resolve([]);
                return;
            }

            // Función para manejar el éxito o error de cada 'get'
            const handleRequest = (event) => {
                const result = event.target.result;
                if (result) {
                    results.push(result);
                }
                
                requestCount--;
                if (requestCount === 0) {
                    // Se procesaron todas las solicitudes
                    resolve(results);
                }
            };
            
            const handleError = (event) => {
                // Si una falla, rechazamos todo
                reject(event.target.error);
                // Abortar la transacción podría ser necesario aquí
                try { transaction.abort(); } catch (e) {}
            };

            // Itera y crea una solicitud 'get' por cada clave
            keys.forEach(key => {
                const request = store.get(key);
                request.onsuccess = handleRequest;
                request.onerror = handleError;
            });

        } catch (error) {
            console.error('Error en loadBulk, reseteando conexión...', error);
            db = null; // Resetea la conexión
            reject(error);
        }
    });
}