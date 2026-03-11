import { normalizeStock } from '../db/utils';

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createWarning = (code, message, context = undefined) => (
  context ? { code, message, context } : { code, message }
);

const makeResult = ({
  success,
  code,
  restoreStock,
  warnings,
  message
}) => ({
  success,
  code,
  restoreStock,
  warnings,
  ...(message ? { message } : {})
});

const restoreInventoryBestEffort = async ({ sale, deps, warnings }) => {
  const { loadData, saveDataSafe, STORES, db, Logger } = deps;
  const affectedParentIds = new Set();

  for (const item of sale.items || []) {
    const hasBatches = Array.isArray(item?.batchesUsed) && item.batchesUsed.length > 0;

    if (hasBatches) {
      for (const batchUsage of item.batchesUsed) {
        try {
          const batch = await loadData(STORES.PRODUCT_BATCHES, batchUsage.batchId);

          if (!batch) {
            warnings.push(createWarning(
              'BATCH_NOT_FOUND',
              `No se encontro el lote ${batchUsage.batchId} para restauracion.`,
              { batchId: batchUsage.batchId, itemId: item.id }
            ));
            continue;
          }

          const restoredQuantity = toFiniteNumber(batchUsage.quantity);
          const newStock = normalizeStock(toFiniteNumber(batch.stock) + restoredQuantity);
          const updatedBatch = {
            ...batch,
            stock: newStock,
            isActive: newStock > 0,
            updatedAt: new Date().toISOString()
          };

          const saveBatchResult = await saveDataSafe(STORES.PRODUCT_BATCHES, updatedBatch);
          if (!saveBatchResult?.success) {
            warnings.push(createWarning(
              'BATCH_SAVE_FAILED',
              `No se pudo guardar el lote ${batchUsage.batchId} durante la restauracion.`,
              { batchId: batchUsage.batchId, message: saveBatchResult?.message }
            ));
            continue;
          }

          const parentIdToSync = batchUsage.ingredientId || batch.productId;
          if (parentIdToSync) {
            affectedParentIds.add(parentIdToSync);
          }
        } catch (error) {
          Logger.error(`Error restaurando lote ${batchUsage.batchId}:`, error);
          warnings.push(createWarning(
            'BATCH_RESTORE_ERROR',
            `Error inesperado al restaurar el lote ${batchUsage.batchId}.`,
            { batchId: batchUsage.batchId, error: error.message }
          ));
        }
      }

      continue;
    }

    try {
      const productId = item.parentId || item.id;
      const parentProduct = await loadData(STORES.MENU, productId);

      if (!parentProduct) {
        warnings.push(createWarning(
          'PRODUCT_NOT_FOUND',
          `No se encontro el producto ${productId} para restaurar stock.`,
          { productId, itemId: item.id }
        ));
        continue;
      }

      if (parentProduct.trackStock === false) {
        continue;
      }

      const quantityToRestore = toFiniteNumber(item.stockDeducted ?? item.quantity);
      const updatedProduct = {
        ...parentProduct,
        stock: normalizeStock(toFiniteNumber(parentProduct.stock) + quantityToRestore),
        updatedAt: new Date().toISOString()
      };

      const saveProductResult = await saveDataSafe(STORES.MENU, updatedProduct);
      if (!saveProductResult?.success) {
        warnings.push(createWarning(
          'PRODUCT_SAVE_FAILED',
          `No se pudo restaurar stock del producto ${productId}.`,
          { productId, message: saveProductResult?.message }
        ));
      }
    } catch (error) {
      Logger.error(`Error restaurando producto simple ${item.id}:`, error);
      warnings.push(createWarning(
        'PRODUCT_RESTORE_ERROR',
        `Error inesperado al restaurar stock del producto ${item.id}.`,
        { itemId: item.id, error: error.message }
      ));
    }
  }

  if (affectedParentIds.size === 0) {
    return;
  }

  for (const productId of affectedParentIds) {
    try {
      const parentProduct = await loadData(STORES.MENU, productId);
      if (!parentProduct) {
        warnings.push(createWarning(
          'PARENT_PRODUCT_NOT_FOUND',
          `No se encontro el producto padre ${productId} para sincronizar stock.`,
          { productId }
        ));
        continue;
      }

      const allBatches = await db.table(STORES.PRODUCT_BATCHES)
        .where('productId')
        .equals(productId)
        .toArray();

      const totalStock = (allBatches || [])
        .filter((batch) => batch?.isActive && toFiniteNumber(batch?.stock) > 0)
        .reduce((sum, batch) => sum + toFiniteNumber(batch?.stock), 0);

      const saveSyncResult = await saveDataSafe(STORES.MENU, {
        ...parentProduct,
        stock: totalStock,
        updatedAt: new Date().toISOString()
      });

      if (!saveSyncResult?.success) {
        warnings.push(createWarning(
          'PARENT_SYNC_FAILED',
          `No se pudo sincronizar el stock del producto ${productId}.`,
          { productId, message: saveSyncResult?.message }
        ));
      }
    } catch (error) {
      Logger.error(`Error sincronizando producto padre ${productId}:`, error);
      warnings.push(createWarning(
        'PARENT_SYNC_ERROR',
        `Error inesperado al sincronizar el producto ${productId}.`,
        { productId, error: error.message }
      ));
    }
  }
};

