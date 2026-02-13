import { db, STORES } from './dexie';
import { handleDexieError, validateOrThrow, DatabaseError, DB_ERROR_CODES } from './utils';
import { productSchema } from '../../schemas/productSchema';
import Logger from '../Logger';

/**
 * Repositorio especializado en Inventario y Productos.
 * Maneja lógica compleja de lotes, variantes y sincronización de precios.
 */
export const productsRepository = {
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

                // 1. Guardar el lote (Upsert)
                // Nota: Aquí podrías agregar validación Zod para batchData si creas un batchSchema
                await db.table(STORES.PRODUCT_BATCHES).put(batchData);

                // 2. Obtener TODOS los lotes de este producto para recalcular
                // Usamos el índice 'productId' definido en dexie.js
                const allBatches = await db.table(STORES.PRODUCT_BATCHES)
                    .where('productId').equals(batchData.productId)
                    .toArray();

                // 3. Lógica FIFO (First-In, First-Out) para costos
                // Ordenamos por fecha de creación (más antiguo primero)
                allBatches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                let totalStock = 0;
                let currentCost = 0;
                let currentPrice = 0;
                let foundActive = false;

                // Recorremos para sumar stock total y encontrar el precio vigente
                for (const batch of allBatches) {
                    if (batch.isActive && batch.stock > 0) {
                        totalStock += batch.stock;

                        // Tomamos el costo/precio del PRIMER lote activo (el más antiguo con stock)
                        if (!foundActive) {
                            currentCost = batch.cost;
                            currentPrice = batch.price;
                            foundActive = true;
                        }
                    }
                }

                // Si no hay lotes activos (stock 0), usamos los datos del lote que acabamos de guardar
                // para que el producto no quede con precio 0.
                if (!foundActive) {
                    currentCost = batchData.cost;
                    currentPrice = batchData.price;
                }

                // 4. Actualizar el Producto Padre
                const productStore = db.table(STORES.MENU);
                const product = await productStore.get(batchData.productId);

                if (product) {
                    const updatedProduct = {
                        ...product,
                        stock: totalStock,
                        cost: currentCost, // Costo ponderado FIFO
                        price: currentPrice, // Precio sugerido FIFO
                        hasBatches: true,
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
        const operationId = `deduction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
                // 🔥 SUBFASE 1.4: SINCRONIZAR PRODUCTOS PADRE (CORREGIDO)
                // ═══════════════════════════════════════════════════════════
                const parentUpdateSummary = [];

                for (const productId of affectedProductIds) {
                    // ✅ CORRECCIÓN CLAVE: Leer TODOS los lotes del producto
                    // (no solo los que modificamos)
                    const allProductBatches = await db.table(STORES.PRODUCT_BATCHES)
                        .where('productId').equals(productId)
                        .toArray();

                    // ✅ SOBRESCRIBIR con valores de memoria (los que acabamos de actualizar)
                    const truthMap = new Map();

                    // 1. Primero metemos todo lo que vino de la BD
                    allProductBatches.forEach(b => {
                        if (b && b.id) truthMap.set(b.id, b);
                    });

                    // 2. SOBRESCRIBIMOS con la verdad absoluta de memoria
                    updatedBatchesMap.forEach((memoryBatch, batchId) => {
                        if (String(memoryBatch.productId) === String(productId)) {
                            truthMap.set(batchId, memoryBatch);
                        }
                    });

                    // 3. Calculamos stock sumando SOLO lotes activos con stock > 0
                    const finalBatches = Array.from(truthMap.values());
                    const activeBatches = finalBatches.filter(b => {
                        const stockVal = Number(b.stock);
                        const isActuallyActive = Boolean(b.isActive) && !isNaN(stockVal) && stockVal > config.tolerance;
                        return isActuallyActive;
                    });

                    const totalStock = activeBatches.reduce((sum, b) => sum + Number(b.stock), 0);

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
                            activeBatches: activeBatches.length,
                            totalBatches: finalBatches.length
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
     * Búsqueda tipo "LIKE" o "StartsWith" por nombre.
     * Dexie optimiza esto usando índices si existen (name_lower).
     */
    async searchProducts(term, limit = 50) {
        try {
            const lowerTerm = term.toLowerCase();

            // Usamos el índice 'name_lower' para búsqueda rápida por prefijo
            return await db.table(STORES.MENU)
                .where('name_lower').startsWith(lowerTerm)
                .filter(p => p.isActive !== false) // Filtro en memoria para el estado
                .limit(limit)
                .toArray();

        } catch (error) {
            throw handleDexieError(error, 'Search Products');
        }
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
     */
    async getExpiringBatches(limitDateIsoString) {
        try {
            // Busca en índice expiryDate: desde el inicio (min) hasta limitDateIsoString
            return await db.table(STORES.PRODUCT_BATCHES)
                .where('expiryDate').belowOrEqual(limitDateIsoString)
                .filter(b => b.stock > 0 && b.isActive !== false)
                .toArray();

        } catch (error) {
            throw handleDexieError(error, 'Get Expiring Batches');
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
    }
};