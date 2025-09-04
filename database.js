// database.js

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 6; // Asegúrate que esta versión coincida con la de tu app.js
export const STORES = { // Exportamos STORES para que todos los usen
    MENU: 'menu',
    SALES: 'sales',
    COMPANY: 'company',
    THEME: 'theme',
    INGREDIENTS: 'ingredients',
    CATEGORIES: 'categories',
    CUSTOMERS: 'customers'
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

        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            console.log('Actualizando la base de datos a la versión', DB_VERSION);
            if (!tempDb.objectStoreNames.contains(STORES.MENU)) {
                tempDb.createObjectStore(STORES.MENU, { keyPath: 'id' });
            }
            if (!tempDb.objectStoreNames.contains(STORES.SALES)) {
                const salesStore = tempDb.createObjectStore(STORES.SALES, { keyPath: 'timestamp' });
                salesStore.createIndex('customerId', 'customerId', { unique: false });
            }
            if (!tempDb.objectStoreNames.contains(STORES.COMPANY)) {
                tempDb.createObjectStore(STORES.COMPANY, { keyPath: 'id' });
            }
            if (!tempDb.objectStoreNames.contains(STORES.THEME)) {
                tempDb.createObjectStore(STORES.THEME, { keyPath: 'id' });
            }
            if (!tempDb.objectStoreNames.contains(STORES.INGREDIENTS)) {
                tempDb.createObjectStore(STORES.INGREDIENTS, { keyPath: 'productId' });
            }
            if (!tempDb.objectStoreNames.contains(STORES.CATEGORIES)) {
                const categoryStore = tempDb.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
                categoryStore.createIndex('name', 'name', { unique: true });
            }
            if (!tempDb.objectStoreNames.contains(STORES.CUSTOMERS)) {
                const customerStore = tempDb.createObjectStore(STORES.CUSTOMERS, { keyPath: 'id' });
                customerStore.createIndex('name', 'name', { unique: false });
            }
        };
    });
}

/**
 * Guarda datos en un almacén.
 */
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

/**
 * Carga datos de un almacén.
 */
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

/**
 * Elimina un dato de un almacén.
 */
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