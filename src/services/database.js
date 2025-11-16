// src/services/database.js

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 12; // ¡Versión incrementada!
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
            return resolve(db);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => reject('Error al abrir la base de datos: ' + event.target.errorCode);

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('Base de datos centralizada abierta exitosamente.');
            resolve(db);
        };

        // --- ¡ESTA ES LA FUNCIÓN QUE DEBES REEMPLAZAR! ---
        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            console.log('Actualizando la base de datos a la versión', DB_VERSION);
            
            // --- INICIO DE LA CORRECCIÓN ---
            // Aseguramos que TODAS las tiendas existan

            if (!tempDb.objectStoreNames.contains(STORES.MENU)) {
                tempDb.createObjectStore(STORES.MENU, { keyPath: 'id' });
            }
            if (!tempDb.objectStoreNames.contains(STORES.SALES)) {
                tempDb.createObjectStore(STORES.SALES, { keyPath: 'timestamp' });
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
            
            if (!tempDb.objectStoreNames.contains(STORES.PRODUCT_BATCHES)) {
                const batchStore = tempDb.createObjectStore(STORES.PRODUCT_BATCHES, { keyPath: 'id' });
                batchStore.createIndex('productId', 'productId', { unique: false });
                console.log('Almacén PRODUCT_BATCHES creado.');
            }
            if (event.oldVersion < 12) {
                console.log('Detectada versión antigua, iniciando migración de productos a lotes...');
                localStorage.setItem('run_batch_migration', 'true');
            }
        };
    });
}

// ... (saveData, loadData, deleteData no cambian) ...
export function saveData(storeName, data) {
    return new Promise(async (resolve, reject) => {
        const dbInstance = await initDB();
        const transaction = dbInstance.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);

        if (Array.isArray(data)) {
            data.forEach(item => store.put(item));
        } else {
            store.put(data);
        }
    });
}

export function loadData(storeName, key = null) {
    return new Promise(async (resolve, reject) => {
        const dbInstance = await initDB();
        const transaction = dbInstance.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = key ? store.get(key) : store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

export function deleteData(storeName, key) {
    return new Promise(async (resolve, reject) => {
        const dbInstance = await initDB();
        const transaction = dbInstance.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}