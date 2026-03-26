import Dexie from 'dexie';
import { DB_NAME } from '../../config/dbConfig'; // Usamos tu config existente
import { buildPhoneBuckets, toIndexedPhoneKey } from './customerPhoneUtils';
import { getLegacyFinancialSaleStatus } from '../sales/financialStats';
import Logger from '../Logger';
import { showMessage } from '../../store/useMessageStore';
// Nota: Dexie maneja el versionado de forma interna y más limpia, 
// pero importamos DB_NAME para mantener consistencia.

/**
 * Mapeo de nombres de Tablas (Stores) para mantener consistencia 
 * con el resto de la aplicación que usa la constante STORES.
 */
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
  LAYAWAYS: 'layaways',
  CUSTOMER_LEDGER: 'customer_ledger',
};

class LanzoDatabase extends Dexie {
  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      // --- Inventario y Productos ---
      [STORES.MENU]: 'id, barcode, name_lower, categoryId', // Índices simples

      [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, [productId+isActive], [productId+isActive+createdAt]',
      // ^ Aquí incluimos tus índices compuestos y el nuevo de caducidad

      [STORES.CATEGORIES]: 'id, name, isActive, sortOrder',
      [STORES.INGREDIENTS]: 'id',

      // --- Ventas y Clientes ---
      [STORES.SALES]: 'id, &timestamp, customerId, fulfillmentStatus, [customerId+timestamp]',
      // ^ &timestamp es único. Agregamos fulfillmentStatus para KDS.

      [STORES.CUSTOMERS]: 'id, phone',

      // --- Caja y Movimientos ---
      [STORES.CAJAS]: 'id, estado', // Para encontrar caja abierta rápido
      [STORES.MOVIMIENTOS_CAJA]: 'id, caja_id',

      // --- Auditoría y Logs ---
      [STORES.TRANSACTION_LOG]: 'id, status, timestamp', // Para recuperación de transacciones

      // --- Configuración y Varios ---
      [STORES.COMPANY]: 'id',
      [STORES.THEME]: 'id',
      [STORES.STATS]: 'id', // global_stats
      [STORES.DAILY_STATS]: 'id', // Usualmente la fecha es el ID aquí

      // --- Papelera ---
      [STORES.DELETED_MENU]: 'id',
      [STORES.DELETED_CUSTOMERS]: 'id',
      [STORES.DELETED_SALES]: 'id',
      [STORES.DELETED_CATEGORIES]: 'id',

      // --- Otros ---
      [STORES.WASTE]: 'id',
      [STORES.PROCESSED_SALES_LOG]: 'id',

      // Casos especiales de KeyPath
      [STORES.SYNC_CACHE]: 'key', // Tu código usaba 'key' como primary key
      [STORES.IMAGES]: 'id',       // Almacenamiento de Blobs

      // Esquema de apartados 
      [STORES.LAYAWAYS]: 'id, customerId, status, deadline, [customerId+status]'
    });

    this.version(2).stores({
      [STORES.SALES]: 'id, timestamp, customerId, fulfillmentStatus, [customerId+timestamp]'
    });

    this.version(3).stores({
      [STORES.CUSTOMER_LEDGER]: 'id, customerId, type, timestamp, [customerId+timestamp]'
    });

    this.version(4).stores({
      // Añadimos createdAt como índice a las tablas que requieren paginación K-Sortable
      [STORES.MENU]: 'id, createdAt, barcode, name_lower, categoryId',
      [STORES.CUSTOMERS]: 'id, createdAt, phone',
      [STORES.CATEGORIES]: 'id, createdAt, name, isActive, sortOrder'
    }).upgrade(async tx => {
      // Tiempo base en el pasado para registros legacy sin timestamp en el ID
      // Previene que se mezclen con los registros nuevos K-Sortables
      let fallbackTime = new Date('2023-01-01T00:00:00.000Z').getTime();

      const injectCreatedAt = async (tableName) => {
        await tx.table(tableName).toCollection().modify(record => {
          if (!record.createdAt) {
            // Intentar rescatar el timestamp si el ID viejo lo contenía (ej: cust-1691234567890)
            const match = String(record.id).match(/\d{13}/);
            if (match) {
              record.createdAt = new Date(parseInt(match[0], 10)).toISOString();
            } else {
              // Incremento artificial de 1 segundo para evitar colisiones de ordenamiento
              // K-Sortable depende de la unicidad secuencial
              fallbackTime += 1000;
              record.createdAt = new Date(fallbackTime).toISOString();
            }
          }
        });
      };

      // Dexie .modify() maneja el procesamiento por lotes internamente, 
      // evitando bloqueos severos de memoria.
      await injectCreatedAt(STORES.CUSTOMERS);
      await injectCreatedAt(STORES.MENU);
      await injectCreatedAt(STORES.CATEGORIES);
    });

    this.version(5).stores({
      [STORES.CAJAS]: 'id, estado, fecha_apertura'
    });

    this.version(6).stores({
      [STORES.MENU]: 'id, createdAt, barcode, name_lower, categoryId, sku'
    });

    this.version(7).stores({
      [STORES.WASTE]: 'id, timestamp'
    }).upgrade(async tx => {
      let fallbackTime = new Date('2023-01-01T00:00:00.000Z').getTime();

      await tx.table(STORES.WASTE).toCollection().modify(record => {
        const hasValidTimestamp =
          typeof record.timestamp === 'string' &&
          Number.isFinite(Date.parse(record.timestamp));

        if (hasValidTimestamp) return;

        const match = String(record.id || '').match(/\d{13}/);
        if (match) {
          record.timestamp = new Date(parseInt(match[0], 10)).toISOString();
          return;
        }

        fallbackTime += 1000;
        record.timestamp = new Date(fallbackTime).toISOString();
      });
    });

    this.version(8).stores({
      [STORES.CUSTOMERS]: 'id, createdAt, phone, &phoneKey'
    }).upgrade(async tx => {
      const customers = await tx.table(STORES.CUSTOMERS).toArray();
      const buckets = buildPhoneBuckets(customers);
      const duplicatedPhones = new Set(
        Array.from(buckets.entries())
          .filter(([, records]) => records.length > 1)
          .map(([phoneKey]) => phoneKey)
      );

      await tx.table(STORES.CUSTOMERS).toCollection().modify(record => {
        const phoneKey = toIndexedPhoneKey(record.phone);

        if (!phoneKey || duplicatedPhones.has(phoneKey)) {
          delete record.phoneKey;
          return;
        }

        record.phoneKey = phoneKey;
      });
    });

    this.version(9).stores({
      [STORES.SALES]: 'id, timestamp, customerId, fulfillmentStatus, status, orderType, [customerId+timestamp]'
    }).upgrade(async tx => {
      await tx.table(STORES.SALES).toCollection().modify(record => {
        if (!record.status) {
          record.status = getLegacyFinancialSaleStatus(record);
        }
      });
    });

    this.version(10).stores({
      [STORES.MENU]: 'id, createdAt, barcode, name_lower, categoryId, sku',
      [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, [productId+isActive], [productId+isActive+createdAt]'
    }).upgrade(async tx => {
      const initializeCommittedStock = async (tableName) => {
        await tx.table(tableName).toCollection().modify(record => {
          const currentCommitted = Number(record?.committedStock);
          if (!Number.isFinite(currentCommitted) || currentCommitted < 0) {
            record.committedStock = 0;
          }
        });
      };

      await initializeCommittedStock(STORES.MENU);
      await initializeCommittedStock(STORES.PRODUCT_BATCHES);
    });
  }
}

