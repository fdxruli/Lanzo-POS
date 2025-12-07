// src/workers/stats.worker.js

const DB_NAME = 'LanzoDB1';
const DB_VERSION = 25; // Asegurar que coincida con tu database.js

// Mini función para abrir DB dentro del worker
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

self.onmessage = async (e) => {
  if (e.data.type === 'CALCULATE_STATS') {
    try {
      const db = await openDB();
      
      // 1. Calcular Valor Inventario (Iterando Lotes)
      let inventoryValue = 0;
      const tx = db.transaction(['product_batches'], 'readonly');
      const store = tx.objectStore('product_batches');
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const batch = cursor.value;
          if (batch.isActive && batch.stock > 0) {
            inventoryValue += (batch.cost * batch.stock);
          }
          cursor.continue();
        } else {
          // Terminó el cursor, enviamos respuesta
          self.postMessage({ 
            success: true, 
            type: 'STATS_RESULT', 
            payload: { inventoryValue } 
          });
        }
      };
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
  }
};