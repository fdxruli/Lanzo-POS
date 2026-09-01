import { db, STORES } from '../db/dexie';
import { getCommittedStock, normalizeStock } from '../db/utils';
import { cloudSaleToLocalSyncPatch } from './salesCloudMapper';

const CLOUD_SALE_CACHE_PREFIX = 'cloud_sale:';
const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const stringifyError = (error) => (
  error?.message || error?.code || String(error || 'Error desconocido')
);

const isTableReservation = (item = {}) => item?.inventoryReservation?.source === 'table';

/**
 * A table order reserves stock locally before its cloud split is committed.
 * The cloud transaction becomes the inventory authority, so the local parent
 * must release only its reservation. This is intentionally idempotent and
 * never changes physical stock; catalog sync remains responsible for the
 * authoritative cloud quantities.
 */
const reconcileLocalTableReservations = async ({ items = [], settledAt }) => {
  const tableItems = (Array.isArray(items) ? items : []).filter(isTableReservation);
  if (tableItems.length === 0) return { status: 'completed', warnings: [] };

  const batchIds = new Set();
  for (const item of tableItems) {
    const committedBatches = Array.isArray(item.inventoryReservation?.committedBatches)
      ? item.inventoryReservation.committedBatches
      : [];
    committedBatches.forEach((usage) => {
      if (usage?.batchId) batchIds.add(usage.batchId);
    });
  }

  const warnings = [];
  const updatedBatches = new Map();
  const updatedProducts = new Map();
  const batchProductIds = new Set();
  const batchMap = new Map();

  if (batchIds.size > 0) {
    const loadedBatches = await db.table(STORES.PRODUCT_BATCHES).bulkGet(Array.from(batchIds));
    loadedBatches.filter(Boolean).forEach((batch) => batchMap.set(batch.id, batch));
  }

  for (const item of tableItems) {
    const reservation = item.inventoryReservation || {};
    const committedBatches = Array.isArray(reservation.committedBatches)
      ? reservation.committedBatches
      : [];

    if (committedBatches.length > 0) {
      for (const usage of committedBatches) {
        const quantity = normalizeStock(usage?.quantity || 0);
        if (quantity <= 0) continue;

        const batch = batchMap.get(usage?.batchId);
        if (!batch) {
          warnings.push('batch:' + (usage?.batchId || 'unknown') + ':not_found');
          continue;
        }

        const committedStock = getCommittedStock(batch);
        if (committedStock < quantity) {
          warnings.push('batch:' + batch.id + ':underflow:' + committedStock + ':' + quantity);
        }
        batch.committedStock = normalizeStock(Math.max(0, committedStock - quantity));
        batch.updatedAt = settledAt;
        updatedBatches.set(batch.id, batch);
        const productId = batch.productId || usage?.ingredientId;
        if (productId) batchProductIds.add(productId);
      }
      continue;
    }

    const quantity = normalizeStock(reservation.committedQuantity || 0);
    if (quantity <= 0) continue;

    // Current reservations identify the order product. Newer reservation
    // writers may provide targetProductId/productId for recipe components.
    const productId = reservation.productId
      || reservation.targetProductId
      || item.parentId
      || item.id;
    if (!productId) {
      warnings.push('product:unknown:not_found');
      continue;
    }

    const product = updatedProducts.get(productId)
      || await db.table(STORES.MENU).get(productId);
    if (!product) {
      warnings.push('product:' + productId + ':not_found');
      continue;
    }

    const committedStock = getCommittedStock(product);
    if (committedStock < quantity) {
      warnings.push('product:' + productId + ':underflow:' + committedStock + ':' + quantity);
    }
    const updatedProduct = {
      ...product,
      committedStock: normalizeStock(Math.max(0, committedStock - quantity)),
      updatedAt: settledAt
    };
    updatedProducts.set(productId, updatedProduct);
  }

  if (updatedBatches.size > 0) {
    await db.table(STORES.PRODUCT_BATCHES).bulkPut(Array.from(updatedBatches.values()));
  }

  // Batch parent products derive committedStock from their batches. Recompute
  // after the batch updates so local availability cannot retain a phantom hold.
  for (const productId of batchProductIds) {
    const product = await db.table(STORES.MENU).get(productId);
    if (!product) {
      warnings.push('product:' + productId + ':batch_parent_not_found');
      continue;
    }
    const batches = await db.table(STORES.PRODUCT_BATCHES)
      .where('productId')
      .equals(productId)
      .toArray();
    updatedProducts.set(productId, {
      ...product,
      committedStock: normalizeStock(
        batches.reduce((sum, batch) => sum + getCommittedStock(batch), 0)
      ),
      updatedAt: settledAt
    });
  }

  if (updatedProducts.size > 0) {
    await db.table(STORES.MENU).bulkPut(Array.from(updatedProducts.values()));
  }

  return {
    status: warnings.length > 0 ? 'completed_with_warnings' : 'completed',
    warnings
  };
};