// Instancia Singleton
export const db = new LanzoDatabase();

// Variable de control para evitar múltiples invocaciones si Dexie emite el evento en ráfaga
let isMigrationBlockHandled = false;

db.on('blocked', () => {
  Logger.error('Migración bloqueada por conexiones antiguas activas.');

  if (isMigrationBlockHandled) return;
  isMigrationBlockHandled = true;

  const msg = 'Actualización crítica de la base de datos pendiente. Por favor, cierra todas las demás pestañas de esta aplicación y recarga la página para continuar.';

  // Callback forzado para disparar el CASO A (Modal) de showMessageModal
  // Obliga al usuario del kiosco a interactuar y proporciona un método de recuperación (reload)
  const onConfirmAction = () => {
    window.location.reload();
  };

  const dispatchUIModal = () => {
    try {
      // Reemplaza showMessageModal por showMessage
      showMessage(msg, onConfirmAction, { type: 'error' });
    } catch (error) {
      Logger.error('Fallo en la invocación del store Zustand/UI:', error);
      injectRawDOMFallback(msg);
    }
  };

  // PUNTO CIEGO: Manejo de ciclo de vida fuera de React
  // Si la migración se bloquea inmediatamente al parsear el bundle, el árbol de React 
  // (y el componente Modal que escucha el store) no existirá en el DOM. 
  // Modificar el store prematuramente causaría la pérdida silenciosa del evento.
  if (document.readyState === 'loading') {
    // El DOM aún se está construyendo. Esperamos a que termine y damos margen 
    // a la hidratación/montaje de React.
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(dispatchUIModal, 1500);
    });
  } else {
    // El DOM está listo. Ejecutamos asíncronamente para vaciar el call stack actual.
    setTimeout(dispatchUIModal, 500);
  }
});

/**
 * Fallback absoluto: Si React falla al renderizar debido al esquema obsoleto de la DB,
 * o si el store de Zustand lanza excepciones por inicialización incompleta,
 * inyectamos una capa nativa directamente en el DOM para evitar que el kiosco quede inoperable.
 */
function injectRawDOMFallback(message) {
  if (document.getElementById('lanzo-db-block-fallback')) return;

  const overlay = document.createElement('div');
  overlay.id = 'lanzo-db-block-fallback';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.95);color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:2147483647;font-family:sans-serif;padding:2rem;text-align:center;';

  overlay.innerHTML = `
    <h1 style="color:#ff4444;margin-bottom:1rem;">Mantenimiento Requerido</h1>
    <p style="font-size:1.5rem;max-width:600px;line-height:1.4;margin-bottom:2rem;">${message}</p>
    <button onclick="window.location.reload()" style="padding:1rem 2rem;font-size:1.2rem;background:#ff4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Recargar Sistema</button>
  `;

  document.body.appendChild(overlay);
}

// Exportar clase por si se necesita instanciar para tests
export { LanzoDatabase };
