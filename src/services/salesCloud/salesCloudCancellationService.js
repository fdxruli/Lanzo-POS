import Logger from '../Logger';
import { getStableDeviceId } from '../supabase';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails, isCloudSalesCancellationEnabled } from '../sync/syncConstants';
import { salesCloudRepository } from './salesCloudRepository';
import { salesCloudLocalRepository } from './salesCloudLocalRepository';
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

const getRuntimeContext = async () => {
  const licenseDetails = useAppStore.getState()?.licenseDetails || null;
  return {
    licenseDetails,
    licenseKey: getLicenseKeyFromDetails(licenseDetails),
    deviceId: await getStableDeviceId().catch(() => 'device'),
    online: isOnline(),
    featureEnabled: isCloudSalesCancellationEnabled(licenseDetails)
  };
};

const friendlyCloudCancellationError = (error) => {
  const raw = String(error?.message || error?.code || error || '');
  const code = raw.match(/[A-Z0-9_]+(?::[a-z_]+)?/)?.[0] || raw;
  const messages = {
    OFFLINE: 'Esta venta fue registrada en la nube. Para cancelarla se necesita conexion.',
    CLOUD_SALES_CANCELLATIONS_DISABLED: 'Las cancelaciones cloud aun no estan activas para esta licencia.',
    CLOUD_SALE_CANCELLATION_REASON_REQUIRED: 'Indica el motivo de cancelacion para dejar auditoria.',
    SALE_ALREADY_CANCELLED: 'La venta ya fue cancelada anteriormente.',
    SALE_NOT_FOUND: 'No se encontro la venta en la nube. Actualiza el historial e intenta de nuevo.',
    SALE_NOT_CLOUD_COMMITTED: 'Esta venta no fue confirmada en la nube; se debe usar la cancelacion local.',
    SALE_NOT_CLOSED: 'Solo se pueden cancelar ventas cerradas.',
    SALE_CANCELLATION_FORBIDDEN: 'No tienes permiso para cancelar esta venta.',
    IDEMPOTENCY_PROCESSING: 'La cancelacion ya esta en proceso. Evita presionar dos veces.',
    CUSTOMER_DEBT_NEGATIVE_AFTER_CANCEL: 'No se cancelo la venta porque la deuda quedaria inconsistente. Revisa abonos posteriores antes de cancelar.',
    CASH_SESSION_NOT_FOUND: 'No se encontro la caja original de la venta. No se aplico ningun cambio para evitar descuadres.',
    PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE: 'No se encontro el producto cloud para devolver inventario. No se aplico ningun cambio.',
    CLOUD_BATCH_NOT_AVAILABLE: 'No se encontro el lote cloud para devolver inventario. No se aplico ningun cambio.'
  };
  const mapped = new Error(messages[code] || raw || 'No se pudo cancelar la venta. No se aplico ningun cambio para evitar descuadres.');
  mapped.code = code === 'SALE_ALREADY_CANCELLED' ? 'ALREADY_CANCELLED' : code;
  mapped.originalCode = code;
  mapped.originalError = error;
  return mapped;
};

export const salesCloudCancellationService = {
  async canCancelCloudSale(sale = {}, licenseDetails = null) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    return Boolean(
      context.online &&
      context.licenseKey &&
      isCloudSalesCancellationEnabled(details) &&
      isCloudCommittedSale(sale) &&
      !isCloudSaleCancelled(sale)
    );
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

      const patch = mapCancellationResponseToLocalPatch(response);
      const localSale = await salesCloudLocalRepository.applyCloudCancellationPayload({ localSale: sale, response, patch });
      dispatchCancellationEvents();
      return { success: true, code: 'CLOUD_CANCELLED', sale: localSale || { ...sale, ...patch }, response, idempotencyKey };
    } catch (error) {
      Logger.error('[SalesCloud/Cancellation] Cancelacion cloud no aplicada:', error);
      throw friendlyCloudCancellationError(error);
    }
  }
};

export default salesCloudCancellationService;
