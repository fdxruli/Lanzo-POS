import { db, STORES } from '../db/dexie';
import { getCommittedStock, normalizeStock } from '../db/utils';
import { cloudSaleToLocalSyncPatch, cloudSaleCreditBalancePatch } from './salesCloudMapper';
import { getTableReservationProductQuantities } from '../sales/inventoryFlow';
import { isRestaurantCloudTableShadow } from '../restaurant/restaurantCloudTableGuards';
import { cloudSalePaymentSnapshot, normalizeCloudSalePaymentRows } from './salesCloudPaymentSnapshot';

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
    }

    const orderProduct = await db.table(STORES.MENU).get(item.parentId || item.id);
    for (const usage of getTableReservationProductQuantities(item, orderProduct)) {
      const quantity = normalizeStock(usage.quantity);
      const productId = usage.productId;
      const product = updatedProducts.get(productId) || await db.table(STORES.MENU).get(productId);
      if (!product) {
        warnings.push('product:' + productId + ':not_found');
        continue;
      }
      const committedStock = getCommittedStock(product);
      if (committedStock < quantity) {
        warnings.push('product:' + productId + ':underflow:' + committedStock + ':' + quantity);
      }
      updatedProducts.set(productId, {
        ...product,
        committedStock: normalizeStock(Math.max(0, committedStock - quantity)),
        updatedAt: settledAt
      });
    }
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

const upsertCloudSaleCache = async ({ sale, items = [], payments = [], actorHandle = null }) => {
  if (!sale?.id) return null;
  actorHandle?.assertCurrent?.();
  const key = `${CLOUD_SALE_CACHE_PREFIX}${sale.id}`;
  const existing = await db.table(STORES.SYNC_CACHE).get(key);

  if (Number(existing?.value?.sale?.server_version || 0) > Number(sale.server_version || 0)) return null;
  const row = {
    key,
    value: {
      sale,
      items,
      payments: payments.length > 0 ? payments : normalizeCloudSalePaymentRows(existing?.value?.payments || []),
      cachedAt: nowIso(),
      phase: isCancelledCloudSale(sale)
        ? 'fase6e_cloud_sale_cancellations'
        : isCreditApplied(sale)
          ? 'fase6d_cloud_sales_credit_ledger'
          : (isCloudCommitted(sale) ? 'fase6b_cloud_cashier_sales' : 'fase6a_sales_cloud_base')
    },
    updatedAt: nowIso()
  };

  actorHandle?.assertCurrent?.();
  await db.table(STORES.SYNC_CACHE).put(row);
  actorHandle?.assertCurrent?.();
  return row;
};