const getLocalSaleId = (cloudSale = {}) => cloudSale.local_sale_id || cloudSale.localSaleId || cloudSale.id || null;
const isCloudCommitted = (sale = {}) => (sale.source_mode || sale.sourceMode) === 'cloud_committed';
const isCreditApplied = (sale = {}) => (sale.credit_effect_status || sale.creditEffectStatus) === 'applied';

const isCancelledCloudSale = (sale = {}) => (
  sale?.status === 'cancelled' ||
  Boolean(sale?.cancelled_at || sale?.cancelledAt || sale?.cancellation_id || sale?.cancellationId)
);

const cloudCancellationToLocalPatch = (cloudSale = {}, response = {}) => ({
  status: cloudSale.status || 'cancelled',
  fulfillmentStatus: cloudSale.fulfillment_status || 'cancelled',
  cancelledAt: cloudSale.cancelled_at || cloudSale.cancelledAt || response.cancellation?.created_at || new Date().toISOString(),
  cancelReason: cloudSale.cancel_reason || cloudSale.cancelReason || response.cancellation?.reason || 'cancelacion_cloud',
  cancellationId: cloudSale.cancellation_id || cloudSale.cancellationId || response.cancellation?.id || null,
  cancellationStatus: cloudSale.cancellation_status || cloudSale.cancellationStatus || response.cancellation?.status || 'completed',
  reversalStatus: cloudSale.reversal_status || cloudSale.reversalStatus || 'applied',
  cashReversalStatus: cloudSale.cash_reversal_status || cloudSale.cashReversalStatus || response.cancellation?.cash_reversal_status || 'not_required',
  inventoryReversalStatus: cloudSale.inventory_reversal_status || cloudSale.inventoryReversalStatus || response.cancellation?.inventory_reversal_status || 'not_required',
  creditReversalStatus: cloudSale.credit_reversal_status || cloudSale.creditReversalStatus || response.cancellation?.credit_reversal_status || 'not_required',
  cloudSalesSyncStatus: 'synced',
  cloudSalesLastSyncAt: new Date().toISOString(),
  cloudSalesSyncError: null,
  cloudServerVersion: Number(cloudSale.server_version || response.server_version || 0) || null,
  sourceMode: cloudSale.source_mode || 'cloud_committed',
  syncStatus: 'SYNCED'
});

const upsertCloudSaleCache = async ({ sale, items = [], payments = [] }) => {
  if (!sale?.id) return null;

  const row = {
    key: `${CLOUD_SALE_CACHE_PREFIX}${sale.id}`,
    value: {
      sale,
      items,
      payments,
      cachedAt: nowIso(),
      phase: isCancelledCloudSale(sale)
        ? 'fase6e_cloud_sale_cancellations'
        : isCreditApplied(sale)
          ? 'fase6d_cloud_sales_credit_ledger'
          : (isCloudCommitted(sale) ? 'fase6b_cloud_cashier_sales' : 'fase6a_sales_cloud_base')
    },
    updatedAt: nowIso()
  };

  await db.table(STORES.SYNC_CACHE).put(row);
  return row;
};

