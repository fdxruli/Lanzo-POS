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

const getFirstBlockMessage = (reasons = []) => {
  const first = Array.isArray(reasons) ? reasons[0] : null;
  return firstText(first?.message, first?.code);
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
    canCancel: true,
    source: 'local_estimate',
    cashReversalRequired: cashEffectStatus === 'applied' || Boolean(sale.cashMovementId || sale.cash_movement_id),
    inventoryReversalRequired: inventoryEffectStatus === 'applied',
    creditReversalRequired: creditEffectStatus === 'applied' || balanceDue > 0,
    cashAmount,
    balanceDue,
    customerName: firstText(sale.customerName, sale.customer_name, sale.customer?.name, sale.customerSnapshot?.name),
    folio: firstText(sale.cloudFolio, sale.cloud_folio, sale.folio, sale.id),
    blockReasons: []
  };
};

export const normalizeCloudCancellationPreview = (response = {}, localSale = {}) => {
  const base = buildCancellationPreview(localSale);
  const preview = response?.preview || {};
  const sale = response?.sale || {};
  const cash = preview.cash || {};
  const inventory = preview.inventory || {};
  const credit = preview.credit || {};
  const blockReasons = Array.isArray(response?.block_reasons) ? response.block_reasons : [];

  return {
    ...base,
    source: response?.mode || 'cloud_sale_cancellation_preview',
    canCancel: response?.can_cancel !== false,
    code: response?.code || 'OK',
    message: response?.message || getFirstBlockMessage(blockReasons),
    blockReasons,
    total: toNumber(sale.total ?? localSale.total, base.total),
    folio: firstText(response?.folio, sale.cloud_folio, sale.folio, localSale.cloudFolio, localSale.folio, localSale.id),
    cashReversalRequired: Boolean(cash.required),
    cashAmount: toNumber(cash.reversal_amount, base.cashAmount),
    cashMovementCount: toNumber(cash.original_movement_count, 0),
    cashSessionIds: Array.isArray(cash.cash_session_ids) ? cash.cash_session_ids : [],
    inventoryReversalRequired: Boolean(inventory.required),
    inventoryQuantity: toNumber(inventory.return_quantity, 0),
    inventoryMovementCount: toNumber(inventory.original_movement_count, 0),
    creditReversalRequired: Boolean(credit.required),
    creditReversalAmount: toNumber(credit.reversal_amount, 0),
    debtBefore: toNumber(credit.debt_before, 0),
    debtAfterPreview: toNumber(credit.debt_after_preview, 0),
    subsequentPaymentCount: toNumber(credit.subsequent_payment_count, 0),
    customerName: firstText(credit.customer_name, sale.customer_name, base.customerName),
    runtimeCancellationEnabled: response?.runtimeCancellationEnabled !== false,
    licenseCancellationEnabled: response?.licenseCancellationEnabled !== false
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
    cancellationIntegrity: response.integrity || undefined,
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
  normalizeCloudCancellationPreview,
  mapCancellationResponseToLocalPatch
};
