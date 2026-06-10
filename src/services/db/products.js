import { db, STORES } from './dexie';
import Dexie from 'dexie';
import {
    handleDexieError,
    validateOrThrow,
    DatabaseError,
    DB_ERROR_CODES,
    getCommittedStock
} from './utils';
import { generateID } from '../utils';
import { productSchema } from '../../schemas/productSchema';
import Logger from '../Logger';
import { collectBatchRestorations, restoreBatchStock } from '../sales/batchRestoration';

const DEFAULT_SEARCH_LIMIT = 50;

const normalizeSearchValue = (value) =>
    value === null || value === undefined ? '' : String(value).toLowerCase();

const isActiveProduct = (product) => product?.isActive !== false;

const matchesStatus = (product, status) => {
    const isActive = isActiveProduct(product);
    if (status === 'active') return isActive;
    if (status === 'inactive') return !isActive;
    return true;
};

export const searchProductsInDB = async (searchTerm, status = 'active') => {
    try {
        const normalizedTerm = normalizeSearchValue(searchTerm).trim();
        if (!normalizedTerm) return [];

        const productTable = db.table(STORES.MENU);

        if (/^\d+$/.test(normalizedTerm)) {
            const exactBarcode = await productTable
                .where('barcode')
                .equals(normalizedTerm)
                .first();

            if (exactBarcode && matchesStatus(exactBarcode, status)) {
                return [exactBarcode];
            }

            const exactSku = await productTable
                .where('sku')
                .equals(normalizedTerm)
                .first();

            if (exactSku && matchesStatus(exactSku, status)) {
                return [exactSku];
            }
        }

        // BÚSQUEDA POR NOMBRE (usa startsWith - eficiente)
        const nameResults = await productTable
            .where('name_lower')
            .startsWith(normalizedTerm)
            .filter((product) => matchesStatus(product, status))
            .limit(DEFAULT_SEARCH_LIMIT)
            .toArray();

        const takenIds = new Set(nameResults.map((p) => p.id));

        // BÚSQUEDA POR CÓDIGO/SKU (búsqueda global - siempre se ejecuta)
        const codeResults = await productTable
            .filter((product) => {
                if (!matchesStatus(product, status)) return false;
                if (takenIds.has(product.id)) return false;

                // Busca por código, SKU o nombre con contains (no solo startsWith)
                const barcode = normalizeSearchValue(product?.barcode);
                const sku = normalizeSearchValue(product?.sku);
                const name = normalizeSearchValue(product?.name_lower || product?.name);
                
                return barcode.includes(normalizedTerm) || 
                       sku.includes(normalizedTerm) || 
                       name.includes(normalizedTerm);
            })
            .limit(DEFAULT_SEARCH_LIMIT - nameResults.length)
            .toArray();

        return [...nameResults, ...codeResults];
    } catch (error) {
        throw handleDexieError(error, 'searchProductsInDB');
    }
};

/**
 * Repositorio especializado en Inventario y Productos.
 * Maneja lógica compleja de lotes, variantes y sincronización de precios.
 */
