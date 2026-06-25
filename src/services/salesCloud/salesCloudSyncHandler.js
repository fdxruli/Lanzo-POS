import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudSalesBaseSyncEnabled,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { salesCloudRepository } from './salesCloudRepository';
import { salesCloudLocalRepository } from './salesCloudLocalRepository';
import { salesCloudShadowService } from './salesCloudShadowService';

const SALES_LAST_CHANGE_SEQ_KEY = 'sales_cloud_base_last_change_seq';
let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const notifySalesCloudChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:sales-cloud-sync-updated'));
};

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const hasSalesEvents = (events = []) => events.some((event) => {
  const entityType = event.entity_type || event.entityType;
  return entityType === SYNC_ENTITY_TYPES.SALE
    || entityType === SYNC_ENTITY_TYPES.SALE_ITEM
    || entityType === SYNC_ENTITY_TYPES.SALE_PAYMENT;
});

const applySalesPayload = async (response = {}) => {
  const result = await salesCloudLocalRepository.applyCloudSalesPayload(response);
  return Number(result.cached || 0) + Number(result.patchedLocal || 0);
};

export const salesCloudSyncHandler = {
  async onStart({ licenseDetails, licenseKey } = {}) {
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(licenseDetails);
    if (!resolvedLicenseKey || !isOnline() || !isCloudSalesBaseSyncEnabled(licenseDetails)) {
      return { skipped: true };
    }

    try {
      await salesCloudShadowService.retryPendingShadowSales({ limit: 10 });

      const snapshot = await salesCloudRepository.pullSalesSnapshot({
        licenseKey: resolvedLicenseKey,
        limit: 100,
        includeDeleted: false
      });

      if (snapshot?.success === false) {
        throw new Error(snapshot.message || snapshot.code || 'SALES_CLOUD_SNAPSHOT_FAILED');
      }

      const applied = await applySalesPayload(snapshot);
      const latestChangeSeq = normalizeChangeSeq(snapshot, 0);
      if (latestChangeSeq > 0) {
        await syncMetaService.setMeta(SALES_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey: resolvedLicenseKey });
      }

      if (applied > 0) notifySalesCloudChanged();
      return { success: true, applied, latestChangeSeq };
    } catch (error) {
      Logger.warn('[SalesCloud/Sync] Inicio fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = []) {
    const licenseKey = getRuntimeLicenseKey();
    if (!licenseKey || !isOnline()) return { applied: 0, skipped: true };
    if (events.length > 0 && !hasSalesEvents(events)) return { applied: 0, skipped: true };

    let sinceChangeSeq = Number(await syncMetaService.getMeta(SALES_LAST_CHANGE_SEQ_KEY, 0, { licenseKey })) || 0;
    let hasMore = true;
    let applied = 0;

    while (hasMore) {
      const response = await salesCloudRepository.pullSalesChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'SALES_CLOUD_CHANGES_PULL_FAILED');
      }

      applied += await applySalesPayload(response);

      const latestChangeSeq = normalizeChangeSeq(response, sinceChangeSeq);
      if (latestChangeSeq > sinceChangeSeq) {
        sinceChangeSeq = latestChangeSeq;
        await syncMetaService.setMeta(SALES_LAST_CHANGE_SEQ_KEY, sinceChangeSeq, { licenseKey });
      }

      hasMore = Boolean(response.has_more || response.hasMore) && latestChangeSeq > 0;
      if (!response.has_more && !response.hasMore) hasMore = false;
    }

    if (applied > 0) notifySalesCloudChanged();
    return { applied, latestChangeSeq: sinceChangeSeq };
  },

  async pushOperation(operation = {}) {
    if (operation.operation !== SYNC_OPERATIONS.UPSERT_SHADOW) {
      throw new Error('SALES_CLOUD_OPERATION_NOT_ALLOWED_IN_6A');
    }

    const licenseKey = operation.licenseKey || getRuntimeLicenseKey();
    if (!licenseKey) throw new Error('SALES_CLOUD_OUTBOX_LICENSE_REQUIRED');

    const payload = operation.payload || {};
    let localSale = payload.sale;
    if (!localSale?.id && operation.entityId) {
      localSale = await salesCloudLocalRepository.getSaleById(operation.entityId);
    }

    if (!localSale?.id && !payload.sale?.id) {
      throw new Error('SALES_CLOUD_OUTBOX_SALE_REQUIRED');
    }

    const response = await salesCloudRepository.upsertSaleShadow({
      licenseKey,
      sale: payload.sale,
      items: payload.items || [],
      payments: payload.payments || [],
      idempotencyKey: operation.idempotencyKey || payload.idempotencyKey
    });

    if (response?.success === false) {
      throw new Error(response.message || response.code || 'SALES_CLOUD_OUTBOX_PUSH_FAILED');
    }

    await salesCloudLocalRepository.applyCloudSalesPayload(response);
    await salesCloudLocalRepository.markShadowSynced(operation.entityId || payload.sale?.id, response);
    notifySalesCloudChanged();
    return response;
  }
};

export const registerSalesCloudSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE, salesCloudSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE_ITEM, salesCloudSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE_PAYMENT, salesCloudSyncHandler);
  registered = true;
  Logger.log('[SalesCloud/Sync] Handler Fase 6A registrado. Solo shadow/auditoria, sin efectos financieros cloud.');
  return true;
};

registerSalesCloudSyncHandler();

export default salesCloudSyncHandler;
