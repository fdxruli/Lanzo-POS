import Logger from '../Logger';
import { getStableDeviceId } from '../supabase';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails, isCloudSalesCashierEnabled } from '../sync/syncConstants';
import { salesCloudRepository } from './salesCloudRepository';
import { salesCloudLocalRepository } from './salesCloudLocalRepository';
import {
  isCloudCashierCompatiblePayment,
  isCreditLikePaymentMethod,
  mapLocalCheckoutToCloudSale
} from './salesCloudCashierMapper';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const isExperimentalFlagEnabled = () => {
  try {
    return import.meta.env?.VITE_ENABLE_CLOUD_CASHIER_SALES === 'true';
  } catch {
    return false;
  }
};

const getRuntimeContext = async () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const deviceId = await getStableDeviceId().catch(() => 'device');

  return {
    licenseDetails,
    licenseKey,
    deviceId,
    online: isOnline(),
    featureEnabled: Boolean(licenseKey && isCloudSalesCashierEnabled(licenseDetails)),
    experimentalEnabled: isExperimentalFlagEnabled()
  };
};

const friendlyCloudCashierError = (error) => {
  const raw = String(error?.message || error?.code || error || '');
  const code = raw.match(/[A-Z0-9_]+(?::[a-z_]+)?/)?.[0] || raw;

  const messages = {
    CLOUD_CASH_SESSION_REQUIRED: 'Para cobrar esta venta en cloud necesitas abrir caja primero.',
    CASH_SESSION_NOT_OPEN: 'La caja seleccionada ya no está abierta. Revisa Caja e intenta de nuevo.',
    CASH_SESSION_FORBIDDEN: 'Esta caja pertenece a otro usuario o dispositivo.',
    SALE_CREDIT_NOT_IMPLEMENTED_IN_6B: 'La venta fiada seguirá en modo local por ahora. Crédito cloud se activará en Fase 6D.',
    SALE_PAYMENT_TOTAL_MISMATCH: 'Los pagos no cuadran con el total de la venta. Revisa el cobro antes de intentarlo de nuevo.',
    IDEMPOTENCY_PROCESSING: 'La venta ya está en proceso. Evita presionar cobrar otra vez.',
    CLOUD_SALES_CASHIER_DISABLED: 'Venta cloud con caja aún no está activa para esta licencia.',
    POS_SYNC_AUTH_CONTEXT_INCOMPLETE: 'No se pudo validar la licencia de este dispositivo. Revisa conexión y licencia.'
  };

  const friendly = messages[code] || messages[raw] || raw || 'No se pudo confirmar la venta cloud.';
  const mapped = new Error(friendly);
  mapped.code = code;
  mapped.originalError = error;
  return mapped;
};

export const salesCloudCashierService = {
  async canUseCloudCashierSale(licenseDetails = null) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    return Boolean(
      context.online &&
      context.experimentalEnabled &&
      context.licenseKey &&
      isCloudSalesCashierEnabled(details)
    );
  },

  async shouldUseCloudCashierSale({ paymentData = {}, cart = [], licenseDetails = null } = {}) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;

    if (!context.experimentalEnabled) return { useCloud: false, reason: 'experimental_flag_disabled' };
    if (!context.online) return { useCloud: false, reason: 'offline_local_shadow' };
    if (!context.licenseKey || !isCloudSalesCashierEnabled(details)) return { useCloud: false, reason: 'feature_disabled' };
    if (!Array.isArray(cart) || cart.length === 0) return { useCloud: false, reason: 'empty_cart' };
    if (isCreditLikePaymentMethod(paymentData.paymentMethod)) return { useCloud: false, reason: 'credit_deferred_to_6d' };
    if (!isCloudCashierCompatiblePayment(paymentData)) return { useCloud: false, reason: 'payment_not_compatible' };

    return { useCloud: true, reason: 'cloud_cashier_enabled', context };
  },

  async processCloudCashierSale({ sale, processedItems = [], paymentData = {}, total, licenseDetails = null } = {}) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;

    if (!context.online) throw friendlyCloudCashierError(new Error('OFFLINE'));
    if (!context.experimentalEnabled || !context.licenseKey || !isCloudSalesCashierEnabled(details)) {
      throw friendlyCloudCashierError(new Error('CLOUD_SALES_CASHIER_DISABLED'));
    }

    const payload = mapLocalCheckoutToCloudSale({ sale, processedItems, paymentData, total });
    const idempotencyKey = `${payload.idempotencyKey}:${context.deviceId}`;

    try {
      const response = await salesCloudRepository.createCloudCashierSale({
        licenseKey: context.licenseKey,
        ...payload,
        cashSessionId: paymentData.cashSessionId || paymentData.cash_session_id || null,
        idempotencyKey
      });

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CLOUD_CASHIER_SALE_FAILED');
        error.code = response.code;
        throw error;
      }

      const localSale = await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({
        localSale: {
          ...sale,
          items: processedItems,
          syncStatus: 'SYNCED',
          cloudSalesSyncStatus: 'synced',
          sourceMode: 'cloud_committed',
          effectsStatus: response.sale?.effects_status || 'payment_recorded'
        },
        response
      });

      await salesCloudLocalRepository.applyCloudSalesPayload(response);
      return { success: true, response, localSale, payload, idempotencyKey };
    } catch (error) {
      Logger.error('[SalesCloud/Cashier] Venta cloud no confirmada:', error);
      throw friendlyCloudCashierError(error);
    }
  }
};

export default salesCloudCashierService;