export const productsRepository = {

  /**
   * MOTOR INVARIANTE V4.1: Método atómico para restauración de stock en cancelaciones
   *
   * Restaura stock de lotes y productos padre durante una cancelación.
   * USO OBLIGATORIO: Todas las cancelaciones deben usar esta función.
   *
   * Este método garantiza que:
   * 1. Los hooks de Dexie se disparen correctamente (usa db.table().put(), NO saveDataSafe)
   * 2. El índice activeStockStatus se mantenga sincronizado automáticamente
   * 3. La operación sea atómica (transacción completa o nada)
   *
   * @param {Array} items - Items de la venta cancelada (con batchesUsed o stockDeducted)
   * @returns {Promise<{restored: Array, warnings: Array, restoredInventoryValue: number}>}
   */
  async restoreStockFromCancellation(items) {
    const { normalizeStock } = await import('./utils.js');
    const warnings = [];
    const restored = [];
    let restoredInventoryValue = 0;

    return await db.transaction('rw',
      [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)],
      async () => {
        // 1. Recopilar todos los IDs necesarios
        const batchIds = new Set();
        const productIds = new Set();
        const batchDeductions = collectBatchRestorations(items);
        const productDeductions = new Map(); // productId -> cantidad total a restaurar

        for (const item of items || []) {
          const hasBatches = Array.isArray(item?.batchesUsed) && item.batchesUsed.length > 0;

          if (hasBatches) {
            for (const batchUsage of item.batchesUsed) {
              if (!batchUsage?.batchId) continue;
              batchIds.add(batchUsage.batchId);
            }
          } else {
            const productId = item?.parentId || item?.id;
            if (!productId) {
              warnings.push({
                code: 'INVALID_ITEM',
                message: 'Item sin productId ni parentId',
                item
              });
              continue;
            }
            productIds.add(productId);
            const quantityToRestore = Number(item?.stockDeducted ?? item?.quantity ?? 0);
            const current = productDeductions.get(productId) || 0;
            productDeductions.set(productId, current + quantityToRestore);
          }
        }

        // 2. bulkGet para cargar estado actual de lotes
        const batchesArray = batchIds.size > 0
          ? await db.table(STORES.PRODUCT_BATCHES).bulkGet([...batchIds])
          : [];
        const batchesMap = new Map(batchesArray.filter(Boolean).map(b => [b.id, b]));

        // 3. Calcular nuevos stocks y aplicar actualizaciones a lotes (con put para disparar hooks)
        const affectedParentIds = new Set();

        for (const [batchId, deduction] of batchDeductions) {
          const batch = batchesMap.get(batchId);

          if (!batch) {
            warnings.push({
              code: 'BATCH_NOT_FOUND',
              message: `Lote ${batchId} no encontrado para restauración`,
              batchId
            });
            continue;
          }

          const quantityToRestore = deduction.quantity;
          const { updatedBatch, restorationValue, newStock } = restoreBatchStock({
            batch,
            restoration: deduction,
            normalizeStock,
            updatedAt: new Date().toISOString()
          });

          // El objeto parte del lote actual: solo cambia stock/estado, nunca su costo.
          await db.table(STORES.PRODUCT_BATCHES).put(updatedBatch);
          restoredInventoryValue += restorationValue;

          restored.push({
            type: 'batch',
            id: batchId,
            previousStock: batch.stock,
            newStock,
            restoredQuantity: quantityToRestore,
            restorationValue
          });

          // Trackear producto padre para sincronización
          const parentId = batch.productId;
          if (parentId) {
            affectedParentIds.add(parentId);
            productIds.add(parentId);
          }
        }

        // 4. Restaurar stock de productos simples (sin lotes)
        const productsArray = productIds.size > 0
          ? await db.table(STORES.MENU).bulkGet([...productIds])
          : [];
        const productsMap = new Map(productsArray.filter(Boolean).map(p => [p.id, p]));

        for (const [productId, quantityToRestore] of productDeductions) {
          const product = productsMap.get(productId);

          if (!product) {
            warnings.push({
              code: 'PRODUCT_NOT_FOUND',
              message: `Producto ${productId} no encontrado para restauración`,
              productId
            });
            continue;
          }

          // Saltar productos que no trackean stock
          if (product.trackStock === false) {
            continue;
          }

          const newStock = normalizeStock(Number(product.stock || 0) + quantityToRestore);

          // CRÍTICO: Usar .put() para disparar el hook 'updating'
          const updatedProduct = {
            ...product,
            stock: newStock,
            updatedAt: new Date().toISOString()
            // NOTA: activeStockStatus NO se calcula aquí - lo calcula el hook de Dexie
          };

          await db.table(STORES.MENU).put(updatedProduct);

          restored.push({
            type: 'product',
            id: productId,
            previousStock: product.stock,
            newStock,
            restoredQuantity: quantityToRestore
          });
        }

        // 5. Sincronizar productos padre afectados por lotes
        // Recalcular stock total de todos los lotes activos para cada padre
        for (const parentId of affectedParentIds) {
          const parentProduct = productsMap.get(parentId);
          if (!parentProduct) continue;

          // Obtener TODOS los lotes del producto (incluyendo los recién actualizados)
          const allBatches = await db.table(STORES.PRODUCT_BATCHES)
            .where('productId')
            .equals(parentId)
            .toArray();

          const totalStock = allBatches
            .filter(b => b?.isActive && Number(b?.stock) > 0)
            .reduce((sum, b) => sum + Number(b?.stock || 0), 0);

          // Solo actualizar si el stock calculado difiere del actual
          if (Math.abs((parentProduct.stock || 0) - totalStock) > 0.0001) {
            const updatedParent = {
              ...parentProduct,
              stock: normalizeStock(totalStock),
              updatedAt: new Date().toISOString()
            };

            await db.table(STORES.MENU).put(updatedParent);

            restored.push({
              type: 'parent_sync',
              id: parentId,
              previousStock: parentProduct.stock,
              newStock: totalStock,
              source: 'batch_aggregation'
            });
          }
        }

        return {
          restored,
          warnings,
          restoredInventoryValue: Number(restoredInventoryValue.toFixed(2))
        };
      }
    );
  },
    /**
     * Guarda un lote (Batch), valida sus datos y sincroniza automáticamente
     * el stock y costos del producto padre (FIFO).
     * @param {object} batchData - Datos del lote a guardar.
     */
    async saveBatchAndSyncProduct(batchData) {
        try {
            // Usamos una transacción Read-Write para garantizar integridad.
            // Si algo falla, Dexie hace rollback automático de ambos cambios.
            return await db.transaction('rw', [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)], async () => {
                const existingBatch = batchData?.id
                    ? await db.table(STORES.PRODUCT_BATCHES).get(batchData.id)
                    : null;
                const normalizedBatchData = {
                    ...existingBatch,
                    ...batchData,
                    committedStock: batchData?.committedStock ?? existingBatch?.committedStock ?? 0
                };

                // 1. Guardar el lote (Upsert)
                // Nota: Aquí podrías agregar validación Zod para batchData si creas un batchSchema
                await db.table(STORES.PRODUCT_BATCHES).put(normalizedBatchData);

                // 2. Obtener TODOS los lotes de este producto para recalcular
                // Usamos el índice 'productId' definido en dexie.js
                const allBatches = await db.table(STORES.PRODUCT_BATCHES)
                    .where('productId').equals(normalizedBatchData.productId)
                    .toArray();

                // --- INSERTA ESTO ---
                // 3. Lógica de Sincronización Diferenciada (Variantes vs Lotes)
                let totalStock = 0;
                let totalCommittedStock = 0;
                let totalValue = 0; // Acumulador para el Costo Promedio Ponderado
                let isVariantProduct = false;

                for (const batch of allBatches) {
                    // 3.1 Detección de Variante: Si el lote tiene atributos (ej. talla, color), el producto es multiprecio.
                    if (batch.attributes && Object.keys(batch.attributes).length > 0) {
                        isVariantProduct = true;
                    }

                    totalCommittedStock += getCommittedStock(batch);

                    if (batch.isActive && Number(batch.stock) > 0) {
                        const safeStock = Number(batch.stock) || 0;
                        const safeCost = Number(batch.cost) || 0;

                        totalStock += safeStock;
                        totalValue += (safeCost * safeStock);
                    }
                }

                // 4. Actualizar el Producto Padre
                const productStore = db.table(STORES.MENU);
                const product = await productStore.get(normalizedBatchData.productId);

                if (product) {
                    let newCost = product.cost;
                    let newPrice = product.price;

                    if (isVariantProduct) {
                        // CASO A: ES UNA VARIANTE (Ej. Ropa, Zapatos)
                        // Regla: El padre solo actúa como contenedor de stock. 
                        // NO sobreescribimos su precio ni costo, porque cada variante (lote) tiene el suyo propio
                        // y el POS ya los resuelve correctamente vía `searchProductBySKU`.
                        newCost = product.cost;
                        newPrice = product.price;
                    } else {
                        // CASO B: ES UN LOTE NORMAL (Ej. Caducidades, Insumos)
                        // Regla: Aplicamos Costo Promedio Ponderado (Fórmula Contable Estándar)
                        if (totalStock > 0) {
                            newCost = Number((totalValue / totalStock).toFixed(4));
                        } else {
                            newCost = Number(normalizedBatchData.cost) || 0; // Fallback a la compra actual si el inventario estaba en 0
                        }

                        // El precio del producto padre es soberano.
                        // Solo se actualiza si el payload del lote trae una bandera explícita.
                        newPrice = normalizedBatchData.updateGlobalPrice === true ? Number(normalizedBatchData.price) : product.price;
                    }

                    const updatedProduct = {
                        ...product,
                        stock: totalStock,
                        committedStock: totalCommittedStock,
                        cost: newCost,
                        price: newPrice,
                        hasBatches: true,
                        lastSupplier: normalizedBatchData.supplier || product.lastSupplier || product.supplier,
                        updatedAt: new Date().toISOString()
                    };

                    // Validamos antes de guardar el padre para asegurar integridad
                    validateOrThrow(productSchema, updatedProduct, 'Sync Product Parent');

                    await productStore.put(updatedProduct);
                }

                return { success: true };
            });

        } catch (error) {
            throw handleDexieError(error, 'Save Batch & Sync');
        }
    },

    /**
     * ⚡ VERSIÓN ULTRA ROBUSTA ⚡
     * Procesa deducciones de stock de lotes (Para Mermas, Ajustes, Consumo interno, Ventas).
     * 
     * MEJORAS IMPLEMENTADAS:
     * 1. Validación exhaustiva de entrada
     * 2. Pre-validación de stocks ANTES de modificar la BD
     * 3. Rollback automático en caso de error
     * 4. Logs detallados de auditoría
     * 5. Detección de race conditions
     * 6. Manejo de errores específicos por tipo
     * 7. Métricas de performance
     * 
     * @param {Array} deductions - Array de { batchId, quantity, reason? }
     * @param {Object} options - { validateStock: true, logDetails: false, dryRun: false }
     * @returns {Promise<{success: boolean, details: Object}>}
     */
    async processBatchDeductions(deductions, options = {}) {
        // ═══════════════════════════════════════════════════════════
        // FASE 0: CONFIGURACIÓN Y VALIDACIÓN DE ENTRADA
        // ═══════════════════════════════════════════════════════════
        const config = {
            validateStock: options.validateStock !== false, // Por defecto: true
            logDetails: options.logDetails === true,        // Por defecto: false (performance)
            dryRun: options.dryRun === true,                // Por defecto: false
            allowPartial: options.allowPartial === false,   // Si true, procesa lo que pueda
            tolerance: options.tolerance || 0.0001          // Tolerancia para comparación de floats
        };

        const startTime = Date.now();
        const operationId = generateID('opd');

        // Validación de entrada básica
        if (!Array.isArray(deductions) || deductions.length === 0) {
            throw new DatabaseError(
                DB_ERROR_CODES.VALIDATION_ERROR,
                'Las deducciones deben ser un array no vacío',
                { operationId }
            );
        }

        // Validar estructura de cada deducción
        const validatedDeductions = [];
        const errors = [];

        for (let i = 0; i < deductions.length; i++) {
            const item = deductions[i];

            // Validaciones básicas
            if (!item || typeof item !== 'object') {
                errors.push(`Índice ${i}: Debe ser un objeto`);
                continue;
            }

            if (!item.batchId || typeof item.batchId !== 'string') {
                errors.push(`Índice ${i}: batchId inválido o faltante`);
                continue;
            }

            const quantity = Number(item.quantity);
            if (isNaN(quantity) || quantity <= 0) {
                errors.push(`Índice ${i}: quantity debe ser un número positivo (recibido: ${item.quantity})`);
                continue;
            }

            validatedDeductions.push({
                batchId: item.batchId,
                quantity: quantity,
                reason: item.reason || 'Deducción sin razón especificada',
                originalIndex: i
            });
        }

        if (errors.length > 0 && !config.allowPartial) {
            throw new DatabaseError(
                DB_ERROR_CODES.VALIDATION_ERROR,
                `Errores de validación: ${errors.join('; ')}`,
                { operationId, errors }
            );
        }

        if (validatedDeductions.length === 0) {
            throw new DatabaseError(
                DB_ERROR_CODES.VALIDATION_ERROR,
                'No hay deducciones válidas para procesar',
                { operationId, originalCount: deductions.length }
            );
        }

        // Detectar duplicados (mismo batchId aparece varias veces)
        const batchIdCounts = new Map();
        validatedDeductions.forEach(d => {
            batchIdCounts.set(d.batchId, (batchIdCounts.get(d.batchId) || 0) + 1);
        });

        const duplicates = Array.from(batchIdCounts.entries())
            .filter(([_, count]) => count > 1)
            .map(([id]) => id);

        if (duplicates.length > 0) {
            Logger.warn(`⚠️ [${operationId}] Lotes duplicados en deducciones:`, duplicates);
        }

        try {
            // ═══════════════════════════════════════════════════════════
            // FASE 1: TRANSACCIÓN ATÓMICA
            // ═══════════════════════════════════════════════════════════
            return await db.transaction('rw', [
                db.table(STORES.PRODUCT_BATCHES),
                db.table(STORES.MENU)
            ], async () => {

                const affectedProductIds = new Set();
                const updatedBatchesMap = new Map(); // Verdad absoluta en memoria
                const deductionSummary = []; // Para logs detallados

                // ═══════════════════════════════════════════════════════════
                // SUBFASE 1.1: PRE-VALIDACIÓN (Fetch de todos los lotes afectados)
                // ═══════════════════════════════════════════════════════════
                const batchIds = [...new Set(validatedDeductions.map(d => d.batchId))];
                const batchesSnapshot = await db.table(STORES.PRODUCT_BATCHES)
                    .where('id')
                    .anyOf(batchIds)
                    .toArray();

                // Crear índice rápido por ID
                const batchesById = new Map(batchesSnapshot.map(b => [b.id, b]));

                // Validar existencia y stock ANTES de modificar nada
                const stockValidationErrors = [];

                for (const deduction of validatedDeductions) {
                    const batch = batchesById.get(deduction.batchId);

                    // Error 1: Lote no existe
                    if (!batch) {
                        stockValidationErrors.push({
                            batchId: deduction.batchId,
                            error: 'BATCH_NOT_FOUND',
                            message: `El lote ${deduction.batchId} no existe en la base de datos`
                        });
                        continue;
                    }

                    // Error 2: Lote inactivo
                    if (batch.isActive === false) {
                        stockValidationErrors.push({
                            batchId: deduction.batchId,
                            error: 'BATCH_INACTIVE',
                            message: `El lote ${batch.sku || batch.id} está inactivo`
                        });
                        continue;
                    }

                    // Error 3: Stock insuficiente (con tolerancia para floats)
                    if (config.validateStock && (batch.stock + config.tolerance) < deduction.quantity) {
                        stockValidationErrors.push({
                            batchId: deduction.batchId,
                            sku: batch.sku,
                            error: 'INSUFFICIENT_STOCK',
                            message: `Lote ${batch.sku || batch.id}: Stock actual ${batch.stock.toFixed(4)}, requerido ${deduction.quantity.toFixed(4)}`,
                            available: batch.stock,
                            requested: deduction.quantity,
                            deficit: deduction.quantity - batch.stock
                        });
                    }
                }

                // Si hay errores de validación y no permitimos parciales, abortar TODO
                if (stockValidationErrors.length > 0 && !config.allowPartial) {
                    const errorMsg = stockValidationErrors
                        .map(e => e.message)
                        .join('\n• ');

                    throw new DatabaseError(
                        DB_ERROR_CODES.CONSTRAINT_VIOLATION,
                        `❌ Validación de stock falló:\n• ${errorMsg}`,
                        {
                            operationId,
                            errors: stockValidationErrors,
                            totalDeductions: validatedDeductions.length,
                            failedDeductions: stockValidationErrors.length
                        }
                    );
                }

                // Filtrar deducciones válidas si permitimos parciales
                const validDeductions = config.allowPartial
                    ? validatedDeductions.filter(d =>
                        !stockValidationErrors.some(e => e.batchId === d.batchId)
                    )
                    : validatedDeductions;

                if (validDeductions.length === 0) {
                    throw new DatabaseError(
                        DB_ERROR_CODES.VALIDATION_ERROR,
                        'No hay deducciones válidas para procesar después de validación',
                        { operationId, stockValidationErrors }
                    );
                }

                // ═══════════════════════════════════════════════════════════
                // SUBFASE 1.2: AGRUPAR DEDUCCIONES POR LOTE (Consolidar)
                // ═══════════════════════════════════════════════════════════
                // Si un lote aparece múltiples veces, sumamos las cantidades
                const consolidatedDeductions = new Map();

                for (const deduction of validDeductions) {
                    const existing = consolidatedDeductions.get(deduction.batchId) || {
                        batchId: deduction.batchId,
                        totalQuantity: 0,
                        reasons: []
                    };

                    existing.totalQuantity += deduction.quantity;
                    existing.reasons.push(deduction.reason);
                    consolidatedDeductions.set(deduction.batchId, existing);
                }

                // ═══════════════════════════════════════════════════════════
                // SUBFASE 1.3: APLICAR DEDUCCIONES (Batch Updates)
                // ═══════════════════════════════════════════════════════════
                if (config.dryRun) {
                    Logger.log(`[DRY RUN] Se procesarían ${consolidatedDeductions.size} lotes`);
                } else {
                    for (const [batchId, consolidated] of consolidatedDeductions) {

                        // --- INICIO CAMBIO PARA AUDITORÍA (RACE CONDITION FIX) ---

                        // 1. Obtenemos la versión FRESCA de la BD, ignorando el snapshot de memoria inicial
                        const freshBatch = await db.table(STORES.PRODUCT_BATCHES).get(batchId);

                        // Seguridad: Si el lote desapareció en medio de la transacción
                        if (!freshBatch) {
                            throw new DatabaseError(DB_ERROR_CODES.NOT_FOUND, `El lote ${batchId} fue eliminado durante la transacción.`);
                        }

                        // 2. Validación de seguridad de último milisegundo
                        // Si el stock fresco es menor a lo que queremos deducir, abortamos para evitar negativos
                        if (config.validateStock && (freshBatch.stock + config.tolerance) < consolidated.totalQuantity) {
                            throw new DatabaseError(
                                DB_ERROR_CODES.CONSTRAINT_VIOLATION,
                                `RACE CONDITION DETECTADA: El stock del lote cambió durante el proceso. (Actual: ${freshBatch.stock}, Requerido: ${consolidated.totalQuantity})`
                            );
                        }

                        // 3. Usamos freshBatch para el cálculo final
                        const newStock = Math.max(0, freshBatch.stock - consolidated.totalQuantity);

                        // --- FIN CAMBIO ---

                        const updatedBatch = {
                            ...freshBatch, // Usamos freshBatch, no batch del snapshot
                            stock: newStock,
                            isActive: newStock > config.tolerance,
                            lastDeductionAt: new Date().toISOString(),
                            lastDeductionReason: consolidated.reasons.join('; ')
                        };

                        // Persistir en BD
                        await db.table(STORES.PRODUCT_BATCHES).put(updatedBatch);

                        // Guardar en memoria para sincronización del padre (Subfase 1.4)
                        updatedBatchesMap.set(batchId, updatedBatch);
                        affectedProductIds.add(freshBatch.productId);

                        // ... (El resto del log sigue igual)
                        deductionSummary.push({
                            batchId,
                            sku: freshBatch.sku,
                            // ...
                        });
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // 🔥 SUBFASE 1.4: SINCRONIZAR PRODUCTOS PADRE (OPTIMIZADO)
                // ═══════════════════════════════════════════════════════════
                const parentUpdateSummary = [];

                for (const productId of affectedProductIds) {
                    // 1. Filtro temprano en el motor de base de datos
                    const activeDbBatches = await db.table(STORES.PRODUCT_BATCHES)
                        .where('productId').equals(productId)
                        .filter(b => b.isActive === true && b.stock > 0)
                        .toArray();

                    // 2. Fusión de Estado (Verdad Absoluta en memoria)
                    const truthMap = new Map();

                    for (const b of activeDbBatches) {
                        if (b && b.id) truthMap.set(b.id, b);
                    }

                    // Sobrescribir con las modificaciones de la transacción actual
                    for (const [batchId, memoryBatch] of updatedBatchesMap.entries()) {
                        if (String(memoryBatch.productId) === String(productId)) {
                            truthMap.set(batchId, memoryBatch);
                        }
                    }

                    // 3. Cálculo de stock aritmético directo O(K)
                    let totalStock = 0;
                    let activeBatchesCount = 0;

                    for (const b of truthMap.values()) {
                        const stockVal = Number(b.stock);
                        const isActuallyActive = Boolean(b.isActive) && !isNaN(stockVal) && stockVal > config.tolerance;

                        // Ignoramos lotes que acaban de morir o vaciarse en esta transacción
                        if (isActuallyActive) {
                            totalStock += stockVal;
                            activeBatchesCount++;
                        }
                    }

                    // 4. Actualizar producto padre
                    const product = await db.table(STORES.MENU).get(productId);

                    if (!product) {
                        Logger.warn(`⚠️ Producto padre ${productId} no encontrado. Saltando sincronización.`);
                        continue;
                    }

                    if (product.trackStock) {
                        const stockBefore = product.stock || 0;

                        if (!config.dryRun) {
                            await db.table(STORES.MENU).update(productId, {
                                stock: totalStock,
                                isActive: product.isActive !== false,
                                updatedAt: new Date().toISOString()
                            });
                        }

                        parentUpdateSummary.push({
                            productId,
                            name: product.name,
                            stockBefore,
                            stockAfter: totalStock,
                            activeBatches: activeBatchesCount
                        });
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // FASE 2: RESULTADO Y MÉTRICAS
                // ═══════════════════════════════════════════════════════════
                const duration = Date.now() - startTime;

                const result = {
                    success: true,
                    operationId,
                    dryRun: config.dryRun,
                    metrics: {
                        duration,
                        deductionsProcessed: validDeductions.length,
                        deductionsSkipped: validatedDeductions.length - validDeductions.length,
                        batchesUpdated: consolidatedDeductions.size,
                        productsUpdated: affectedProductIds.size,
                        validationErrors: stockValidationErrors.length
                    }
                };

                // Agregar logs detallados si está activado
                if (config.logDetails) {
                    result.details = {
                        deductions: deductionSummary,
                        parents: parentUpdateSummary,
                        errors: stockValidationErrors
                    };
                }

                // Log de auditoría
                Logger.log(`✅ [${operationId}] Deducciones procesadas en ${duration}ms:`, {
                    batches: consolidatedDeductions.size,
                    products: affectedProductIds.size,
                    dryRun: config.dryRun
                });

                if (stockValidationErrors.length > 0) {
                    Logger.warn(`⚠️ [${operationId}] ${stockValidationErrors.length} deducciones omitidas por validación`);
                }

                return result;
            });

        } catch (error) {
            // Logging de error con contexto completo
            Logger.error(`❌ [${operationId}] Error procesando deducciones:`, {
                error: error.message,
                deductions: validatedDeductions.length,
                duration: Date.now() - startTime
            });

            // Si ya es un DatabaseError, lo re-lanzamos
            if (error.name === 'DatabaseError') {
                throw error;
            }

            // Convertir errores de Dexie en DatabaseError
            throw handleDexieError(error, `Process Batch Deductions [${operationId}]`);
        }
    },

    /**
     * Busca un producto por código de barras exacto.
     * Filtra productos inactivos.
     */
    async searchByBarcode(barcode) {
        try {
            if (!barcode) return null;

            const product = await db.table(STORES.MENU)
                .where('barcode').equals(barcode)
                .first();

            // Validación simple de estado
            if (product && product.isActive !== false) {
                return product;
            }
            return null;

        } catch (error) {
            throw handleDexieError(error, 'Search Barcode');
        }
    },

    /**
     * Búsqueda FLEXIBLE: Nombre (contiene), Código o SKU.
     */
    async searchProducts(term, limit = 50) {
        const results = await searchProductsInDB(term);
        return results.slice(0, limit);
    },

    /**
     * Búsqueda avanzada por SKU de variante (Lote).
     * Retorna un "Producto Híbrido": El padre con los datos (precio/costo) de la variante.
     * Vital para el POS cuando escanean una variante específica.
     */
    async searchProductBySKU(sku) {
        try {
            return await db.transaction('r', [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)], async () => {
                // 1. Buscar el lote por SKU
                const batch = await db.table(STORES.PRODUCT_BATCHES)
                    .where('sku').equals(sku)
                    .first();

                if (!batch) return null;

                // 2. Buscar al padre
                const product = await db.table(STORES.MENU).get(batch.productId);

                if (product && product.isActive !== false) {
                    // 3. Retornar fusión (Parent + Variant Data)
                    return {
                        ...product,
                        price: batch.price, // Precio de la variante manda
                        cost: batch.cost,
                        stock: batch.stock, // Stock específico de la variante (opcional, según tu lógica de UI)
                        isVariant: true,
                        batchId: batch.id,
                        skuDetected: batch.sku,
                        variantName: `${batch.attributes?.talla || ''} ${batch.attributes?.color || ''}`.trim()
                    };
                }
                return null;
            });

        } catch (error) {
            throw handleDexieError(error, 'Search SKU');
        }
    },

        /**
     * Obtiene lotes que vencen antes de una fecha límite.
     * Usa rangos de índices de Dexie para máxima velocidad.
     * 
     * FASE 5: Eliminación de Memory Scans
     * Usa índice [activeStockStatus+alertTargetDate] en lugar de toArray().filter()
     */
    async getExpiringBatches(limitDateIsoString) {
        try {
            // Construir la query utilizando el índice compuesto optimizado O(1)
            return await db.table(STORES.PRODUCT_BATCHES)
                .where('[activeStockStatus+alertTargetDate]')
                .between([1, Dexie.minKey], [1, limitDateIsoString])
                .toArray();
        } catch (error) {
            throw handleDexieError(error, 'Get Expiring Batches');
        }
    },

    /**
     * Obtiene productos activos con stock usando el índice optimizado.
     * 
     * FASE 5: Eliminación de Memory Scans
     * Reemplaza: await db.products.toArray().filter(p => p.isActive && p.stock > 0)
     */
    async getActiveProductsWithStock() {
        try {
            return await db.table(STORES.MENU)
                .where('activeStockStatus')
                .equals(1)
                .toArray();
        } catch (error) {
            throw handleDexieError(error, 'Get Active Products With Stock');
        }
    },

    /**
     * Obtiene productos por categoría con stock usando índice compuesto.
     * 
     * FASE 5: Eliminación de Memory Scans
     * Usa índice [categoryId+activeStockStatus] en lugar de filtrar en memoria
     */
    async getProductsByCategoryWithStock(categoryId) {
        try {
            return await db.table(STORES.MENU)
                .where('[categoryId+activeStockStatus]')
                .equals([categoryId, 1])
                .toArray();
        } catch (error) {
            throw handleDexieError(error, 'Get Products By Category With Stock');
        }
    },

    /**
     * Verifica si un código de barras ya existe (para validaciones de formularios).
     * Excluye el ID actual si se está editando.
     */
    async isBarcodeTaken(barcode, currentId = null) {
        try {
            const existing = await db.table(STORES.MENU)
                .where('barcode').equals(barcode)
                .first();

            if (!existing) return false;
            return existing.id !== currentId; // True si existe y es de otro producto
        } catch (error) {
            throw handleDexieError(error, 'Check Barcode');
        }
    },

    async getBatchesForManagerUI(productId, historyLimit = 30) {
        try {
            // 1. Obtener todos los lotes usando el índice primario seguro
            const allProductBatches = await db.table(STORES.PRODUCT_BATCHES)
                .where('productId').equals(productId)
                .toArray();

            // 2. Filtrar en memoria (evita el error de IDBKeyRange con booleanos)
            const activeBatches = allProductBatches.filter(b => b.isActive === true);

            // 3. Obtener el historial limitado, manejando fechas inválidas que pasarías por alto
            const archivedBatches = allProductBatches
                .filter(b => b.isActive === false)
                .sort((a, b) => {
                    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return dateB - dateA;
                })
                .slice(0, historyLimit);

            // 4. Calcular valor real
            const inventoryValue = activeBatches.reduce((sum, batch) =>
                sum + ((Number(batch.cost) || 0) * (Number(batch.stock) || 0)), 0
            );

            // 5. Devolver consolidado y ordenar con seguridad contra nulos
            return {
                batches: [...activeBatches, ...archivedBatches].sort((a, b) => {
                    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return dateB - dateA;
                }),
                inventoryValue
            };
        } catch (error) {
            throw handleDexieError(error, 'Get Batches For Manager UI');
        }
    },

        /**
     * Guarda un lote de producción y descuenta atómicamente la materia prima (Ingredientes).
     */
    async saveProductionBatchAndSync(batchData, recipe) {
        try {
            return await db.transaction('rw', [STORES.PRODUCT_BATCHES, STORES.MENU], async () => {
                const deductions = [];
                let rawMaterialsCost = 0;

                // 1. Calcular y verificar disponibilidad de materia prima (FIFO)
                for (const item of recipe) {
                    const requiredQty = Number(item.quantity) * Number(batchData.stock);
                    let remainingQty = requiredQty;

                    const batches = await db.table(STORES.PRODUCT_BATCHES)
                        .where('productId').equals(item.ingredientId)
                        .toArray();

                    // Filtrar activos y ordenar del más viejo al más nuevo
                    const activeBatches = batches
                        .filter(b => b.isActive && b.stock > 0)
                        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                    for (const b of activeBatches) {
                        if (remainingQty <= 0.0001) break;
                        const toDeduct = Math.min(remainingQty, b.stock);

                        deductions.push({
                            batchId: b.id,
                            quantity: toDeduct,
                            reason: `Producción lote: ${batchData.id}`
                        });

                        remainingQty -= toDeduct;
                        rawMaterialsCost += (toDeduct * b.cost);
                    }

                    // Si se agota el inventario del ingrediente antes de cubrir la receta
                    if (remainingQty > 0.0001) {
                        const ingrediente = await db.table(STORES.MENU).get(item.ingredientId);
                        throw new DatabaseError(
                            DB_ERROR_CODES.CONSTRAINT_VIOLATION,
                            `Stock insuficiente para producir. Faltan ${remainingQty.toFixed(2)} unidades del ingrediente: ${ingrediente?.name || 'Desconocido'}.`
                        );
                    }
                }

                // 2. Ejecutar deducciones usando tu propio motor robusto
                if (deductions.length > 0) {
                    await this.processBatchDeductions(deductions, { validateStock: true });
                }

                // 3. Guardar el lote del producto terminado y sincronizar
                await this.saveBatchAndSyncProduct(batchData);

                return { success: true, rawMaterialsCost };
            });
        } catch (error) {
            throw handleDexieError(error, 'Save Production Batch');
        }
    }
};