export const cancelSaleCore = async (
  { saleTimestamp, restoreStock = false, currentSales = [] },
  deps
) => {
  const { db, STORES } = deps;
  const normalizedRestoreStock = Boolean(restoreStock);

  try {
    await db.transaction(
      'rw',
      [STORES.SALES, STORES.DELETED_SALES, STORES.PRODUCT_BATCHES, STORES.MENU],
      async () => {
        // 1. Localizar la venta dentro del contexto de la transacción
        let saleFound = currentSales.find((sale) => sale?.timestamp === saleTimestamp);
        if (!saleFound) {
          const sales = await db.table(STORES.SALES).where('timestamp').equals(saleTimestamp).toArray();
          saleFound = sales[0];
        }

        if (!saleFound) {
          throw new Error(`NOT_FOUND: Venta con timestamp ${saleTimestamp} no encontrada.`);
        }

        // 2. Lógica de Restauración Estricta (Todo o Nada)
        if (normalizedRestoreStock && saleFound.items?.length > 0) {
          const batchIdsToFetch = new Set();
          const productIdsToFetch = new Set();

          // Recopilar IDs para lectura en bloque (Optimización)
          saleFound.items.forEach(item => {
            const hasBatches = Array.isArray(item?.batchesUsed) && item.batchesUsed.length > 0;
            if (hasBatches) {
              item.batchesUsed.forEach(b => batchIdsToFetch.add(b.batchId));
            } else {
              productIdsToFetch.add(item.parentId || item.id);
            }
          });

          // Lectura optimizada dentro de la transacción
          const batchesArray = await db.table(STORES.PRODUCT_BATCHES).bulkGet([...batchIdsToFetch]);
          const productsArray = await db.table(STORES.MENU).bulkGet([...productIdsToFetch]);

          const batchesMap = new Map(batchesArray.filter(Boolean).map(b => [b.id, b]));
          const productsMap = new Map(productsArray.filter(Boolean).map(p => [p.id, p]));

          const affectedParentIds = new Set();
          const batchUpdates = [];
          const productUpdates = [];

          // Procesar actualizaciones en memoria
          for (const item of saleFound.items) {
            const hasBatches = Array.isArray(item?.batchesUsed) && item.batchesUsed.length > 0;

            if (hasBatches) {
              for (const batchUsage of item.batchesUsed) {
                const batch = batchesMap.get(batchUsage.batchId);
                if (!batch) throw new Error(`CRITICAL_MISSING_DATA: Lote ${batchUsage.batchId} requerido para restaurar stock no existe.`);

                const restoredQty = Number(batchUsage.quantity) || 0;
                const newStock = normalizeStock(Number(batch.stock) + restoredQty);

                batchUpdates.push({
                  key: batch.id,
                  changes: { stock: newStock, isActive: newStock > 0, updatedAt: new Date().toISOString() }
                });

                affectedParentIds.add(batchUsage.ingredientId || batch.productId);
              }
            } else {
              const productId = item.parentId || item.id;
              const product = productsMap.get(productId);

              if (!product) throw new Error(`CRITICAL_MISSING_DATA: Producto ${productId} requerido para restaurar stock no existe.`);

              if (product.trackStock !== false) {
                const restoredQty = Number(item.stockDeducted ?? item.quantity) || 0;
                productUpdates.push({
                  key: product.id,
                  changes: { stock: normalizeStock(Number(product.stock) + restoredQty), updatedAt: new Date().toISOString() }
                });
              }
            }
          }

          // Aplicar escrituras de lotes y productos simples
          await Promise.all([
            ...batchUpdates.map(u => db.table(STORES.PRODUCT_BATCHES).update(u.key, u.changes)),
            ...productUpdates.map(u => db.table(STORES.MENU).update(u.key, u.changes))
          ]);

          // Sincronización de stock en productos padre afectados por lotes
          if (affectedParentIds.size > 0) {
            for (const parentId of affectedParentIds) {
              const parentProduct = await db.table(STORES.MENU).get(parentId);
              if (!parentProduct) throw new Error(`CRITICAL_MISSING_DATA: Producto padre ${parentId} no encontrado para sincronización.`);

              const allBatches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(parentId).toArray();
              const totalStock = normalizeStock(allBatches
                .filter(b => b?.isActive && normalizeStock(Number(b?.stock)) > 0)
                .reduce((sum, b) => sum + normalizeStock(Number(b?.stock)), 0));

              await db.table(STORES.MENU).update(parentId, { stock: totalStock, updatedAt: new Date().toISOString() });
            }
          }
        }

        // 3. Traslado a papelera y eliminación de la venta
        const auditReason = normalizedRestoreStock
          ? 'Eliminado manualmente - Inventario Devuelto'
          : 'Eliminado manualmente - Inventario NO Devuelto (Merma)';

        const deletedSaleRecord = {
          ...saleFound,
          deletedAt: new Date().toISOString(),
          auditReason
        };

        await db.table(STORES.DELETED_SALES).add(deletedSaleRecord);
        await db.table(STORES.SALES).delete(saleFound.id || saleFound.timestamp);
      }
    );

    return {
      success: true,
      code: 'DELETED',
      restoreStock: normalizedRestoreStock
    };

  } catch (error) {
    return {
      success: false,
      code: 'TRANSACTION_FAILED',
      restoreStock: normalizedRestoreStock,
      message: error.message
    };
  }
};

