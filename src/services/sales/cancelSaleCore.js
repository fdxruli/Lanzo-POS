export const CANCELLATION_ACTIONS = Object.freeze({
  RESTOCK: 'restock',
  NO_RETURN: 'no_return',
  WASTE: 'waste'
});

class CancellationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CancellationError';
    this.code = code;
  }
}

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getLineId = (item, index) =>
  item?.lineId || item?.cartItemId || item?.orderItemId || `${item?.id || 'item'}:${index}`;

const getProductId = (item) => item?.parentId || item?.id || null;

const getQuantity = (item) =>
  toFiniteNumber(item?.stockDeducted ?? item?.quantity, 0);

const normalizeDispositionPlan = ({
  items = [],
  dispositionPlan,
  restoreStock,
  allowWaste
}) => {
  const requestedByLineId = new Map(
    (Array.isArray(dispositionPlan) ? dispositionPlan : [])
      .filter(Boolean)
      .map((entry) => [entry.lineId, entry])
  );

  return items.map((item, index) => {
    const lineId = getLineId(item, index);
    const requested = requestedByLineId.get(lineId);
    const action = requested?.action
      || (restoreStock ? CANCELLATION_ACTIONS.RESTOCK : CANCELLATION_ACTIONS.NO_RETURN);

    if (!Object.values(CANCELLATION_ACTIONS).includes(action)) {
      throw new CancellationError(
        'INVALID_CANCELLATION',
        `Accion desconocida para ${item?.name || lineId}.`
      );
    }

    if (action === CANCELLATION_ACTIONS.WASTE && !allowWaste) {
      throw new CancellationError(
        'WASTE_NOT_ALLOWED',
        'El rubro activo no permite registrar mermas.'
      );
    }

    return {
      lineId,
      itemIndex: index,
      itemId: item?.id || null,
      productId: getProductId(item),
      name: item?.name || 'Producto',
      quantity: getQuantity(item),
      action,
      reason: requested?.reason || '',
      notes: requested?.notes || ''
    };
  });
};

const groupRestorationEvents = (restored = []) => {
  const byProduct = new Map();

  restored.forEach((entry) => {
    if (entry?.type !== 'batch' && entry?.type !== 'product') return;

    const productId = entry.productId || entry.id;
    if (!productId) return;

    const current = byProduct.get(productId) || {
      productId,
      delta: 0,
      sourceBatchIds: []
    };

    current.delta += toFiniteNumber(entry.restoredQuantity, 0);
    if (entry.type === 'batch' && entry.id) current.sourceBatchIds.push(entry.id);
    byProduct.set(productId, current);
  });

  return Array.from(byProduct.values()).filter((entry) => entry.delta !== 0);
};

