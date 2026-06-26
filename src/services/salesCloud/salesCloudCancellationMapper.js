const toNumber = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
};

export const getCloudSaleId = (sale = {}) => firstText(
  sale.cloudSaleId,
  sale.cloud_sale_id,
  sale.id
);

export const isCloudCommittedSale = (sale = {}) => (
  (sale.sourceMode || sale.source_mode) === 'cloud_committed'
);

export const isCloudSaleCancelled = (sale = {}) => (
  sale.status === 'cancelled' || Boolean(sale.cancelledAt || sale.cancelled_at || sale.cancellationId || sale.cancellation_id)
);

export const shouldUseCloudCancellation = (sale = {}) => (
  isCloudCommittedSale(sale) && !isCloudSaleCancelled(sale)
);

export const buildCancellationIdempotencyKey = ({ saleId, deviceId }) => (
  `sales.cloud_cancel:${saleId}:${deviceId || 'device'}`
);

export const buildCancellationPreview = (sale = {}) => {
  const total = toNumber(sale.total, 0);
  const cashEffectStatus = sale.cashEffectStatus || sale.cash_effect_status || 'not_required';
  const inventoryEffectStatus = sale.inventoryEffectStatus || sale.inventory_effect_status || 'not_required';
  const creditEffectStatus = sale.creditEffectStatus || sale.credit_effect_status || 'not_required';
  const cashAmount = toNumber(sale.abono ?? sale.amount_paid, total);
  const balanceDue = toNumber(sale.saldoPendiente ?? sale.balance_due, 0);

  return {
    total,
    cashReversalRequired: cashEffectStatus === 'applied' || Boolean(sale.cashMovementId || sale.cash_movement_id),
    inventoryReversalRequired: inventoryEffectStatus === 'applied',
    creditReversalRequired: creditEffectStatus === 'applied' || balanceDue > 0,
    cashAmount,
    balanceDue,
    customerName: firstText(sale.customerName, sale.customer_name, sale.customer?.name, sale.customerSnapshot?.name),
    folio: firstText(sale.cloudFolio, sale.cloud_folio, sale.folio, sale.id)
  };
};

export const mapCancellationResponseToLocalPatch = (response = {}) => {
  const sale = response.sale || {};
  const cancellation = response.cancellation || {};
  const cancelledAt = sale.cancelled_at || sale.cancelledAt || cancellation.created_at || new Date().toISOString();
  const cancellationId = sale.cancellation_id || sale.cancellationId || cancellation.id || null;

  return {
    status: sale.status || 'cancelled',
    fulfillmentStatus: sale.fulfillment_status || 'cancelled',
    cancelledAt,
    cancelledBy: sale.cancelled_by_staff_user_id || sale.cancelled_by_device_id || cancellation.actor_name || 'cloud',
    cancelReason: sale.cancel_reason || cancellation.reason || 'cancelacion_cloud',
    cancellationId,
    cancellationStatus: sale.cancellation_status || cancellation.status || 'completed',
    reversalStatus: sale.reversal_status || 'applied',
    cashReversalStatus: sale.cash_reversal_status || cancellation.cash_reversal_status || 'not_required',
    inventoryReversalStatus: sale.inventory_reversal_status || cancellation.inventory_reversal_status || 'not_required',
    creditReversalStatus: sale.credit_reversal_status || cancellation.credit_reversal_status || 'not_required',
    cloudSaleId: sale.id || sale.cloud_sale_id || response.sale?.id || null,
    cloudFolio: sale.cloud_folio || sale.folio || undefined,
    sourceMode: sale.source_mode || 'cloud_committed',
    effectsStatus: sale.effects_status || undefined,
    cashEffectStatus: sale.cash_effect_status || undefined,
    inventoryEffectStatus: sale.inventory_effect_status || undefined,
    creditEffectStatus: sale.credit_effect_status || undefined,
    syncStatus: 'SYNCED',
    cloudSalesSyncStatus: 'synced',
    cloudSalesLastSyncAt: new Date().toISOString(),
    cloudSalesSyncError: null,
    cloudServerVersion: Number(sale.server_version || response.server_version || 0) || null
  };
};

export default {
  getCloudSaleId,
  isCloudCommittedSale,
  isCloudSaleCancelled,
  shouldUseCloudCancellation,
  buildCancellationIdempotencyKey,
  buildCancellationPreview,
  mapCancellationResponseToLocalPatch
};
