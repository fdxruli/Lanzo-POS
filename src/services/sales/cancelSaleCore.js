import { Money } from '../../utils/moneyMath';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';
import { registrarMovimientoCajaEnTransaccion } from '../cajaService';
import {
  allocateSaleRefunds,
  getRefundableAmountsByMethod,
  normalizeSaleRefunds
} from './saleRefunds';

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
    saleId = null,
    saleTimestamp,
    restoreStock = false,
    currentSales = [],
    dispositionPlan = null,
    reason = '',
    cancelledBy = 'local-user',
    allowWaste = false,
    refunds = [],
    cashSession = null,
    cashActorContext = null
  },
  deps
) => {
  const {
    db,
    STORES,
    restoreStockFromCancellation,
    generateId,
    assertActorCurrent,
    now = () => new Date().toISOString(),
    Logger = console
  } = deps;

  const normalizedRestoreStock = Boolean(restoreStock);
  let transactionResult = null;

  try {
    if (typeof assertActorCurrent !== 'function') {
      throw new CancellationError(
        'ACTOR_SESSION_REQUIRED',
        'Se requiere una sesion vigente con permiso de devoluciones.'
      );
    }

    const stores = [
      STORES.SALES,
      STORES.PRODUCT_BATCHES,
      STORES.MENU,
      STORES.INVENTORY_EVENTS,
      STORES.TRANSACTION_LOG,
      STORES.WASTE,
      STORES.CUSTOMERS,
      STORES.CUSTOMER_LEDGER,
      STORES.CAJAS,
      STORES.MOVIMIENTOS_CAJA
    ].filter(Boolean);

    await db.transaction('rw', stores, async (tx) => {
      assertActorCurrent();
      const cachedSale = currentSales.find((sale) => (
        (saleId && sale?.id === saleId) ||
        (saleTimestamp && sale?.timestamp === saleTimestamp)
      ));
      let saleFound = saleId
        ? await db.table(STORES.SALES).get(saleId)
        : null;

      if (!saleFound && cachedSale?.id) {
        saleFound = await db.table(STORES.SALES).get(cachedSale.id);
      }

      if (!saleFound && saleTimestamp) {
        const sales = await db.table(STORES.SALES)
          .where('timestamp')
          .equals(saleTimestamp)
          .toArray();
        saleFound = sales[0];
      }

      if (!saleFound && cachedSale) {
        saleFound = cachedSale;
      }

      if (!saleFound) {
        throw new CancellationError(
          'NOT_FOUND',
          `Venta ${saleId || saleTimestamp || ''} no encontrada.`
        );
      }

      if (saleFound.status === 'cancelled') {
        if (saleFound.cancellationFinancials?.version === 1) {
          transactionResult = {
            success: true,
            code: 'ALREADY_CANCELLED',
            alreadyCancelled: true,
            saleId: saleFound.id,
            sale: saleFound,
            refunds: saleFound.cancellationFinancials.refunds || [],
            cashRefundMovementId: saleFound.cancellationFinancials.cashRefundMovementId || null,
            restoreStock: false,
            restoredInventoryValue: 0,
            warnings: [],
            inventoryReversalEventIds: [],
            wasteRecordIds: []
          };
          return;
        }
        throw new CancellationError('ALREADY_CANCELLED', 'La venta ya fue cancelada.');
      }

      const cancelledAt = now();
      const cancellationId = `cancel:${saleFound.id || saleFound.timestamp}`;
      let normalizedRefunds;
      try {
        normalizedRefunds = normalizeSaleRefunds(refunds);
      } catch (error) {
        throw new CancellationError(error.code || 'INVALID_REFUND', error.message);
      }
      const refundableAmounts = getRefundableAmountsByMethod(saleFound);
      for (const refund of normalizedRefunds) {
        if (Money.init(refund.amount).gt(refundableAmounts[refund.method] || 0)) {
          throw new CancellationError(
            'REFUND_EXCEEDS_PAID_AMOUNT',
            `La devolución en ${refund.method} supera el importe cobrado y trazable en ese medio.`
          );
        }
      }
      const refundsWithSources = allocateSaleRefunds(saleFound, normalizedRefunds);
      const cashRefund = refundsWithSources.find((refund) => refund.method === 'cash') || null;
      if (cashRefund && !cashSession?.id) {
        throw new CancellationError(
          'CASH_SESSION_REQUIRED',
          'Para registrar una devolución en efectivo se requiere una caja local abierta en esta estación.'
        );
      }

      let creditChargeReversal = null;
      if (Money.init(saleFound.saldoPendiente || 0).gt(0)) {
        if (!saleFound.customerId) {
          throw new CancellationError(
            'CUSTOMER_CREDIT_UNAVAILABLE',
            'No se puede revertir el saldo fiado de esta venta porque no tiene un cliente asociado.'
          );
        }
        if (!STORES.CUSTOMERS || !STORES.CUSTOMER_LEDGER) {
          throw new CancellationError('CUSTOMER_CREDIT_UNAVAILABLE', 'No se pueden ajustar los saldos de fiado de esta venta.');
        }
        const customer = await db.table(STORES.CUSTOMERS).get(saleFound.customerId);
        const outstanding = Money.init(saleFound.saldoPendiente);
        if (!customer || Money.init(customer.debt || 0).lt(outstanding)) {
          throw new CancellationError(
            'CUSTOMER_DEBT_MISMATCH',
            'El saldo del cliente no cuadra con el adeudo de la venta. Concílialo antes de cancelar.'
          );
        }
        creditChargeReversal = { customer, outstanding };
      }

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

      let cashRefundMovement = null;
      if (cashRefund) {
        const movementResult = await registrarMovimientoCajaEnTransaccion(
          tx,
          cashSession.id,
          'salida',
          cashRefund.amount,
          `Devolución en efectivo por cancelación ${saleFound.id}`,
          {
            cashMovementId: `cash-refund:${cancellationId}`,
            idempotencyKey: `sale-cancellation-refund:${cancellationId}:cash`,
            actorKey: cashSession.actorKey,
            cashStationId: cashSession.cashStationId || null,
            localStationKey: cashSession.localStationKey || null,
            actorContext: cashActorContext,
            createdAt: cancelledAt,
            metadata: {
              source: 'sale_cancellation',
              referenceType: 'sale',
              referenceId: saleFound.id,
              saleId: saleFound.id,
              cancellationId,
              refundMethod: 'cash',
              refundAmount: cashRefund.amount,
              sourcePayments: cashRefund.sourcePayments
            }
          }
        );
        cashRefundMovement = movementResult?.movimiento || null;
      }

      if (creditChargeReversal) {
        const newDebt = Money.subtract(creditChargeReversal.customer.debt || 0, creditChargeReversal.outstanding);
        await db.table(STORES.CUSTOMER_LEDGER).add({
          id: `cancel-credit:${cancellationId}`,
          customerId: saleFound.customerId,
          type: 'CANCEL_CHARGE',
          amount: Money.toExactString(Money.multiply(creditChargeReversal.outstanding, -1)),
          paymentMethod: 'fiado',
          reference: saleFound.id,
          cancellationId,
          note: `Cancelación de venta ${saleFound.id}; se revirtió el saldo pendiente.`,
          timestamp: cancelledAt
        });
        await db.table(STORES.CUSTOMERS).put({
          ...creditChargeReversal.customer,
          debt: Money.toExactString(newDebt),
          debtCents: normalizeCustomerDebtCents(newDebt),
          financialSource: 'local',
          updatedAt: cancelledAt
        });
      }

      const refundTotal = normalizedRefunds.reduce(
        (total, refund) => Money.add(total, refund.amount),
        Money.init(0)
      );
      const cashRefundTotal = cashRefund ? Money.init(cashRefund.amount) : Money.init(0);
      const recordedRefunds = refundsWithSources.map((refund) => ({
        ...refund,
        returnedAt: cancelledAt,
        cashSessionId: refund.method === 'cash' ? cashSession.id : null,
        cashMovementId: refund.method === 'cash' ? cashRefundMovement?.id || null : null
      }));

      const cancelledSale = {
        ...saleFound,
        status: 'cancelled',
        fulfillmentStatus: 'cancelled',
        cancelledAt,
        cancelledBy,
        cancelReason: reason || 'manual_cancellation',
        cancellationId,
        ...(creditChargeReversal ? { saldoPendiente: 0, creditStatus: 'CANCELLED' } : {}),
        cancellationFinancials: {
          version: 1,
          cancellationId,
          cancelledAt,
          refunds: recordedRefunds,
          refundTotal: Money.toExactString(refundTotal),
          cashRefundTotal: Money.toExactString(cashRefundTotal),
          cashRefundSessionId: cashRefund ? cashSession.id : null,
          cashRefundMovementId: cashRefundMovement?.id || null
        },
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
        disposition: normalizedPlan,
        refunds: recordedRefunds,
        cashRefundMovementId: cashRefundMovement?.id || null
      });
      assertActorCurrent();

      transactionResult = {
        success: true,
        code: 'CANCELLED',
        saleId: saleFound.id,
        sale: cancelledSale,
        restoreStock: restockItems.length > 0,
        restoredInventoryValue,
        warnings,
        refunds: recordedRefunds,
        cashRefundMovementId: cashRefundMovement?.id || null,
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
