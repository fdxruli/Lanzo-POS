import { db, STORES } from '../db/dexie';
import { generateID } from '../utils';
import { cloudSaleToLocalSyncPatch } from './salesCloudMapper';

const CLOUD_SALE_CACHE_PREFIX = 'cloud_sale:';
const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const stringifyError = (error) => (
  error?.message || error?.code || String(error || 'Error desconocido')
);

const getLocalSaleId = (cloudSale = {}) => cloudSale.local_sale_id || cloudSale.localSaleId || cloudSale.id || null;
const isCloudCommitted = (sale = {}) => (sale.source_mode || sale.sourceMode) === 'cloud_committed';

const upsertCloudSaleCache = async ({ sale, items = [], payments = [] }) => {
  if (!sale?.id) return null;

  const row = {
    key: `${CLOUD_SALE_CACHE_PREFIX}${sale.id}`,
    value: {
      sale,
      items,
      payments,
      cachedAt: nowIso(),
      phase: isCloudCommitted(sale) ? 'fase6b_cloud_cashier_sales' : 'fase6a_sales_cloud_base'
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
  abono: String(cloudSale.amount_paid ?? localSale.abono ?? cloudSale.total ?? 0),
  saldoPendiente: String(cloudSale.balance_due ?? 0),
  status: cloudSale.status || localSale.status || 'closed',
  folio: cloudSale.cloud_folio || cloudSale.folio || localSale.folio,
  cloudFolio: cloudSale.cloud_folio || null,
  cloudSaleId: cloudSale.id || response.sale?.id || null,
  cloudSalesSyncStatus: 'synced',
  cloudSalesLastSyncAt: nowIso(),
  cloudSalesSyncError: null,
  cloudServerVersion: Number(cloudSale.server_version || response.server_version || 0) || null,
  sourceMode: cloudSale.source_mode || 'cloud_committed',
  effectsStatus: cloudSale.effects_status || 'payment_recorded',
  cashSessionId: cloudSale.cash_session_id || null,
  cashMovementId: cloudSale.cash_movement_id || null,
  cashEffectStatus: cloudSale.cash_effect_status || null,
  inventoryEffectStatus: cloudSale.inventory_effect_status || 'not_applied',
  creditEffectStatus: cloudSale.credit_effect_status || 'not_applied',
  committedAt: cloudSale.committed_at || null,
  postEffectsCompleted: false,
  syncStatus: 'SYNCED'
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
    const localSnapshot = buildLocalCloudCommittedSale({ localSale, cloudSale, items, response });

    await db.transaction('rw', [db.table(STORES.SALES), db.table(STORES.TRANSACTION_LOG)], async () => {
      await db.table(STORES.SALES).put(localSnapshot);
      await db.table(STORES.TRANSACTION_LOG).put({
        id: generateID('txn'),
        type: 'CLOUD_SALE',
        status: 'COMPLETED',
        timestamp: nowIso(),
        amount: localSnapshot.total,
        saleId,
        cloudSaleId: cloudSale.id,
        folio: localSnapshot.folio,
        sourceMode: 'cloud_committed'
      });
    });

    return localSnapshot;
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
      if (localSale.sourceMode === 'cloud_committed' && isCloudCommitted(sale)) continue;

      await db.table(STORES.SALES).update(localSaleId, cloudSaleToLocalSyncPatch(sale, response));
      patchedLocal += 1;
    }

    return { cached, patchedLocal };
  }
};

export default salesCloudLocalRepository;