const buildLocalCloudCommittedSale = ({ localSale = {}, cloudSale = {}, items = [], response = {} }) => ({
  ...localSale,
  id: localSale.id || cloudSale.local_sale_id || cloudSale.id,
  timestamp: cloudSale.sold_at || cloudSale.soldAt || localSale.timestamp || nowIso(),
  soldAt: cloudSale.sold_at || cloudSale.soldAt || localSale.soldAt || null,
  items: Array.isArray(localSale.items) && localSale.items.length > 0 ? localSale.items : items,
  total: String(cloudSale.total ?? localSale.total ?? 0),
  payments: cloudSalePaymentSnapshot({ response, cloudSale, localSale }),
  paymentMethod: cloudSale.payment_method || localSale.paymentMethod,
  paymentStatus: cloudSale.payment_status || localSale.paymentStatus || null,
  abono: String(cloudSale.amount_paid ?? localSale.abono ?? cloudSale.total ?? 0),
  ...cloudSaleCreditBalancePatch(cloudSale),
  status: cloudSale.status || localSale.status || 'closed',
  // Cloud's confirmed terminal receipt, not the earlier local checkout draft,
  // owns the final checkout lock. Never unlock an unconfirmed or open result.
  ...(cloudSale.status === 'closed' && cloudSale.source_mode === 'cloud_committed'
    ? { isLockedForCheckout: false, lockedAt: null } : {}),
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
  cash_session_id: cloudSale.cash_session_id || response.cash_session?.id || localSale.cash_session_id || null,
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

  async saveCloudCommittedSaleSnapshot({ localSale = {}, response = {}, actorHandle = null, recoveryRead = false } = {}) {
    await ensureOpen();

    actorHandle?.assertCurrent();
    const cloudSale = response.sale || {};
    const saleId = localSale.id || cloudSale.local_sale_id || cloudSale.id;

    if (!saleId || !cloudSale.id) return null;

    const items = Array.isArray(response.items) ? response.items : [];
    let localSnapshot;

    const now = nowIso();
    const deterministicLogId = `txn_cloud_sale_${saleId}`;

    await db.transaction(
      'rw',
      [db.table(STORES.SALES), db.table(STORES.TRANSACTION_LOG)],
      async () => {
        actorHandle?.assertCurrent();
        const existing = await db.table(STORES.SALES).get(saleId);
        actorHandle?.assertCurrent();
        if (recoveryRead) {
          const alreadyMapped = await db.table(STORES.SALES).where('cloudSaleId').equals(cloudSale.id).toArray();
          actorHandle?.assertCurrent();
          const existingKey = existing?.metadata?.ecommerceConversionKey || existing?.metadata?.idempotencyKey;
          const incomingKey = localSale.metadata?.ecommerceConversionKey || localSale.metadata?.idempotencyKey;
          if (alreadyMapped.some(row => row.id !== saleId)
            || (existing?.cloudSaleId && existing.cloudSaleId !== cloudSale.id)
            || (existingKey && incomingKey && existingKey !== incomingKey)) throw new Error('CLOUD_SALE_RECOVERY_IDENTITY_CONFLICT');
        }
        if (existing?.sourceMode === 'cloud_committed'
            && Number(existing.cloudServerVersion || 0) > Number(cloudSale.server_version || 0)) {
          if (recoveryRead) throw new Error('CLOUD_SALE_RECOVERY_LOCAL_VERSION_NEWER');
          localSnapshot = existing;
          return;
        }
        localSnapshot = buildLocalCloudCommittedSale({
          localSale: {
            ...existing, ...localSale,
            ...(recoveryRead ? {
              customerId: cloudSale.customer_id ?? null,
              customerName: cloudSale.customer_name ?? null,
              customerPhone: cloudSale.customer_phone ?? null,
              subtotal: cloudSale.subtotal == null ? undefined : String(cloudSale.subtotal),
              discountTotal: cloudSale.discount_total == null ? undefined : String(cloudSale.discount_total),
              taxTotal: cloudSale.tax_total == null ? undefined : String(cloudSale.tax_total),
              items: items.map(item => ({
                ...item,
                productId: item.product_id,
                name: item.product_name,
                price: item.unit_price,
                cost: item.unit_cost,
                lineId: item.metadata?.lineId || item.id,
                lineTotal: item.line_total,
                discountAmount: item.discount_amount,
                taxAmount: item.tax_amount,
                batchId: item.batch_id,
                batchSku: item.batch_sku,
                batchExpiryDate: item.batch_expiry_date
              }))
            } : {})
          }, cloudSale, items, response
        });
        actorHandle?.assertCurrent();
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

        actorHandle?.assertCurrent();
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
        actorHandle?.assertCurrent();
      }
    );

    actorHandle?.assertCurrent();
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

        if (existing.splitSettlementSource === 'cloud_committed' && existing.splitReservationReconciledAt) {
          return existing;
        }

        const settledAt = nowIso();
        const reconciliation = isRestaurantCloudTableShadow(existing)
          ? { status: 'not_owned', warnings: [] }
          : existing.splitReservationReconciledAt
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

  async applyCloudSalesPayload(response = {}, { actorHandle = null } = {}) {
    await ensureOpen();
    const sales = Array.isArray(response.sales) ? response.sales : (response.sale ? [response.sale] : []);
    const items = Array.isArray(response.items) ? response.items : [];
    const payments = Array.isArray(response.payments) ? response.payments : [];
    actorHandle?.assertCurrent?.();
    return db.transaction('rw', [STORES.SYNC_CACHE, STORES.SALES], async () => {
      let cached = 0;
      let patchedLocal = 0;
      actorHandle?.assertCurrent?.();

      for (const sale of sales) {
      actorHandle?.assertCurrent?.();
      const saleItems = items.filter((item) => item.sale_id === sale.id || item.saleId === sale.id);
      const salePayments = normalizeCloudSalePaymentRows(payments.filter((payment) => (
        payment?.sale_id === sale.id || payment?.saleId === sale.id
        || (!(payment?.sale_id || payment?.saleId) && sales.length === 1 && response.sale?.id === sale.id)
      )), { saleId: sale.id });
      if (await upsertCloudSaleCache({ sale, items: saleItems, payments: salePayments, actorHandle })) cached += 1;

      const localSaleId = getLocalSaleId(sale);
      if (!localSaleId) continue;

      const localSale = await db.table(STORES.SALES).get(localSaleId);
      if (!localSale) continue;

      if (Number(localSale.cloudServerVersion || 0) > Number(sale.server_version || 0)) continue;
      if (localSale.sourceMode !== 'cloud_committed'
        && (['pending', 'failed'].includes(String(localSale.cloudSalesSyncStatus || '').toLowerCase())
          || ['pending', 'failed'].includes(String(localSale.syncStatus || '').toLowerCase()))) {
        continue;
      }
      const saleIsCancelled = isCancelledCloudSale(sale);

      // Preserve committed commercial/inventory fields, but refresh the payment
      // projection so a normal Cloud pull repairs older snapshots too.
      if (localSale.sourceMode === 'cloud_committed' && isCloudCommitted(sale) && !saleIsCancelled) {
        if (salePayments.length > 0 || Object.hasOwn(sale, 'current_balance_due')) {
          actorHandle?.assertCurrent?.();
          await db.table(STORES.SALES).update(localSaleId, {
            ...(Object.hasOwn(sale, 'current_balance_due') ? cloudSaleCreditBalancePatch(sale) : {}),
            cloudServerVersion: Number(sale.server_version || 0),
            ...(salePayments.length > 0 ? { payments: salePayments } : {}),
            cash_session_id: sale.cash_session_id || localSale.cash_session_id || localSale.cashSessionId || null
          });
          actorHandle?.assertCurrent?.();
          patchedLocal += 1;
        }
        continue;
      }

      const patch = saleIsCancelled
        ? cloudCancellationToLocalPatch(sale, response)
        : cloudSaleToLocalSyncPatch(sale, response);
      if (salePayments.length > 0) patch.payments = salePayments;

      actorHandle?.assertCurrent?.();
      await db.table(STORES.SALES).update(localSaleId, patch);
      actorHandle?.assertCurrent?.();
      patchedLocal += 1;
      }

      actorHandle?.assertCurrent?.();
      return { cached, patchedLocal };
    });
  }
};

export default salesCloudLocalRepository;
