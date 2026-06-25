import Logger from '../Logger';
import { getStableDeviceId } from '../supabase';
import { useAppStore } from '../../store/useAppStore';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudSalesBaseSyncEnabled,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { localSaleToCloudShadowPayload } from './salesCloudMapper';
import { salesCloudRepository } from './salesCloudRepository';
import { salesCloudLocalRepository } from './salesCloudLocalRepository';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const getContext = async () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const deviceId = await getStableDeviceId().catch(() => 'device');

  return {
    licenseDetails,
    licenseKey,
    deviceId,
    enabled: Boolean(licenseKey && isCloudSalesBaseSyncEnabled(licenseDetails))
  };
};

const enqueueShadow = async ({ licenseKey, saleId, payload, reason }) => {
  if (!licenseKey || !saleId) return null;

  return syncOutboxService.enqueueOperation({
    licenseKey,
    entityType: SYNC_ENTITY_TYPES.SALE,
    operation: SYNC_OPERATIONS.UPSERT_SHADOW,
    entityId: saleId,
    payload,
    idempotencyKey: payload.idempotencyKey,
    metadata: {
      phase: 'fase6a_sales_cloud_base',
      sourceMode: 'shadow',
      effectsStatus: 'local_applied',
      reason
    }
  });
};

export const salesCloudShadowService = {
  async syncSaleShadowAfterLocalCommit(localSale, options = {}) {
    if (!localSale?.id) return { skipped: true, reason: 'sale_id_missing' };

    const context = await getContext();
    if (!context.enabled) return { skipped: true, reason: 'cloud_sales_sync_base_disabled' };

    const payload = localSaleToCloudShadowPayload(localSale, {
      ...options,
      deviceId: context.deviceId
    });

    await salesCloudLocalRepository.markShadowPending(localSale.id, {
      reason: isOnline() ? 'sync_attempt_started' : 'offline_shadow_pending'
    });

    if (!isOnline()) {
      await enqueueShadow({
        licenseKey: context.licenseKey,
        saleId: localSale.id,
        payload,
        reason: 'offline'
      }).catch((error) => Logger.warn('[SalesCloud/Shadow] No se pudo encolar venta offline:', error));

      return { success: false, pending: true, reason: 'offline' };
    }

    try {
      const response = await salesCloudRepository.upsertSaleShadow({
        licenseKey: context.licenseKey,
        ...payload
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'SALE_SHADOW_SYNC_FAILED');
      }

      await salesCloudLocalRepository.applyCloudSalesPayload(response);
      await salesCloudLocalRepository.markShadowSynced(localSale.id, response);
      return { success: true, response };
    } catch (error) {
      Logger.warn('[SalesCloud/Shadow] Sync shadow fallo sin revertir venta local:', error);
      await salesCloudLocalRepository.markShadowFailed(localSale.id, error);
      await enqueueShadow({
        licenseKey: context.licenseKey,
        saleId: localSale.id,
        payload,
        reason: 'cloud_error'
      }).catch((queueError) => Logger.warn('[SalesCloud/Shadow] No se pudo encolar reintento:', queueError));

      return { success: false, pending: true, error };
    }
  },

  async retryPendingShadowSales({ limit = 10 } = {}) {
    const context = await getContext();
    if (!context.enabled || !isOnline()) return { skipped: true };

    const pendingSales = await salesCloudLocalRepository.getPendingShadowSales({ limit });
    let synced = 0;
    let failed = 0;

    for (const sale of pendingSales) {
      const result = await this.syncSaleShadowAfterLocalCommit(sale, { retry: true });
      if (result?.success) synced += 1;
      else if (!result?.skipped) failed += 1;
    }

    return { success: true, synced, failed };
  }
};

export default salesCloudShadowService;
