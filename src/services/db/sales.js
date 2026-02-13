import { db, STORES } from './dexie';
import { handleDexieError, DatabaseError, DB_ERROR_CODES } from './utils';

/**
 * Repositorio de Ventas.
 * Maneja transacciones críticas de facturación y consistencia de stock.
 */
export const salesRepository = {

    /**
     * 🔥 VERSIÓN OPTIMIZADA CON RECALCULACIÓN INTELIGENTE
     * 
     * Ejecuta una venta de forma Transaccional y Atómica.
     * Actualiza stocks (Lotes y Productos Padre), guarda la venta y genera log.
     * 
     * MEJORAS:
     * - Pre-carga lotes en memoria (1 query por producto)
     * - Recalcula stock del padre sumando lotes (autocorrección)
     * - Evita doble deducción
     * 
     * @param {object} sale - Objeto de venta completo.
     * @param {Array} deductions - Array de { batchId, quantity, productId }.
     */
    async executeSaleTransaction(sale, deductions) {
        try {
            // Definimos las tablas involucradas para bloquearlas (Read-Write)
            return await db.transaction('rw', [
                db.table(STORES.SALES),
                db.table(STORES.PRODUCT_BATCHES),
                db.table(STORES.MENU),
                db.table(STORES.TRANSACTION_LOG),
                db.table(STORES.CUSTOMERS)
            ], async () => {

                // 1. Verificación de Idempotencia (Evitar duplicados)
                const existingSale = await db.table(STORES.SALES).get(sale.id);
                if (existingSale) {
                    throw new DatabaseError(
                        DB_ERROR_CODES.CONSTRAINT_VIOLATION,
                        'La venta ya fue procesada anteriormente.'
                    );
                }

                // ============================================================
                // 2. PRE-CARGA INTELIGENTE DE LOTES (OPTIMIZACIÓN CLAVE)
                // ============================================================
                // Identificamos qué productos necesitamos recalcular
                const affectedProductIds = new Set();

                // A. Productos con deducciones de lotes
                deductions.forEach(({ productId }) => {
                    if (productId) affectedProductIds.add(productId);
                });

                // B. Productos vendidos directamente (sin lotes)
                if (sale.items && Array.isArray(sale.items)) {
                    sale.items.forEach(item => {
                        if (!item.batchesUsed || item.batchesUsed.length === 0) {
                            const pid = item.parentId || item.id;
                            if (pid) affectedProductIds.add(pid);
                        }
                    });
                }

                // C. CACHEO: Una sola query por producto (muy rápido)
                const batchesCacheMap = new Map();

                await Promise.all(
                    Array.from(affectedProductIds).map(async (productId) => {
                        const batches = await db.table(STORES.PRODUCT_BATCHES)
                            .where('productId').equals(productId)
                            .toArray(); // Traemos TODOS (activos e inactivos)

                        batchesCacheMap.set(productId, batches);
                    })
                );

                // ============================================================
                // 3. VALIDACIÓN Y DESCUENTO DE LOTES
                // ============================================================
                // Mapa temporal para trackear cambios en memoria
                const batchUpdates = new Map();

                for (const { batchId, quantity, productId } of deductions) {
                    if (quantity <= 0) continue;

                    // Obtener lote del caché (ya lo tenemos en RAM)
                    const productBatches = batchesCacheMap.get(productId) || [];
                    let batch = productBatches.find(b => b.id === batchId);

                    // Si no está en caché, lo buscamos en BD (caso raro)
                    if (!batch) {
                        batch = await db.table(STORES.PRODUCT_BATCHES).get(batchId);
                    }

                    if (!batch) {
                        throw new Error(
                            `Integridad Crítica: El lote ${batchId} no existe.`
                        );
                    }

                    // Validación de Stock (Atomic Check)
                    if (batch.stock < quantity) {
                        throw new Error(
                            `STOCK_INSUFFICIENT: Lote ${batch.sku || batchId} tiene ${batch.stock}, se requiere ${quantity}`
                        );
                    }

                    // Actualizar en memoria primero
                    const newStock = batch.stock - quantity;
                    const updatedBatch = {
                        ...batch,
                        stock: newStock,
                        isActive: newStock > 0.0001
                    };

                    // Guardar cambio en el mapa temporal
                    batchUpdates.set(batchId, updatedBatch);

                    // Actualizar también el caché para el recálculo posterior
                    const batchIndex = productBatches.findIndex(b => b.id === batchId);
                    if (batchIndex >= 0) {
                        productBatches[batchIndex] = updatedBatch;
                    }

                    // Persistir en BD
                    await db.table(STORES.PRODUCT_BATCHES).put(updatedBatch);
                }

                // ============================================================
                // 4. RECALCULACIÓN INTELIGENTE DEL STOCK PADRE
                // ============================================================
                // Ahora que los lotes están actualizados, recalculamos el padre

                for (const productId of affectedProductIds) {
                    const product = await db.table(STORES.MENU).get(productId);

                    if (!product) continue; // Producto eliminado (caso extremo)

                    // Solo recalculamos si trackea stock
                    if (product.trackStock) {

                        // OPCIÓN A: Si el producto USA LOTES
                        if (product.batchManagement?.enabled) {
                            // Suma de lotes activos (ya actualizados en el caché)
                            const productBatches = batchesCacheMap.get(productId) || [];

                            const totalStock = productBatches
                                .filter(b => {
                                    const stockVal = Number(b.stock);
                                    return b.isActive && !isNaN(stockVal) && stockVal > 0.0001;
                                })
                                .reduce((sum, b) => sum + Number(b.stock), 0);

                            // Actualizar padre con el stock REAL calculado
                            await db.table(STORES.MENU).update(productId, {
                                stock: totalStock,
                                updatedAt: new Date().toISOString()
                            });
                        }
                        // OPCIÓN B: Si el producto NO USA LOTES (descuento directo)
                        else {
                            // Calculamos cuánto se vendió de este producto
                            let totalSold = 0;

                            sale.items.forEach(item => {
                                const itemProductId = item.parentId || item.id;
                                if (itemProductId === productId) {
                                    totalSold += item.quantity || 0;
                                }
                            });

                            if (totalSold > 0) {
                                let newStock = product.stock - totalSold;
                                if (newStock < 0) newStock = 0; // Protección

                                await db.table(STORES.MENU).update(productId, {
                                    stock: newStock,
                                    updatedAt: new Date().toISOString()
                                });
                            }
                        }
                    }
                }

                // ============================================================
                // 4.5 ACTUALIZACIÓN DE DEUDA DEL CLIENTE
                // ============================================================
                // Al hacerlo aquí, garantizamos que si esto falla, la venta NO se guarda.
                if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
                    const customer = await db.table(STORES.CUSTOMERS).get(sale.customerId);

                    if (customer) {
                        await db.table(STORES.CUSTOMERS).update(sale.customerId, {
                            debt: (customer.debt || 0) + sale.saldoPendiente,
                            updatedAt: new Date().toISOString()
                        });
                    } else {
                        // Opcional: Lanzar error si el cliente no existe, para abortar la venta
                        throw new Error(`Integridad: El cliente ${sale.customerId} no existe.`);
                    }
                }

                // ============================================================
                // 5. GUARDAR LA VENTA
                // ============================================================
                const saleToSave = {
                    ...sale,
                    postEffectsCompleted: true
                };
                await db.table(STORES.SALES).add(saleToSave);

                // ============================================================
                // 6. LOG DE AUDITORÍA
                // ============================================================
                const transactionId = `tx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
                await db.table(STORES.TRANSACTION_LOG).add({
                    id: transactionId,
                    type: 'SALE',
                    status: 'COMPLETED',
                    timestamp: new Date().toISOString(),
                    amount: sale.total,
                    saleId: sale.id
                });

                return { success: true, transactionId };
            });

        } catch (error) {
            // Manejo especial para errores de negocio (Stock) vs errores técnicos
            if (error.message && error.message.includes('STOCK_INSUFFICIENT')) {
                return {
                    success: false,
                    isStockError: true,
                    message: error.message
                };
            }

            throw handleDexieError(error, 'Execute Sale Transaction');
        }
    },

    /**
     * Obtiene ventas desde una fecha específica hasta hoy.
     * Utiliza el índice 'timestamp' para evitar escanear toda la tabla.
     * 
     * @param {string} isoDateString - Fecha de inicio en formato ISO.
     */
    async getOrdersSince(isoDateString) {
        try {
            return await db.table(STORES.SALES)
                .where('timestamp').aboveOrEqual(isoDateString)
                .toArray();
        } catch (error) {
            throw handleDexieError(error, 'Get Orders Since');
        }
    },

    /**
     * Obtiene una venta por ID.
     */
    async getSaleById(saleId) {
        try {
            return await db.table(STORES.SALES).get(saleId);
        } catch (error) {
            throw handleDexieError(error, 'Get Sale By ID');
        }
    }
};