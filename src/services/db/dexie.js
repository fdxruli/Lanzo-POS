import Dexie from 'dexie';
import { DB_NAME } from '../../config/dbConfig'; // Usamos tu config existente
import { buildPhoneBuckets, toIndexedPhoneKey } from './customerPhoneUtils';
import { CUSTOMER_DEBT_SORT_INDEX, normalizeCustomerDebtCents } from './customerDebtIndex';
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
  INVENTORY_EVENTS: 'inventory_events',
  SEQUENCES: 'sequences',
  CORRUPTED_STATES: 'corrupted_states'
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

    this.version(11).stores({
      [STORES.CUSTOMERS]: `id, createdAt, updatedAt, phone, &phoneKey, debtCents, ${CUSTOMER_DEBT_SORT_INDEX}`
    }).upgrade(async tx => {
      const now = new Date().toISOString();

      await tx.table(STORES.CUSTOMERS).toCollection().modify(record => {
        if (!record.createdAt) {
          record.createdAt = record.updatedAt || now;
        }

        if (!record.updatedAt) {
          record.updatedAt = record.createdAt || now;
        }

        record.debtCents = normalizeCustomerDebtCents(record.debt || 0);
      });
    });

    this.version(12).stores({
      [STORES.INVENTORY_EVENTS]: 'id, saleId, productId, timestamp, [saleId+productId], synced, [timestamp+synced]'
    }).upgrade(async tx => {
      // Si existen registros heredados, marcar como sincronizados
      await tx.table(STORES.INVENTORY_EVENTS).toCollection().modify(record => {
        if (!('synced' in record)) {
          record.synced = false;
          record.syncedAt = null;
        }
      });
    });

    this.version(13).stores({
      [STORES.SEQUENCES]: 'id'
    });

    // Versión 14: Sanitización de datos históricos (Single Source of Truth - Caja)
    // Limpia la deuda técnica de nomenclaturas incorrectas en movimientos y cajas.
    this.version(14).stores({}).upgrade(async tx => {
      // 1. Normalizar movimientos con tipo legacy 'ingreso' → 'entrada'
      await tx.table(STORES.MOVIMIENTOS_CAJA).toCollection().modify(record => {
        if (record.tipo === 'ingreso') {
          record.tipo = 'entrada';
        }
      });

      // 2. Consolidar campo fantasma 'ingresos_efectivo' → 'entradas_efectivo' en cajas
      await tx.table(STORES.CAJAS).toCollection().modify(record => {
        const ingresosAnomalo = Number(record.ingresos_efectivo || 0);
        if (ingresosAnomalo > 0) {
          const currentEntradas = Number(record.entradas_efectivo || 0);
          record.entradas_efectivo = String(currentEntradas + ingresosAnomalo);
        }
        delete record.ingresos_efectivo;
      });
    });

    // ============================================================
    // Versión 15: SSOT de Caducidad — Migración shelfLife → isPerishable + batch.expiryDate
    // ============================================================
    // Regla de negocio:
    //   1. Si product.shelfLife es un string de fecha válido → isPerishable = true,
    //      crear batch por defecto con ese shelfLife como expiryDate.
    //   2. Si product.shelfLife es un número (ej: "7" de frutería = 7 días) →
    //      isPerishable = true, calcular expiryDate = hoy + N días.
    //   3. Si product.shelfLife no existe o es vacío → isPerishable = false.
    //   4. En todos los casos: eliminar la propiedad shelfLife del producto.
    this.version(15).stores({}).upgrade(async tx => {
      const now = new Date();
      let batchesCreated = 0;
      let productsUpdated = 0;

      await tx.table(STORES.MENU).toCollection().modify(product => {
        const rawShelfLife = product.shelfLife;
        const hasValue = rawShelfLife !== undefined
          && rawShelfLife !== null
          && String(rawShelfLife).trim() !== '';

        if (!hasValue) {
          // Sin shelfLife → marcar como no perecedero (solo si no existe ya)
          if (product.isPerishable === undefined) {
            product.isPerishable = false;
          }
          delete product.shelfLife;
          return;
        }

        // Producto con shelfLife válido → marcar como perecedero
        product.isPerishable = true;

        // Determinar la fecha de caducidad para el batch por defecto
        const trimmed = String(rawShelfLife).trim();
        let resolvedExpiryDate = null;

        // Caso A: Es una fecha ISO/parseable (Farmacia, Abarrotes)
        const dateAttempt = new Date(trimmed);
        if (!Number.isNaN(dateAttempt.getTime()) && trimmed.length > 4) {
          resolvedExpiryDate = dateAttempt.toISOString();
        } else {
          // Caso B: Es un número de días (Frutería: shelfLife = "7")
          const daysAttempt = Number.parseInt(trimmed, 10);
          if (Number.isFinite(daysAttempt) && daysAttempt > 0) {
            const futureDate = new Date(now);
            futureDate.setDate(futureDate.getDate() + daysAttempt);
            resolvedExpiryDate = futureDate.toISOString();
          }
        }

        // Solo crear batch si el producto tiene stock Y pudimos resolver una fecha
        const currentStock = Number(product.stock) || 0;
        if (resolvedExpiryDate && currentStock > 0) {
          // Encolar creación del batch (Dexie .modify() no permite .add() directamente)
          product._pendingMigrationBatch = {
            expiryDate: resolvedExpiryDate,
            stock: currentStock,
            cost: Number(product.cost) || 0,
            price: Number(product.price) || 0
          };
        }

        // Asegurar que batchManagement esté habilitado
        if (!product.batchManagement || !product.batchManagement.enabled) {
          product.batchManagement = {
            enabled: true,
            selectionStrategy: product.batchManagement?.selectionStrategy || 'fefo'
          };
        }

        // Limpiar propiedad legacy
        delete product.shelfLife;
        productsUpdated++;
      });

      // Segunda pasada: Crear los batches pendientes
      const allProducts = await tx.table(STORES.MENU).toArray();
      const batchesToCreate = [];

      for (const product of allProducts) {
        if (!product._pendingMigrationBatch) continue;

        const migrationData = product._pendingMigrationBatch;
        const batchId = `batch-mig15-${product.id}-${Date.now()}`;

        batchesToCreate.push({
          id: batchId,
          productId: product.id,
          cost: migrationData.cost,
          price: migrationData.price,
          stock: migrationData.stock,
          committedStock: 0,
          expiryDate: migrationData.expiryDate,
          sku: null,
          supplier: null,
          attributes: null,
          location: product.location || '',
          notes: 'Lote creado automáticamente por migración v15 (shelfLife → batch)',
          trackStock: true,
          isActive: true,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updateGlobalPrice: false
        });
      }

      if (batchesToCreate.length > 0) {
        await tx.table(STORES.PRODUCT_BATCHES).bulkAdd(batchesToCreate);
        batchesCreated = batchesToCreate.length;
      }

      // Limpiar el campo temporal _pendingMigrationBatch
      await tx.table(STORES.MENU).toCollection().modify(product => {
        delete product._pendingMigrationBatch;
      });

      Logger.info(
        `[Migración v15] SSOT Caducidad completada. ` +
        `Productos actualizados: ${productsUpdated}. ` +
        `Lotes creados: ${batchesCreated}.`
      );
    });

    this.version(16).stores({
      [STORES.CORRUPTED_STATES]: 'id, timestamp'
    });

    this.version(17).stores({
      [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, [productId+isActive], [productId+isActive+createdAt], [isActive+stock]'
    });

    this.version(18).stores({
      [STORES.MENU]: 'id, createdAt, barcode, name_lower, categoryId, sku, expirationMode, shelfLifeValue, shelfLifeUnit',
      [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, [productId+isActive], [productId+isActive+createdAt], [isActive+stock], [activeStockStatus+alertTargetDate]'
    }).upgrade(async tx => {
      // 1. Barrer la tabla MENU: Transición de isPerishable a expirationMode
      await tx.table(STORES.MENU).toCollection().modify(record => {
        // Respetar estado si ya existe (Evitar sobreescritura de v2 parcial)
        if (record.expirationMode) {
          delete record.isPerishable;
          delete record.hasStrictExpiry;
          return;
        }
        record.expirationMode = record.isPerishable ? 'STRICT' : 'NONE';
        delete record.isPerishable;
        delete record.hasStrictExpiry;
      });

      // 2. Mapeo de Lotes Existentes: Migrar expiryDate a alertas e inicializar activeStockStatus
      await tx.table(STORES.PRODUCT_BATCHES).toCollection().modify(record => {
        // Crear clave indexable combinada
        const hasStock = Number(record.stock) > 0;
        record.activeStockStatus = (record.isActive && hasStock) ? 1 : 0;

        if (record.expiryDate && !record.alertTargetDate) {
          record.alertTargetDate = record.expiryDate;
          record.alertType = 'CADUCIDAD_LEGAL';
        }

        if (record.manufacturerBatchId === undefined) {
          record.manufacturerBatchId = null;
        }
      });
      });

      // ============================================================
      // Versión 19: Motor Invariante - Índices Robustos y Hooks de Coherencia
      // Elimina booleanos problemáticos de índices, usa enteros (1/0)
      // ============================================================
      this.version(19).stores({
      // Índice compuesto para consultas de productos activos con stock
      [STORES.MENU]: 'id, createdAt, barcode, name_lower, categoryId, sku, expirationMode, shelfLifeValue, shelfLifeUnit, activeStockStatus, [categoryId+activeStockStatus], [id+activeStockStatus]',
      // Índices de lotes con status activo como string (evita booleanos en índices compuestos)
      [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, status, activeStockStatus, [productId+status], [productId+activeStockStatus]'
      }).upgrade(async tx => {
      // Migración lazy: activeStockStatus se calculará on-demand via hooks
      // Solo inicializamos lotes existentes para el índice
      await tx.table(STORES.PRODUCT_BATCHES).toCollection().modify(record => {
        const hasStock = Number(record.stock) > 0;
        record.activeStockStatus = (record.isActive === true && hasStock) ? 1 : 0;
          
        // Normalizar campo status para índice (evita undefined)
        if (record.status === undefined || record.status === null) {
          record.status = record.isActive === false ? 'inactive' : 'active';
        }
      });

      // Inicializar activeStockStatus en productos
      await tx.table(STORES.MENU).toCollection().modify(record => {
        const isActive = record.isActive !== false;
        const hasStock = Number(record.stock) > 0;
        record.activeStockStatus = (isActive && hasStock) ? 1 : 0;
      });
      });
    }
  }

// Instancia Singleton
export const db = new LanzoDatabase();

db.table(STORES.CUSTOMERS).hook('creating', (_primaryKey, customer) => {
  customer.debtCents = normalizeCustomerDebtCents(customer.debt || 0);
});

db.table(STORES.CUSTOMERS).hook('updating', (mods, _primaryKey, customer) => {
  if (!Object.prototype.hasOwnProperty.call(mods, 'debt')) {
    return undefined;
  }

  return {
    debtCents: normalizeCustomerDebtCents(mods.debt ?? customer?.debt ?? 0)
  };
});

// ============================================================
// HOOKS DE MOTOR INVARIANTE - FASE 1
// Garantizan coherencia estructural en el motor de base de datos
// ============================================================

/**
 * Hook 'creating' para productos: Establece activeStockStatus inicial
 * Convierte booleanos problemáticos a enteros (1/0) para índices robustos
 */
db.table(STORES.MENU).hook('creating', function (primKey, obj, transaction) {
  // Garantiza que el insert inicial sea coherente
  const isActive = obj.isActive !== false;
  const hasStock = Number(obj.stock) > 0;
  obj.activeStockStatus = (isActive && hasStock) ? 1 : 0;
});

/**
 * Hook 'updating' para productos: Mantiene activeStockStatus sincronizado
 * Se ejecuta automáticamente en cada update, asegurando consistencia
 */
db.table(STORES.MENU).hook('updating', function (modifications, primKey, obj, transaction) {
  // Fusiona el objeto actual con las modificaciones para evaluar el estado final
  const nextState = { ...obj, ...modifications };
  const isActive = nextState.isActive !== false;
  const hasStock = Number(nextState.stock) > 0;
  const nextStatus = (isActive && hasStock) ? 1 : 0;

  // Si el estado derivado cambia, inyéctalo en las modificaciones de esta transacción
  if (nextState.activeStockStatus !== nextStatus) {
    modifications.activeStockStatus = nextStatus;
  }
});

/**
 * Hook 'creating' para lotes: Establece activeStockStatus inicial
 */
db.table(STORES.PRODUCT_BATCHES).hook('creating', function (primKey, obj, transaction) {
  const isActive = obj.isActive !== false;
  const hasStock = Number(obj.stock) > 0;
  obj.activeStockStatus = (isActive && hasStock) ? 1 : 0;
  
  // Normalizar campo status para índices (evita booleanos en índices compuestos)
  if (obj.status === undefined || obj.status === null) {
    obj.status = isActive ? 'active' : 'inactive';
  }
});

/**
 * Hook 'updating' para lotes: Mantiene activeStockStatus sincronizado
 */
db.table(STORES.PRODUCT_BATCHES).hook('updating', function (modifications, primKey, obj, transaction) {
  const nextState = { ...obj, ...modifications };
  const isActive = nextState.isActive !== false;
  const hasStock = Number(nextState.stock) > 0;
  const nextStatus = (isActive && hasStock) ? 1 : 0;

  // Actualizar activeStockStatus si cambió
  if (nextState.activeStockStatus !== nextStatus) {
    modifications.activeStockStatus = nextStatus;
  }
  
  // Sincronizar status string si cambia isActive
  if (modifications.isActive !== undefined && modifications.status === undefined) {
    modifications.status = modifications.isActive ? 'active' : 'inactive';
  }
});

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
