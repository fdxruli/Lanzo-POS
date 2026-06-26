import Logger from '../Logger';
import { getStableDeviceId } from '../supabase';
import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudSalesCashierEnabled,
  isCloudSalesCreditEnabled,
  isCloudSalesInventoryEnabled
} from '../sync/syncConstants';
import { pullCatalogChanges } from '../products/productSyncHandler';
import { salesCloudRepository } from './salesCloudRepository';
import { salesCloudLocalRepository } from './salesCloudLocalRepository';
import {
  isCloudCashierCompatiblePayment,
  isCreditLikePaymentMethod,
  mapLocalCheckoutToCloudSale,
  mapLocalCreditCheckoutToCloudSale
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
    creditFeatureEnabled: Boolean(licenseKey && isCloudSalesCreditEnabled(licenseDetails)),
    inventoryFeatureEnabled: Boolean(licenseKey && isCloudSalesInventoryEnabled(licenseDetails)),
    experimentalEnabled: isExperimentalFlagEnabled()
  };
};

const friendlyCloudCashierError = (error) => {
  const raw = String(error?.message || error?.code || error || '');
  const code = raw.match(/[A-Z0-9_]+(?::[a-z_]+)?/)?.[0] || raw;

  const messages = {
    CLOUD_CASH_SESSION_REQUIRED: 'Para recibir abono inicial en efectivo necesitas abrir caja primero.',
    CASH_SESSION_NOT_FOUND: 'No se encontró la caja seleccionada. Abre tu caja e intenta de nuevo.',
    CASH_SESSION_NOT_OPEN: 'La caja seleccionada ya no está abierta. Revisa Caja e intenta de nuevo.',
    CASH_SESSION_FORBIDDEN: 'Esta caja pertenece a otro usuario o dispositivo.',
    SALE_CREDIT_NOT_IMPLEMENTED_IN_6B: 'La venta fiada seguirá en modo local por ahora. Crédito cloud se activará en Fase 6D.',
    SALE_PAYMENT_TOTAL_MISMATCH: 'Los pagos no cuadran con el total de la venta. Revisa el cobro antes de intentarlo de nuevo.',
    INITIAL_PAYMENT_TOTAL_MISMATCH: 'El abono inicial no cuadra con el total capturado. Revisa el pago antes de confirmar.',
    INITIAL_PAYMENT_DETAIL_REQUIRED: 'Para registrar un abono inicial debes indicar si fue efectivo, tarjeta o transferencia.',
    INITIAL_PAYMENT_EXCEEDS_TOTAL: 'El abono inicial no puede ser mayor al total de la venta.',
    CREDIT_SALE_BALANCE_REQUIRED: 'La venta fiada necesita saldo pendiente mayor a cero.',
    CREDIT_SALE_BALANCE_MISMATCH: 'El abono y el saldo pendiente no cuadran con el total de la venta.',
    CREDIT_SALE_CUSTOMER_REQUIRED: 'Para vender fiado en cloud necesitas seleccionar un cliente sincronizado.',
    CUSTOMER_NOT_FOUND: 'No se encontró el cliente en la nube. Sincroniza el cliente antes de vender fiado.',
    CUSTOMER_DELETED: 'Este cliente ya no está activo en la nube. No se registró la venta para evitar deuda incorrecta.',
    CUSTOMER_DEBT_RECALC_MISMATCH: 'No se pudo registrar la deuda del cliente. La venta no fue confirmada para evitar duplicados.',
    IDEMPOTENCY_PROCESSING: 'La venta ya está en proceso. Evita presionar cobrar otra vez.',
    CLOUD_SALES_CASHIER_DISABLED: 'Venta cloud con caja aún no está activa para esta licencia.',
    CLOUD_SALES_CREDIT_DISABLED: 'Venta fiada cloud aún no está activa para esta licencia.',
    CLOUD_SALES_INVENTORY_DISABLED: 'Venta cloud con inventario aún no está activa para esta licencia.',
    POS_SYNC_AUTH_CONTEXT_INCOMPLETE: 'No se pudo validar la licencia de este dispositivo. Revisa conexión y licencia.',
    OFFLINE: 'No hay conexión. La venta fiada cloud necesita internet para proteger deuda, caja e inventario.',
    INSUFFICIENT_CLOUD_STOCK: 'No hay suficiente stock en la nube para completar esta venta fiada. No se creó deuda.',
    PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE: 'Este producto aún no está listo para venta cloud. Sincroniza el catálogo antes de vender fiado.',
    CLOUD_PRODUCT_NOT_AVAILABLE: 'Este producto no está activo en la nube. Revisa el catálogo antes de venderlo.',
    CLOUD_BATCH_NOT_AVAILABLE: 'El lote seleccionado no está disponible en la nube. Actualiza lotes e intenta de nuevo.',
    CLOUD_BATCH_ALLOCATION_MISMATCH: 'Las cantidades por lote no cuadran con la cantidad vendida. Revisa el producto e intenta de nuevo.',
    SALE_CREDIT_DUPLICATE_OR_CONFLICT: 'La venta fiada ya fue registrada o hay un conflicto de folio. Actualiza ventas antes de reintentar.'
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
    const creditLike = isCreditLikePaymentMethod(paymentData.paymentMethod || paymentData.method);

    if (!context.experimentalEnabled) return { useCloud: false, reason: 'experimental_flag_disabled' };
    if (!context.licenseKey || !isCloudSalesCashierEnabled(details)) return { useCloud: false, reason: 'feature_disabled' };
    if (!Array.isArray(cart) || cart.length === 0) return { useCloud: false, reason: 'empty_cart' };

    if (creditLike) {
      if (!isCloudSalesCreditEnabled(details)) return { useCloud: false, reason: 'cloud_credit_feature_disabled' };

      return {
        useCloud: true,
        reason: context.online ? 'cloud_sales_credit_enabled' : 'cloud_sales_credit_offline_block',
        mode: context.inventoryFeatureEnabled ? 'cloud_credit_inventory' : 'cloud_credit',
        context
      };
    }

    if (!context.online) return { useCloud: false, reason: 'offline_local_shadow' };
    if (!isCloudCashierCompatiblePayment(paymentData)) return { useCloud: false, reason: 'payment_not_compatible' };

    return {
      useCloud: true,
      reason: context.inventoryFeatureEnabled ? 'cloud_cashier_inventory_enabled' : 'cloud_cashier_enabled',
      mode: context.inventoryFeatureEnabled ? 'cloud_cashier_inventory' : 'cloud_cashier',
      context
    };
  },

  async processCloudCashierSale({ sale, processedItems = [], paymentData = {}, total, licenseDetails = null } = {}) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    const creditSale = isCreditLikePaymentMethod(paymentData.paymentMethod || sale?.paymentMethod || sale?.payment_method);
    const inventoryEnabled = isCloudSalesInventoryEnabled(details);

    if (!context.online) throw friendlyCloudCashierError(new Error('OFFLINE'));

    if (creditSale) {
      if (!context.experimentalEnabled || !context.licenseKey || !isCloudSalesCreditEnabled(details)) {
        throw friendlyCloudCashierError(new Error('CLOUD_SALES_CREDIT_DISABLED'));
      }
    } else if (!context.experimentalEnabled || !context.licenseKey || !isCloudSalesCashierEnabled(details)) {
      throw friendlyCloudCashierError(new Error('CLOUD_SALES_CASHIER_DISABLED'));
    }

    const payload = creditSale
      ? mapLocalCreditCheckoutToCloudSale({ sale, processedItems, paymentData, total, inventoryEnabled })
      : mapLocalCheckoutToCloudSale({ sale, processedItems, paymentData, total, inventoryEnabled });

    const idempotencyKey = `${payload.idempotencyKey}:${context.deviceId}`;

    try {
      const createSale = creditSale
        ? salesCloudRepository.createCloudCreditSale
        : (inventoryEnabled ? salesCloudRepository.createCloudCashierInventorySale : salesCloudRepository.createCloudCashierSale);

      const response = await createSale.call(salesCloudRepository, {
        licenseKey: context.licenseKey,
        ...payload,
        cashSessionId: paymentData.cashSessionId || paymentData.cash_session_id || null,
        customerId: payload.customerId || paymentData.customerId || sale?.customerId || null,
        idempotencyKey
      });

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CLOUD_CASHIER_SALE_FAILED');
        error.code = response.code;
        error.response = response;
        throw error;
      }

      const localSale = await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({
        localSale: {
          ...sale,
          items: processedItems,
          syncStatus: 'SYNCED',
          cloudSalesSyncStatus: 'synced',
          sourceMode: 'cloud_committed',
          effectsStatus: response.sale?.effects_status || (creditSale ? 'credit_applied' : 'payment_recorded'),
          inventoryEffectStatus: response.sale?.inventory_effect_status || (inventoryEnabled ? 'applied' : 'not_applied'),
          creditEffectStatus: response.sale?.credit_effect_status || (creditSale ? 'applied' : 'not_applied'),
          creditLedgerChargeId: response.sale?.credit_ledger_charge_id || response.ledger_charge?.id || null,
          creditLedgerPaymentId: response.sale?.credit_ledger_payment_id || response.ledger_payment?.id || null,
          customerLedgerId: response.sale?.customer_ledger_id || response.ledger_charge?.id || null
        },
        response
      });

      await salesCloudLocalRepository.applyCloudSalesPayload(response);

      if (inventoryEnabled && ['applied', 'not_required'].includes(response.sale?.inventory_effect_status)) {
        pullCatalogChanges(context.licenseKey).catch((pullError) => {
          Logger.warn('[SalesCloud/Cashier] No se pudo refrescar catalogo tras venta cloud inventory:', pullError);
        });
      }

      return { success: true, response, localSale, payload, idempotencyKey, inventoryEnabled, creditSale };
    } catch (error) {
      Logger.error('[SalesCloud/Cashier] Venta cloud no confirmada:', error);
      throw friendlyCloudCashierError(error);
    }
  }
};

export default salesCloudCashierService;
