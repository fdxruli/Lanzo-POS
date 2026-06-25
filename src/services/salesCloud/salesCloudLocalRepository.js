import { db, STORES } from '../db/dexie';
import { cloudSaleToLocalSyncPatch } from './salesCloudMapper';

const CLOUD_SALE_CACHE_PREFIX = 'cloud_sale_shadow:';
const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const stringifyError = (error) => (
  error?.message || error?.code || String(error || 'Error desconocido')
);

const getLocalSaleId = (cloudSale = {}) => cloudSale.local_sale_id || cloudSale.localSaleId || cloudSale.id || null;

const upsertCloudSaleCache = async ({ sale, items = [], payments = [] }) => {
  if (!sale?.id) return null;

  const row = {
    key: `${CLOUD_SALE_CACHE_PREFIX}${sale.id}`,
    value: {
      sale,
      items,
      payments,
      cachedAt: nowIso(),
      phase: 'fase6a_sales_cloud_base'
    },
    updatedAt: nowIso()
  };

  await db.table(STORES.SYNC_CACHE).put(row);
  return row;
};

export const salesCloudLocalRepository = {
  async markShadowPending(saleId, { reason = 'pending_shadow_sync' } = {}) {
    if (!saleId) return null;
    await ensureOpen();
    const existing = await db.table(STORES.SALES).get(saleId);
    if (!existing) return null;

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
    if (!existing) return null;

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
    if (!existing) return null;

    const patch = cloudSaleToLocalSyncPatch(response.sale || {}, response);
    await db.table(STORES.SALES).update(localSaleId, patch);
    return { ...existing, ...patch };
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
        .filter((sale) => sale?.status !== 'open')
        .limit(limit)
        .toArray();

      return pending;
    } catch {
      return db.table(STORES.SALES)
        .filter((sale) => ['pending', 'failed'].includes(sale?.cloudSalesSyncStatus) && sale?.status !== 'open')
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

      await db.table(STORES.SALES).update(localSaleId, cloudSaleToLocalSyncPatch(sale, response));
      patchedLocal += 1;
    }

    return { cached, patchedLocal };
  }
};

export default salesCloudLocalRepository;
