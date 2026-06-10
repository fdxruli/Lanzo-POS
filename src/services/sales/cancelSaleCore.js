const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * MOTOR INVARIANTE V4.1: cancelSaleCore refactorizado
 *
 * Ya no contiene lógica de actualización de stock inline.
 * Toda la restauración de inventario pasa obligatoriamente por:
 * productsRepository.restoreStockFromCancellation()
 *
 * Esto garantiza:
 * 1. Que los hooks de Dexie se disparen correctamente
 * 2. Que activeStockStatus se mantenga sincronizado automáticamente
 * 3. Atomicidad de la transacción
 */
export const cancelSaleCore = async (
  { saleTimestamp, restoreStock = false, currentSales = [] },
  deps
) => {
  const { db, STORES } = deps;
  const normalizedRestoreStock = Boolean(restoreStock);
  let restoredInventoryValue = 0;

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

        // 2. Lógica de Restauración Estricta (Todo o Nada) - Usando Motor Invariante
        if (normalizedRestoreStock && saleFound.items?.length > 0) {
          // MOTOR INVARIANTE: Import dinámico para evitar dependencias circulares
          const { productsRepository } = await import('../db/products.js');

          // Usar el método especializado que garantiza:
          // - Disparo de hooks de Dexie
          // - Cálculo automático de activeStockStatus
          // - Atomicidad de la transacción
          const restoration = await productsRepository.restoreStockFromCancellation(
            saleFound.items
          );
          const { restored, warnings } = restoration;
          restoredInventoryValue = toFiniteNumber(restoration.restoredInventoryValue, 0);

          // Si hay warnings críticos, podríamos querer abortar (policy decision)
          // Por ahora, solo logueamos en desarrollo
          if (warnings.length > 0 && process.env.NODE_ENV === 'development') {
            console.warn('[cancelSaleCore] Warnings durante restauración:', warnings);
          }

          // Si no se restauró nada pero había items, algo grave ocurrió
          if (restored.length === 0 && saleFound.items.length > 0) {
            throw new Error('CRITICAL_RESTORE_FAILED: No se pudo restaurar ningún item del inventario');
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
      restoreStock: normalizedRestoreStock,
      restoredInventoryValue
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
