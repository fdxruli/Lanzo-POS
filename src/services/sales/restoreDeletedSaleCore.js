import { CANCELLATION_ACTIONS } from './cancelSaleCore';

const getLineId = (item, index) =>
  item?.lineId || item?.cartItemId || item?.orderItemId || `${item?.id || 'item'}:${index}`;

const inferLegacyPlan = (sale) => {
  const inventoryWasRestored = sale?.inventoryRestored === true
    || String(sale?.auditReason || sale?.deletedReason || '').includes('Inventario Devuelto');

  return (sale?.items || []).map((item, index) => ({
    lineId: getLineId(item, index),
    itemIndex: index,
    itemId: item?.id || null,
    productId: item?.parentId || item?.id || null,
    name: item?.name || 'Producto',
    quantity: Number(item?.stockDeducted ?? item?.quantity ?? 0) || 0,
    action: inventoryWasRestored
      ? CANCELLATION_ACTIONS.RESTOCK
      : CANCELLATION_ACTIONS.NO_RETURN,
    reason: 'legacy_restore',
    notes: ''
  }));
};

const groupDeductions = (deducted = []) => {
  const byProduct = new Map();

  deducted.forEach((entry) => {
    const productId = entry?.productId || entry?.id;
    if (!productId) return;
    const current = byProduct.get(productId) || {
      productId,
      delta: 0,
      sourceBatchIds: []
    };
    current.delta -= Number(entry.deductedQuantity || 0);
    if (entry.type === 'batch' && entry.id) current.sourceBatchIds.push(entry.id);
    byProduct.set(productId, current);
  });

  return Array.from(byProduct.values()).filter((entry) => entry.delta !== 0);
};

export const restoreDeletedSaleCore = async (
  { saleId },
  {
    db,
    STORES,
    reapplyStockFromCancellation,
    generateId,
    now = () => new Date().toISOString(),
    Logger = console
  }
) => {
  try {
    let result = null;
    const stores = [
      STORES.DELETED_SALES,
      STORES.SALES,
      STORES.PRODUCT_BATCHES,
      STORES.MENU,
      STORES.INVENTORY_EVENTS,
      STORES.TRANSACTION_LOG,
      STORES.WASTE
    ].filter(Boolean);

    await db.transaction('rw', stores, async () => {
      const deletedSale = await db.table(STORES.DELETED_SALES).get(saleId);
      if (!deletedSale) {
        const error = new Error('La venta ya no existe en la papelera.');
        error.code = 'NOT_FOUND';
        throw error;
      }

      if (await db.table(STORES.SALES).get(deletedSale.id)) {
        const error = new Error('La venta ya existe en el historial.');
        error.code = 'ALREADY_RESTORED';
        throw error;
      }

      const disposition = Array.isArray(deletedSale.cancellationDisposition)
        ? deletedSale.cancellationDisposition
        : inferLegacyPlan(deletedSale);
      const restockItems = disposition
        .filter((entry) => entry.action === CANCELLATION_ACTIONS.RESTOCK)
        .map((entry) => deletedSale.items?.[entry.itemIndex])
        .filter(Boolean);
      let deducted = [];

      if (restockItems.length > 0) {
        const deductionResult = await reapplyStockFromCancellation(restockItems);
        deducted = deductionResult?.deducted || [];
        if (deducted.length === 0) {
          const error = new Error('No se pudo reaplicar la salida de inventario.');
          error.code = 'INVENTORY_REAPPLY_FAILED';
          throw error;
        }
      }

      const restoredAt = now();
      const restoreOperationId = `restore-sale:${deletedSale.id}`;
      const inventoryEvents = groupDeductions(deducted).map((entry) => ({
        id: `inventory-reinstatement:${deletedSale.id}:${entry.productId}`,
        operationId: restoreOperationId,
        type: 'INVENTORY_REINSTATEMENT',
        productId: entry.productId,
        delta: entry.delta,
        saleId: deletedSale.id,
        reversesEventId: `inventory-reversal:${deletedSale.id}:${entry.productId}`,
        sourceBatchIds: entry.sourceBatchIds,
        timestamp: restoredAt,
        synced: false
      }));

      if (inventoryEvents.length > 0) {
        await db.table(STORES.INVENTORY_EVENTS).bulkAdd(inventoryEvents);
      }

      const wasteRecordIds = deletedSale.cancellationWasteRecordIds || [];
      if (wasteRecordIds.length > 0) {
        await db.table(STORES.WASTE).bulkUpdate(
          wasteRecordIds.map((id) => ({
            key: id,
            changes: {
              status: 'reversed',
              reversedAt: restoredAt,
              reversedByOperationId: restoreOperationId
            }
          }))
        );
      }

      const restoredSale = { ...deletedSale };
      [
        'deletedAt',
        'deletedTimestamp',
        'deletedReason',
        'originalStore',
        'auditReason',
        'type',
        'uniqueId',
        'mainLabel'
      ].forEach((field) => delete restoredSale[field]);

      Object.assign(restoredSale, {
        status: 'closed',
        fulfillmentStatus: restoredSale.fulfillmentStatus === 'cancelled'
          ? 'completed'
          : restoredSale.fulfillmentStatus,
        restoredFromTrash: true,
        restoredAt,
        restoreOperationId,
        inventoryReinstatementEventIds: inventoryEvents.map((event) => event.id),
        updatedAt: restoredAt
      });

      await db.table(STORES.SALES).add(restoredSale);
      await db.table(STORES.DELETED_SALES).delete(saleId);
      await db.table(STORES.TRANSACTION_LOG).add({
        id: generateId('txn'),
        type: 'SALE_RESTORED_FROM_TRASH',
        status: 'completed',
        saleId: restoredSale.id,
        operationId: restoreOperationId,
        timestamp: restoredAt
      });

      result = {
        success: true,
        code: 'RESTORED',
        sale: restoredSale,
        inventoryReinstatementEventIds: inventoryEvents.map((event) => event.id)
      };
    });

    return result;
  } catch (error) {
    Logger.error?.('Error restaurando venta desde papelera:', error);
    return {
      success: false,
      code: error?.code || 'RESTORE_FAILED',
      message: error?.message || 'No se pudo restaurar la venta.'
    };
  }
};
