// database.js

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 6;
const STORES = {
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
 * @returns {Promise<IDBDatabase>} La instancia de la base de datos.
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
            console.log('Base de datos abierta exitosamente.');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('Actualizando la base de datos a la versión', DB_VERSION);
            // Aquí va toda tu lógica de onupgradeneeded que ya tienes en app.js
            if (!db.objectStoreNames.contains(STORES.MENU)) {
                db.createObjectStore(STORES.MENU, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORES.SALES)) {
                db.createObjectStore(STORES.SALES, { keyPath: 'timestamp' });
            }
            // ... y así para todos los demás almacenes (COMPANY, THEME, CUSTOMERS, etc.)
            if (!db.objectStoreNames.contains(STORES.CUSTOMERS)) {
                const customerStore = db.createObjectStore(STORES.CUSTOMERS, { keyPath: 'id' });
                customerStore.createIndex('name', 'name', { unique: false });
                customerStore.createIndex('phone', 'phone', { unique: false });
            }
        };
    });
}

/**
 * Guarda datos (un objeto o un array de objetos) en un almacén.
 * @param {string} storeName - El nombre del almacén (e.g., STORES.MENU).
 * @param {object|object[]} data - Los datos a guardar.
 * @returns {Promise<void>}
 */
export function saveData(storeName, data) {
    return new Promise(async (resolve, reject) => {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject('Error en la transacción: ' + event.target.error);

        if (Array.isArray(data)) {
            data.forEach(item => store.put(item));
        } else {
            store.put(data);
        }
    });
}

/**
 * Carga datos de un almacén.
 * @param {string} storeName - El nombre del almacén.
 * @param {string|null} key - La clave del objeto a obtener (opcional). Si es null, obtiene todo.
 * @returns {Promise<any>}
 */
export function loadData(storeName, key = null) {
    return new Promise(async (resolve, reject) => {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = key ? store.get(key) : store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject('Error al cargar datos: ' + event.target.error);
    });
}

/**
 * Elimina un dato de un almacén por su clave.
 * @param {string} storeName - El nombre del almacén.
 * @param {string} key - La clave del objeto a eliminar.
 * @returns {Promise<void>}
 */
export function deleteData(storeName, key) {
    return new Promise(async (resolve, reject) => {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject('Error al eliminar datos: ' + event.target.error);
    });
}

// Exportamos STORES para que los otros módulos puedan usar las constantes
export { STORES };