export const cancelSaleCore = async (
  {
    saleTimestamp,
    restoreStock = false,
    currentSales = [],
    dispositionPlan = null,
    reason = '',
    cancelledBy = 'local-user',
    allowWaste = false
  },
  deps
) => {
  const {
    db,
    STORES,
    restoreStockFromCancellation,
    generateId,
    now = () => new Date().toISOString(),
    Logger = console
  } = deps;

  const normalizedRestoreStock = Boolean(restoreStock);
  let transactionResult = null;

  try {
    const stores = [
      STORES.SALES,
      STORES.PRODUCT_BATCHES,
      STORES.MENU,
      STORES.INVENTORY_EVENTS,
      STORES.TRANSACTION_LOG,
      STORES.WASTE
    ].filter(Boolean);

    await db.transaction('rw', stores, async () => {
      const cachedSale = currentSales.find((sale) => sale?.timestamp === saleTimestamp);
      let saleFound = cachedSale?.id
        ? await db.table(STORES.SALES).get(cachedSale.id)
        : null;

      if (!saleFound) {
        const sales = await db.table(STORES.SALES)
          .where('timestamp')
          .equals(saleTimestamp)
          .toArray();
        saleFound = sales[0];
      }

      if (!saleFound) {
        throw new CancellationError(
          'NOT_FOUND',
          `Venta con timestamp ${saleTimestamp} no encontrada.`
        );
      }

      if (saleFound.status === 'cancelled') {
        throw new CancellationError('ALREADY_CANCELLED', 'La venta ya fue cancelada.');
      }

      const cancelledAt = now();
      const cancellationId = `cancel:${saleFound.id || saleFound.timestamp}`;
      const normalizedPlan = normalizeDispositionPlan({
        items: saleFound.items || [],
        dispositionPlan,
        restoreStock: normalizedRestoreStock,
        allowWaste
      });
      const restockItems = normalizedPlan
        .filter((entry) => entry.action === CANCELLATION_ACTIONS.RESTOCK)
        .map((entry) => saleFound.items[entry.itemIndex]);
      const warnings = [];
      let restoredInventoryValue = 0;
      let restored = [];

      if (restockItems.length > 0) {
        if (typeof restoreStockFromCancellation !== 'function') {
          throw new CancellationError(
            'RESTORE_FAILED',
            'No se configuro el restaurador de inventario.'
          );
        }

        const restoration = await restoreStockFromCancellation(restockItems);
        restored = restoration?.restored || [];
        warnings.push(...(restoration?.warnings || []));
        restoredInventoryValue = toFiniteNumber(restoration?.restoredInventoryValue, 0);

        if (warnings.length > 0 || restored.length === 0) {
          throw new CancellationError(
            'RESTORE_FAILED',
            warnings[0]?.message || 'No se pudo restaurar completamente el inventario.'
          );
        }
      }

      const reversalEvents = groupRestorationEvents(restored).map((entry) => ({
        id: `inventory-reversal:${saleFound.id}:${entry.productId}`,
        operationId: cancellationId,
        type: 'INVENTORY_REVERSAL',
        productId: entry.productId,
        delta: entry.delta,
        saleId: saleFound.id,
        reversesType: 'INVENTORY_DEDUCTION',
        sourceBatchIds: entry.sourceBatchIds,
        timestamp: cancelledAt,
        synced: false
      }));

      if (reversalEvents.length > 0) {
        await db.table(STORES.INVENTORY_EVENTS).bulkAdd(reversalEvents);
      }

      const wasteRecords = normalizedPlan
        .filter((entry) => entry.action === CANCELLATION_ACTIONS.WASTE)
        .map((entry) => {
          const item = saleFound.items[entry.itemIndex] || {};
          const costAtTime = toFiniteNumber(item.cost, 0);
          return {
            id: `sale-waste:${saleFound.id}:${entry.itemIndex}`,
            productId: entry.productId,
            productName: entry.name,
            quantity: entry.quantity,
            unit: item?.unit || item?.bulkData?.purchase?.unit || 'u',
            costAtTime,
            lossAmount: Number((costAtTime * entry.quantity).toFixed(2)),
            reason: entry.reason || 'venta_cancelada',
            notes: entry.notes,
            timestamp: cancelledAt,
            source: 'sale_cancellation',
            saleId: saleFound.id,
            cancellationId,
            affectsInventory: false,
            status: 'active'
          };
        });

      if (wasteRecords.length > 0) {
        await db.table(STORES.WASTE).bulkAdd(wasteRecords);
      }

      const cancelledSale = {
        ...saleFound,
        status: 'cancelled',
        fulfillmentStatus: 'cancelled',
        cancelledAt,
        cancelledBy,
        cancelReason: reason || 'manual_cancellation',
        cancellationId,
        cancellationDisposition: normalizedPlan,
        inventoryRestored: restockItems.length > 0,
        inventoryReversalEventIds: reversalEvents.map((event) => event.id),
        cancellationWasteRecordIds: wasteRecords.map((record) => record.id),
        updatedAt: cancelledAt
      };

      await db.table(STORES.SALES).put(cancelledSale);
      await db.table(STORES.TRANSACTION_LOG).add({
        id: generateId('txn'),
        type: 'SALE_CANCELLED',
        status: 'completed',
        saleId: saleFound.id,
        cancellationId,
        timestamp: cancelledAt,
        disposition: normalizedPlan
      });

      transactionResult = {
        success: true,
        code: 'CANCELLED',
        saleId: saleFound.id,
        sale: cancelledSale,
        restoreStock: restockItems.length > 0,
        restoredInventoryValue,
        warnings,
        inventoryReversalEventIds: reversalEvents.map((event) => event.id),
        wasteRecordIds: wasteRecords.map((record) => record.id)
      };
    });

    return transactionResult;
  } catch (error) {
    Logger.error?.('Error al cancelar venta:', error);
    return {
      success: false,
      code: error?.code || 'TRANSACTION_FAILED',
      restoreStock: normalizedRestoreStock,
      restoredInventoryValue: 0,
      warnings: [],
      inventoryReversalEventIds: [],
      wasteRecordIds: [],
      message: error?.message || 'No se pudo cancelar la venta.'
    };
  }
};
