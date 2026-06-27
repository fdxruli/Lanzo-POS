import Logger from '../Logger';
import { getStableDeviceId } from '../supabase';
import { db, STORES } from '../db/dexie';
import { useAppStore } from '../../store/useAppStore';
import {
  ENABLE_CLOUD_SALE_CANCELLATIONS,
  getLicenseKeyFromDetails,
  isCloudSalesCancellationEnabled
} from '../sync/syncConstants';
import { salesCloudRepository } from './salesCloudRepository';
import {
  buildCancellationIdempotencyKey,
  getCloudSaleId,
  isCloudCommittedSale,
  isCloudSaleCancelled,
  mapCancellationResponseToLocalPatch
} from './salesCloudCancellationMapper';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const dispatchCancellationEvents = () => {
  if (typeof window === 'undefined') return;
  [
    'lanzo:sales-sync-updated',
    'lanzo:cash-sync-updated',
    'lanzo:products-sync-updated',
    'lanzo:customer-credit-sync-updated',
    'lanzo:reports-sync-updated'
  ].forEach((eventName) => window.dispatchEvent(new CustomEvent(eventName)));
};

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const saveCancellationPatch = async ({ localSale = {}, response = {}, patch = {} }) => {
  await ensureOpen();
  const cloudSale = response.sale || {};
  const localSaleId = localSale.id || cloudSale.local_sale_id || cloudSale.id || localSale.cloudSaleId;
  if (!localSaleId) return { ...localSale, ...patch };

  const now = new Date().toISOString();
  const deterministicLogId = `txn_cloud_sale_cancel_${localSaleId}`;
  let patchedSale = { ...localSale, ...patch };

  await db.transaction('rw', [db.table(STORES.SALES), db.table(STORES.TRANSACTION_LOG)], async () => {
    const existing = await db.table(STORES.SALES).get(localSaleId);
    patchedSale = {
      ...(existing || localSale),
      ...patch,
      id: localSaleId,
      updatedAt: now
    };

    await db.table(STORES.SALES).put(patchedSale);
    await db.table(STORES.TRANSACTION_LOG).put({
      id: deterministicLogId,
      type: 'CLOUD_SALE_CANCELLED',
      status: 'COMPLETED',
      timestamp: patch.cancelledAt || now,
      updatedAt: now,
      saleId: localSaleId,
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

const getRuntimeContext = async () => {
  const licenseDetails = useAppStore.getState()?.licenseDetails || null;
  return {
    licenseDetails,
    licenseKey: getLicenseKeyFromDetails(licenseDetails),
    deviceId: await getStableDeviceId().catch(() => 'device'),
    online: isOnline(),
    featureEnabled: isCloudSalesCancellationEnabled(licenseDetails),
    runtimeCancellationEnabled: ENABLE_CLOUD_SALE_CANCELLATIONS
  };
};

const getFirstBlockReason = (preview = {}) => {
  const reasons = Array.isArray(preview.block_reasons) ? preview.block_reasons : [];
  return reasons[0] || null;
};

const buildPreviewBlockedError = (preview = {}, fallbackCode = 'CLOUD_SALE_CANCELLATION_BLOCKED') => {
  const firstReason = getFirstBlockReason(preview);
  const error = new Error(firstReason?.message || preview.message || 'No se cancelo la venta para evitar descuadres.');
  error.code = firstReason?.code || preview.code || fallbackCode;
  error.response = preview;
  return error;
};

const friendlyCloudCancellationError = (error) => {
  const raw = String(error?.code || error?.message || error || '');
  const code = raw.match(/[A-Z0-9_]+(?::[a-z_]+)?/)?.[0] || raw;
  const messages = {
    OFFLINE: 'Esta venta fue registrada en la nube. Para cancelarla se necesita conexión.',
    CLOUD_SALES_CANCELLATIONS_DISABLED: 'Las cancelaciones cloud aun no estan activas para esta licencia.',
    CLOUD_SALE_CANCELLATIONS_RUNTIME_DISABLED: 'Las cancelaciones cloud estan apagadas temporalmente. Solo puedes revisar el preview.',
    CLOUD_SALE_CANCELLATION_REASON_REQUIRED: 'Indica el motivo de cancelacion para dejar auditoria.',
    CLOUD_SALE_CANCELLATION_PREVIEW_REQUIRED: 'No se pudo validar la cancelacion antes de aplicarla. No se modifico nada.',
    CLOUD_SALE_CANCELLATION_BLOCKED: 'No se cancelo la venta para evitar descuadres. Revisa el diagnostico.',
    SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS: 'Esta venta fiada tiene abonos posteriores independientes. No se cancelo automaticamente para evitar descuadrar la deuda.',
    SALE_ALREADY_CANCELLED: 'La venta ya fue cancelada anteriormente.',
    SALE_NOT_FOUND: 'No se encontro la venta en la nube. Actualiza el historial e intenta de nuevo.',
    SALE_NOT_CLOUD_COMMITTED: 'Esta venta no fue confirmada en la nube; se debe usar la cancelacion local.',
    SALE_NOT_CLOSED: 'Solo se pueden cancelar ventas cerradas.',
    SALE_CANCELLATION_FORBIDDEN: 'No tienes permiso para cancelar esta venta.',
    'POS_PERMISSION_DENIED:sales_cancellations': 'No tienes permiso para cancelar ventas.',
    IDEMPOTENCY_PROCESSING: 'La cancelacion ya esta en proceso. Evita presionar dos veces.',
    CUSTOMER_DEBT_NEGATIVE_AFTER_CANCEL: 'No se cancelo la venta porque la deuda quedaria inconsistente. Revisa abonos posteriores antes de cancelar.',
    CASH_SESSION_NOT_FOUND: 'No se encontro la caja original de la venta. No se aplico ningun cambio para evitar descuadres.',
    PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE: 'No se encontro el producto cloud para devolver inventario. No se aplico ningun cambio.',
    CLOUD_BATCH_NOT_AVAILABLE: 'No se encontro el lote cloud para devolver inventario. No se aplico ningun cambio.'
  };
  const mapped = new Error(messages[code] || error?.message || raw || 'No se pudo cancelar la venta. No se aplico ningun cambio para evitar descuadres.');
  mapped.code = code === 'SALE_ALREADY_CANCELLED' ? 'ALREADY_CANCELLED' : code;
  mapped.originalCode = code;
  mapped.originalError = error;
  mapped.response = error?.response || error?.originalError?.response || null;
  return mapped;
};

export const salesCloudCancellationService = {
  async canCancelCloudSale(sale = {}, licenseDetails = null) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    return Boolean(
      context.online &&
      context.licenseKey &&
      context.runtimeCancellationEnabled &&
      isCloudSalesCancellationEnabled(details) &&
      isCloudCommittedSale(sale) &&
      !isCloudSaleCancelled(sale)
    );
  },

  async previewCloudSaleCancellation({ sale = {}, saleId = null, reason = '' } = {}) {
    const context = await getRuntimeContext();
    const cloudSaleId = saleId || getCloudSaleId(sale);

    if (!isCloudCommittedSale(sale)) throw friendlyCloudCancellationError(new Error('SALE_NOT_CLOUD_COMMITTED'));
    if (!context.online) throw friendlyCloudCancellationError(new Error('OFFLINE'));
    if (!context.licenseKey || !context.featureEnabled) throw friendlyCloudCancellationError(new Error('CLOUD_SALES_CANCELLATIONS_DISABLED'));
    if (!cloudSaleId) throw friendlyCloudCancellationError(new Error('SALE_NOT_FOUND'));

    try {
      const preview = await salesCloudRepository.previewCloudSaleCancellation({
        licenseKey: context.licenseKey,
        saleId: cloudSaleId,
        reason: String(reason || '').trim() || null
      });

      return {
        ...preview,
        runtimeCancellationEnabled: context.runtimeCancellationEnabled,
        licenseCancellationEnabled: context.featureEnabled
      };
    } catch (error) {
      Logger.error('[SalesCloud/Cancellation] Preview de cancelacion cloud fallo:', error);
      throw friendlyCloudCancellationError(error);
    }
  },

  async validateCloudSaleIntegrity({ sale = {}, saleId = null } = {}) {
    const context = await getRuntimeContext();
    const cloudSaleId = saleId || getCloudSaleId(sale);

    if (!context.online) throw friendlyCloudCancellationError(new Error('OFFLINE'));
    if (!context.licenseKey) throw friendlyCloudCancellationError(new Error('CLOUD_SALES_CANCELLATIONS_DISABLED'));
    if (!cloudSaleId) throw friendlyCloudCancellationError(new Error('SALE_NOT_FOUND'));

    return salesCloudRepository.validateCloudSaleIntegrity({
      licenseKey: context.licenseKey,
      saleId: cloudSaleId
    });
  },

  async cancelCloudSale({ sale = {}, saleId = null, reason = '' } = {}) {
    const context = await getRuntimeContext();
    const cloudSaleId = saleId || getCloudSaleId(sale);
    const trimmedReason = String(reason || '').trim();

    if (!isCloudCommittedSale(sale)) throw friendlyCloudCancellationError(new Error('SALE_NOT_CLOUD_COMMITTED'));
    if (isCloudSaleCancelled(sale)) throw friendlyCloudCancellationError(new Error('SALE_ALREADY_CANCELLED'));
    if (!context.online) throw friendlyCloudCancellationError(new Error('OFFLINE'));
    if (!context.licenseKey || !context.featureEnabled) throw friendlyCloudCancellationError(new Error('CLOUD_SALES_CANCELLATIONS_DISABLED'));
    if (!trimmedReason) throw friendlyCloudCancellationError(new Error('CLOUD_SALE_CANCELLATION_REASON_REQUIRED'));
    if (!cloudSaleId) throw friendlyCloudCancellationError(new Error('SALE_NOT_FOUND'));

    const idempotencyKey = buildCancellationIdempotencyKey({ saleId: cloudSaleId, deviceId: context.deviceId });

    try {
      const preview = await salesCloudRepository.previewCloudSaleCancellation({
        licenseKey: context.licenseKey,
        saleId: cloudSaleId,
        reason: trimmedReason
      });

      if (preview?.success === false || preview?.can_cancel === false) {
        throw buildPreviewBlockedError({
          ...preview,
          runtimeCancellationEnabled: context.runtimeCancellationEnabled,
          licenseCancellationEnabled: context.featureEnabled
        });
      }

      if (!context.runtimeCancellationEnabled) {
        const error = new Error('CLOUD_SALE_CANCELLATIONS_RUNTIME_DISABLED');
        error.code = 'CLOUD_SALE_CANCELLATIONS_RUNTIME_DISABLED';
        error.response = preview;
        throw error;
      }

      const response = await salesCloudRepository.cancelCloudSale({
        licenseKey: context.licenseKey,
        saleId: cloudSaleId,
        reason: trimmedReason,
        idempotencyKey
      });

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CLOUD_SALE_CANCELLATION_FAILED');
        error.code = response.code;
        error.response = response;
        throw error;
      }

      let integrity = null;
      try {
        integrity = await salesCloudRepository.validateCloudSaleIntegrity({
          licenseKey: context.licenseKey,
          saleId: cloudSaleId
        });
        if (integrity?.is_valid === false) {
          Logger.warn('[SalesCloud/Cancellation] Diagnostico post-cancelacion con issues:', integrity);
        }
      } catch (integrityError) {
        Logger.warn('[SalesCloud/Cancellation] No se pudo ejecutar diagnostico post-cancelacion:', integrityError);
      }

      const responseWithIntegrity = integrity ? { ...response, integrity } : response;
      const patch = mapCancellationResponseToLocalPatch(responseWithIntegrity);
      const localSale = await saveCancellationPatch({ localSale: sale, response: responseWithIntegrity, patch });
      dispatchCancellationEvents();
      return { success: true, code: 'CLOUD_CANCELLED', sale: localSale || { ...sale, ...patch }, response: responseWithIntegrity, preview, integrity, idempotencyKey };
    } catch (error) {
      Logger.error('[SalesCloud/Cancellation] Cancelacion cloud no aplicada:', error);
      throw friendlyCloudCancellationError(error);
    }
  }
};

export default salesCloudCancellationService;