const buildLocalCloudCommittedSale = ({ localSale = {}, cloudSale = {}, items = [], response = {} }) => ({
  ...localSale,
  id: localSale.id || cloudSale.local_sale_id || cloudSale.id,
  timestamp: cloudSale.sold_at || cloudSale.soldAt || localSale.timestamp || nowIso(),
  soldAt: cloudSale.sold_at || cloudSale.soldAt || localSale.soldAt || null,
  items: Array.isArray(localSale.items) && localSale.items.length > 0 ? localSale.items : items,
  total: String(cloudSale.total ?? localSale.total ?? 0),
  paymentMethod: cloudSale.payment_method || localSale.paymentMethod,
  paymentStatus: cloudSale.payment_status || localSale.paymentStatus || null,
  abono: String(cloudSale.amount_paid ?? localSale.abono ?? cloudSale.total ?? 0),
  saldoPendiente: String(cloudSale.balance_due ?? 0),
  status: cloudSale.status || localSale.status || 'closed',
  folio: cloudSale.cloud_folio || cloudSale.folio || localSale.folio,
  posFolio: cloudSale.pos_folio || cloudSale.posFolio || localSale.posFolio || localSale.pos_folio || null,
  cloudFolio: cloudSale.cloud_folio || null,
  salesChannel: cloudSale.sales_channel || cloudSale.salesChannel || localSale.salesChannel
    || (cloudSale.ecommerce_order_id || cloudSale.ecommerce_order_code ? 'ecommerce' : 'local'),
  ecommerceOrderId: cloudSale.ecommerce_order_id || cloudSale.ecommerceOrderId
    || cloudSale.metadata?.ecommerceOrderId || cloudSale.metadata?.ecommerce_order_id
    || localSale.ecommerceOrderId || localSale.metadata?.ecommerceOrderId || null,
  ecommerceOrderCode: cloudSale.ecommerce_order_code || cloudSale.ecommerceOrderCode
    || cloudSale.metadata?.ecommerceOrderCode || cloudSale.metadata?.ecommerce_order_code
    || localSale.ecommerceOrderCode || localSale.metadata?.ecommerceOrderCode || null,
  cloudSaleId: cloudSale.id || response.sale?.id || null,
  cloudSalesSyncStatus: 'synced',
  cloudSalesLastSyncAt: nowIso(),
  cloudSalesSyncError: null,
  cloudServerVersion: Number(cloudSale.server_version || response.server_version || 0) || null,
  sourceMode: cloudSale.source_mode || 'cloud_committed',
  effectsStatus: cloudSale.effects_status || 'payment_recorded',
  cashSessionId: cloudSale.cash_session_id || response.cash_session?.id || null,
  cashMovementId: cloudSale.cash_movement_id || response.cash_movement?.id || null,
  cashEffectStatus: cloudSale.cash_effect_status || null,
  inventoryEffectStatus: cloudSale.inventory_effect_status || 'not_applied',
  creditEffectStatus: cloudSale.credit_effect_status || 'not_applied',
  customerLedgerId: cloudSale.customer_ledger_id || response.ledger_charge?.id || localSale.customerLedgerId || null,
  creditLedgerChargeId: cloudSale.credit_ledger_charge_id || response.ledger_charge?.id || localSale.creditLedgerChargeId || null,
  creditLedgerPaymentId: cloudSale.credit_ledger_payment_id || response.ledger_payment?.id || localSale.creditLedgerPaymentId || null,
  creditCustomerDebtBefore: cloudSale.credit_customer_debt_before ?? response.sale?.credit_customer_debt_before ?? localSale.creditCustomerDebtBefore ?? null,
  creditCustomerDebtAfter: cloudSale.credit_customer_debt_after ?? response.sale?.credit_customer_debt_after ?? localSale.creditCustomerDebtAfter ?? null,
  committedAt: cloudSale.committed_at || null,
  postEffectsCompleted: false,
  syncStatus: 'SYNCED',
  cancelledAt: cloudSale.cancelled_at || localSale.cancelledAt || null,
  cancelReason: cloudSale.cancel_reason || localSale.cancelReason || null,
  cancellationId: cloudSale.cancellation_id || localSale.cancellationId || null,
  cancellationStatus: cloudSale.cancellation_status || localSale.cancellationStatus || null,
  reversalStatus: cloudSale.reversal_status || localSale.reversalStatus || null,
  cashReversalStatus: cloudSale.cash_reversal_status || localSale.cashReversalStatus || 'not_required',
  inventoryReversalStatus: cloudSale.inventory_reversal_status || localSale.inventoryReversalStatus || 'not_required',
  creditReversalStatus: cloudSale.credit_reversal_status || localSale.creditReversalStatus || 'not_required',
});

