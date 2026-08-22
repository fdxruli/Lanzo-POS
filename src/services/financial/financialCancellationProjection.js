import { db, STORES } from '../db/dexie';
import { registerFinancialProjectionHandler } from './financialProjectionRegistry';

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

// Keep the recovery projector cold-import safe: this is the immutable response
// mapping used by cancellation projection, copied here to avoid pulling a
// route-only cancellation chunk into the administrative startup graph.
const mapCancellationResponseToLocalPatch = (response = {}) => {
  const sale = response.sale || {};
  const cancellation = response.cancellation || {};
  const cancelledAt = sale.cancelled_at || sale.cancelledAt || cancellation.created_at || new Date().toISOString();
  const cancellationId = sale.cancellation_id || sale.cancellationId || cancellation.id || null;
  return {
    status: sale.status || 'cancelled', fulfillmentStatus: sale.fulfillment_status || 'cancelled',
    cancelledAt, cancelledBy: sale.cancelled_by_staff_user_id || sale.cancelled_by_device_id || cancellation.actor_name || 'cloud',
    cancelReason: sale.cancel_reason || cancellation.reason || 'cancelacion_cloud', cancellationId,
    cancellationStatus: sale.cancellation_status || cancellation.status || 'completed', reversalStatus: sale.reversal_status || 'applied',
    cashReversalStatus: sale.cash_reversal_status || cancellation.cash_reversal_status || 'not_required',
    inventoryReversalStatus: sale.inventory_reversal_status || cancellation.inventory_reversal_status || 'not_required',
    creditReversalStatus: sale.credit_reversal_status || cancellation.credit_reversal_status || 'not_required',
    cloudSaleId: sale.id || sale.cloud_sale_id || response.sale?.id || null, cloudFolio: sale.cloud_folio || sale.folio || undefined,
    sourceMode: sale.source_mode || 'cloud_committed', effectsStatus: sale.effects_status || undefined,
    cashEffectStatus: sale.cash_effect_status || undefined, inventoryEffectStatus: sale.inventory_effect_status || undefined,
    creditEffectStatus: sale.credit_effect_status || undefined, cancellationIntegrity: response.integrity || undefined,
    syncStatus: 'SYNCED', cloudSalesSyncStatus: 'synced', cloudSalesLastSyncAt: new Date().toISOString(),
    cloudSalesSyncError: null, cloudServerVersion: Number(sale.server_version || response.server_version || 0) || null
  };
};

// Shared normal/recovery cancellation persistence.  The transaction-log key is
// deterministic, so repeating a completed receipt cannot duplicate a reversal.
export const saveCloudSaleCancellationPatch = async ({ localSale = {}, response = {}, patch = {} }) => {
  await ensureOpen();
  const cloudSale = response.sale || {};
  const localSaleId = localSale.id || cloudSale.local_sale_id || cloudSale.id || localSale.cloudSaleId;
  if (!localSaleId) return { ...localSale, ...patch };
  const now = new Date().toISOString();
  const deterministicLogId = `txn_cloud_sale_cancel_${localSaleId}`;
  let patchedSale = { ...localSale, ...patch };
  await db.transaction('rw', [db.table(STORES.SALES), db.table(STORES.TRANSACTION_LOG)], async () => {
    const existing = await db.table(STORES.SALES).get(localSaleId);
    patchedSale = { ...(existing || localSale), ...patch, id: localSaleId, updatedAt: now };
    await db.table(STORES.SALES).put(patchedSale);
    await db.table(STORES.TRANSACTION_LOG).put({
      id: deterministicLogId, type: 'CLOUD_SALE_CANCELLED', status: 'COMPLETED',
      timestamp: patch.cancelledAt || now, updatedAt: now, saleId: localSaleId,
      cloudSaleId: cloudSale.id || localSale.cloudSaleId || null,
      cancellationId: patch.cancellationId || response.cancellation?.id || null,
      folio: patchedSale.folio || patchedSale.cloudFolio || cloudSale.cloud_folio || null,
      cashReversalStatus: patch.cashReversalStatus || null,
      inventoryReversalStatus: patch.inventoryReversalStatus || null,
      creditReversalStatus: patch.creditReversalStatus || null,
      integrityStatus: response.integrity?.is_valid === false ? 'ISSUES_FOUND' : 'OK'
    });
  });
  return patchedSale;
};

export const applySaleCancellationFinancialProjection = async ({ responsePayload, actorHandle }) => {
  actorHandle?.assertCurrent?.();
  const response = responsePayload || {};
  const result = await saveCloudSaleCancellationPatch({
    localSale: {}, response, patch: mapCancellationResponseToLocalPatch(response)
  });
  actorHandle?.assertCurrent?.();
  if (typeof window !== 'undefined') {
    ['lanzo:sales-sync-updated', 'lanzo:cash-sync-updated', 'lanzo:products-sync-updated', 'lanzo:customer-credit-sync-updated', 'lanzo:reports-sync-updated']
      .forEach((eventName) => window.dispatchEvent(new CustomEvent(eventName)));
  }
  return result;
};

registerFinancialProjectionHandler('sale.cancel', applySaleCancellationFinancialProjection);