export const salesCloudLocalRepository = {
  async markShadowPending(saleId, { reason = 'pending_shadow_sync' } = {}) {
    if (!saleId) return null;
    await ensureOpen();
    const existing = await db.table(STORES.SALES).get(saleId);
    if (!existing || existing.sourceMode === 'cloud_committed') return null;

    const patch = {
      cloudSalesSyncStatus: 'pending',
      cloudSalesLastSyncAt: existing.cloudSalesLastSyncAt || null,
      cloudSalesSyncError: reason,
      sourceMode: existing.sourceMode || 'shadow',
      effectsStatus: existing.effectsStatus || 'local_applied'
    };

    await db.table(STORES.SALES).update(saleId, patch);
    return { ...existing, ...patch };
  },

  async markShadowFailed(saleId, error) {
    if (!saleId) return null;
    await ensureOpen();
    const existing = await db.table(STORES.SALES).get(saleId);
    if (!existing || existing.sourceMode === 'cloud_committed') return null;

    const patch = {
      cloudSalesSyncStatus: 'failed',
      cloudSalesLastSyncAt: nowIso(),
      cloudSalesSyncError: stringifyError(error),
      sourceMode: existing.sourceMode || 'shadow',
      effectsStatus: existing.effectsStatus || 'local_applied'
    };

    await db.table(STORES.SALES).update(saleId, patch);
    return { ...existing, ...patch };
  },

  async markShadowSynced(localSaleId, response = {}) {
    if (!localSaleId) return null;
    await ensureOpen();
    const existing = await db.table(STORES.SALES).get(localSaleId);
    if (!existing || existing.sourceMode === 'cloud_committed') return null;

    const patch = cloudSaleToLocalSyncPatch(response.sale || {}, response);
    await db.table(STORES.SALES).update(localSaleId, patch);
    return { ...existing, ...patch };
  },

  async saveCloudCommittedSaleSnapshot({ localSale = {}, response = {} } = {}) {
    await ensureOpen();

    const cloudSale = response.sale || {};
    const saleId = localSale.id || cloudSale.local_sale_id || cloudSale.id;

    if (!saleId || !cloudSale.id) return null;

    const items = Array.isArray(response.items) ? response.items : [];
    const localSnapshot = buildLocalCloudCommittedSale({
      localSale,
      cloudSale,
      items,
      response
    });

    const now = nowIso();
    const deterministicLogId = `txn_cloud_sale_${saleId}`;

    await db.transaction(
      'rw',
      [db.table(STORES.SALES), db.table(STORES.TRANSACTION_LOG)],
      async () => {
        await db.table(STORES.SALES).put(localSnapshot);

        const existingLog = await db.table(STORES.TRANSACTION_LOG)
          .filter((log) => (
            log?.type === 'CLOUD_SALE' &&
            (
              log?.saleId === saleId ||
              log?.cloudSaleId === cloudSale.id ||
              log?.id === deterministicLogId
            )
          ))
          .first();

        await db.table(STORES.TRANSACTION_LOG).put({
          id: existingLog?.id || deterministicLogId,
          type: 'CLOUD_SALE',
          status: 'COMPLETED',
          timestamp: existingLog?.timestamp || now,
          updatedAt: now,
          amount: localSnapshot.total,
          saleId,
          cloudSaleId: cloudSale.id,
          folio: localSnapshot.folio,
          sourceMode: 'cloud_committed',
          creditEffectStatus: localSnapshot.creditEffectStatus,
          creditLedgerChargeId: localSnapshot.creditLedgerChargeId || null,
          creditLedgerPaymentId: localSnapshot.creditLedgerPaymentId || null
        });
      }
    );

    return localSnapshot;
  },

  async markLocalSplitParentSettled({ parentOrderId, splitGroupId = null, childSaleIds = [] } = {}) {
    if (!parentOrderId) throw new Error('SPLIT_PARENT_ID_REQUIRED');
    await ensureOpen();

    return db.transaction(
      'rw',
      [db.table(STORES.SALES), db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES)],
      async () => {
        const existing = await db.table(STORES.SALES).get(parentOrderId);
        if (!existing) throw new Error('SPLIT_PARENT_LOCAL_NOT_FOUND');

        const settledAt = nowIso();
        const reconciliation = existing.splitReservationReconciledAt
          ? {
            status: existing.splitReservationReconcileStatus || 'completed',
            warnings: Array.isArray(existing.splitReservationReconcileWarnings)
              ? existing.splitReservationReconcileWarnings
              : []
          }
          : await reconcileLocalTableReservations({
            items: existing.items,
            settledAt
          });

        const patch = {
          status: 'cancelled',
          fulfillmentStatus: 'completed',
          splitGroupId: splitGroupId || existing.splitGroupId || null,
          splitChildIds: Array.isArray(childSaleIds) ? childSaleIds : [],
          splitSettledAt: existing.splitSettledAt || settledAt,
          splitSettlementSource: 'cloud_committed',
          splitReservationReconciledAt: existing.splitReservationReconciledAt || settledAt,
          splitReservationReconcileStatus: reconciliation.status,
          splitReservationReconcileWarnings: reconciliation.warnings,
          cloudSalesSyncStatus: 'synced',
          cloudSalesLastSyncAt: settledAt,
          cloudSalesSyncError: null,
          syncStatus: 'SYNCED'
        };

        await db.table(STORES.SALES).update(parentOrderId, patch);
        return { ...existing, ...patch };
      }
    );
  },

  async getSaleById(saleId) {
    if (!saleId) return null;
    await ensureOpen();
    return db.table(STORES.SALES).get(saleId);
  },

  async getPendingShadowSales({ limit = 25 } = {}) {
    await ensureOpen();

    try {
      const pending = await db.table(STORES.SALES)
        .where('cloudSalesSyncStatus')
        .anyOf(['pending', 'failed'])
        .filter((sale) => sale?.status !== 'open' && sale?.sourceMode !== 'cloud_committed')
        .limit(limit)
        .toArray();

      return pending;
    } catch {
      return db.table(STORES.SALES)
        .filter((sale) => ['pending', 'failed'].includes(sale?.cloudSalesSyncStatus) && sale?.status !== 'open' && sale?.sourceMode !== 'cloud_committed')
        .limit(limit)
        .toArray();
    }
  },

  async applyCloudSalesPayload(response = {}) {
    await ensureOpen();
    const sales = Array.isArray(response.sales) ? response.sales : (response.sale ? [response.sale] : []);
    const items = Array.isArray(response.items) ? response.items : [];
    const payments = Array.isArray(response.payments) ? response.payments : [];
    let cached = 0;
    let patchedLocal = 0;

    for (const sale of sales) {
      const saleItems = items.filter((item) => item.sale_id === sale.id || item.saleId === sale.id);
      const salePayments = payments.filter((payment) => payment.sale_id === sale.id || payment.saleId === sale.id);
      if (await upsertCloudSaleCache({ sale, items: saleItems, payments: salePayments })) cached += 1;

      const localSaleId = getLocalSaleId(sale);
      if (!localSaleId) continue;

      const localSale = await db.table(STORES.SALES).get(localSaleId);
      if (!localSale) continue;

      const saleIsCancelled = isCancelledCloudSale(sale);

      // Si ya era cloud_committed y el payload NO trae cancelación,
      // no lo reescribimos para evitar parpadeos o sobreescrituras innecesarias.
      if (localSale.sourceMode === 'cloud_committed' && isCloudCommitted(sale) && !saleIsCancelled) {
        continue;
      }

      const patch = saleIsCancelled
        ? cloudCancellationToLocalPatch(sale, response)
        : cloudSaleToLocalSyncPatch(sale, response);

      await db.table(STORES.SALES).update(localSaleId, patch);
      patchedLocal += 1;
    }

    return { cached, patchedLocal };
  }
};

export default salesCloudLocalRepository;
