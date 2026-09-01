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
import { registerFinancialProjectionHandler } from '../financial/financialProjectionRegistry';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { cashRepository } from '../cash/cashRepository';
import { layawayRepository } from '../db/layaways';
import {
  isCloudCashierCompatiblePayment,
  isCreditLikePaymentMethod,
  mapLocalCheckoutToCloudSale,
  mapLocalCreditCheckoutToCloudSale
} from './salesCloudCashierMapper';

const CLOUD_RECOVERY_PAGE_LIMIT = 500;
const CLOUD_RECOVERY_MAX_PAGES = 20;
const CLOUD_SALE_VERIFICATION_PENDING = 'ECOMMERCE_SALE_VERIFICATION_PENDING';

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
  const deviceId = await getStableDeviceId();
  if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    throw new Error('DEVICE_ID_REQUIRED');
  }

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

// Reuses the same committed-snapshot + payload projection sequence as normal
// execution.  It receives only durable request/response evidence and never
// invokes a financial RPC.
export const applySalesFinancialResponseProjection = async ({ operationType, requestPayload, responsePayload, intent, actorHandle }) => {
  actorHandle?.assertCurrent?.();
  const resolvedOperationType = operationType || intent?.operationType;
  const resolvedRequestPayload = requestPayload || intent?.requestPayload || {};
  const response = responsePayload || intent?.responsePayload || {};
  const inventoryEnabled = resolvedOperationType === 'sale.cashier_inventory';
  const creditSale = resolvedOperationType === 'sale.credit';
  const localSale = await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({
    localSale: {
      ...(resolvedRequestPayload.sale || {}),
      items: Array.isArray(resolvedRequestPayload.items) ? resolvedRequestPayload.items : [],
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
  actorHandle?.assertCurrent?.();
  const appliedPayload = await salesCloudLocalRepository.applyCloudSalesPayload(response);
  return { localSale, appliedPayload };
};

const localSaleSeedFromCloudRequest = ({ sale = {}, items = [], paymentData = {} } = {}) => ({
  ...sale,
  id: sale.id || sale.local_sale_id || sale.localSaleId || null,
  timestamp: sale.timestamp || sale.sold_at || sale.soldAt || null,
  soldAt: sale.soldAt || sale.sold_at || sale.timestamp || null,
  items: Array.isArray(items) ? items : [],
  paymentMethod: sale.paymentMethod || sale.payment_method || null,
  paymentStatus: sale.paymentStatus || sale.payment_status || null,
  customerId: sale.customerId || sale.customer_id || paymentData.customerId || null,
  customerName: sale.customerName || sale.customer_name || null,
  customerPhone: sale.customerPhone || sale.customer_phone || null,
  total: sale.total ?? null,
  abono: sale.abono ?? sale.amountPaid ?? sale.amount_paid ?? null,
  saldoPendiente: sale.saldoPendiente ?? sale.balanceDue ?? sale.balance_due ?? null
});

export const applySplitSalesFinancialResponseProjection = async ({ requestPayload, responsePayload, intent, actorHandle }) => {
  actorHandle?.assertCurrent?.();
  const request = requestPayload || intent?.requestPayload || {};
  const response = responsePayload || intent?.responsePayload || {};
  const requestChildren = Array.isArray(request.children) ? request.children : [];
  const responseChildren = Array.isArray(response.children) ? response.children : [];

  if (requestChildren.length < 2 || responseChildren.length !== requestChildren.length) {
    throw Object.assign(new Error('FINANCIAL_SPLIT_RESPONSE_INVALID'), { code: 'FINANCIAL_SPLIT_RESPONSE_INVALID' });
  }

  const localSales = [];
  const cloudSales = [];
  const cloudItems = [];
  const cloudPayments = [];

  for (let index = 0; index < requestChildren.length; index += 1) {
    const requestChild = requestChildren[index] || {};
    const responseChild = responseChildren[index] || {};
    const cloudSale = responseChild.sale || response.sales?.[index] || null;
    if (!cloudSale?.id) {
      throw Object.assign(new Error('FINANCIAL_SPLIT_RESPONSE_INVALID'), { code: 'FINANCIAL_SPLIT_RESPONSE_INVALID' });
    }

    const childItems = Array.isArray(responseChild.items)
      ? responseChild.items
      : (Array.isArray(response.items)
        ? response.items.filter((item) => item.sale_id === cloudSale.id || item.saleId === cloudSale.id)
        : []);
    const childPayments = Array.isArray(responseChild.payments)
      ? responseChild.payments
      : (Array.isArray(response.payments)
        ? response.payments.filter((payment) => payment.sale_id === cloudSale.id || payment.saleId === cloudSale.id)
        : []);
    const localItems = Array.isArray(requestChild.local_items)
      ? requestChild.local_items
      : (Array.isArray(requestChild.items) ? requestChild.items : []);
    const localPaymentData = requestChild.payment_data && typeof requestChild.payment_data === 'object'
      ? requestChild.payment_data
      : {};

    const localSale = await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({
      localSale: {
        ...localSaleSeedFromCloudRequest({
          sale: requestChild.sale || {},
          items: localItems,
          paymentData: localPaymentData
        }),
        splitGroupId: request.split_group_id || request.splitGroupId || null,
        splitParentId: request.parent_order_id || request.parentOrderId || null,
        splitLabel: requestChild.label || responseChild.label || null,
        sourceMode: 'cloud_committed',
        syncStatus: 'SYNCED'
      },
      response: {
        ...response,
        sale: cloudSale,
        items: childItems,
        payments: childPayments
      }
    });

    if (!localSale) {
      throw Object.assign(new Error('SALE_LOCAL_PROJECTION_FAILED'), { code: 'SALE_LOCAL_PROJECTION_FAILED' });
    }

    localSales.push(localSale);
    cloudSales.push(cloudSale);
    cloudItems.push(...childItems);
    cloudPayments.push(...childPayments);
  }

  actorHandle?.assertCurrent?.();
  const appliedPayload = await salesCloudLocalRepository.applyCloudSalesPayload({
    ...response,
    sales: cloudSales,
    items: cloudItems,
    payments: cloudPayments
  });
  const parentOrderId = request.parent_order_id || request.parentOrderId || null;
  const parent = await salesCloudLocalRepository.markLocalSplitParentSettled({
    parentOrderId,
    splitGroupId: request.split_group_id || request.splitGroupId || null,
    childSaleIds: localSales.map((sale) => sale.id)
  });

  actorHandle?.assertCurrent?.();
  return {
    localSales,
    localSale: localSales[0] || null,
    parent,
    appliedPayload
  };
};

export const applyLayawayFinancialResponseProjection = async ({ requestPayload, responsePayload, intent, actorHandle }) => {
  actorHandle?.assertCurrent?.();
  const request = requestPayload || intent?.requestPayload || {};
  const response = responsePayload || intent?.responsePayload || {};
  const layawayId = request.layaway_id || request.layawayId || null;
  const localItems = Array.isArray(request.local_items) ? request.local_items : (Array.isArray(request.items) ? request.items : []);
  const localSale = await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({
    localSale: {
      ...localSaleSeedFromCloudRequest({
        sale: request.sale || {},
        items: localItems,
        paymentData: {}
      }),
      isLayawayConversion: true,
      originalLayawayId: layawayId,
      sourceMode: 'cloud_committed',
      syncStatus: 'SYNCED'
    },
    response
  });

  if (!localSale) {
    throw Object.assign(new Error('SALE_LOCAL_PROJECTION_FAILED'), { code: 'SALE_LOCAL_PROJECTION_FAILED' });
  }

  actorHandle?.assertCurrent?.();
  const appliedPayload = await salesCloudLocalRepository.applyCloudSalesPayload(response);
  const conversion = layawayId
    ? await layawayRepository.convertToSale(layawayId)
    : null;

  actorHandle?.assertCurrent?.();
  return { localSale, conversion, appliedPayload };
};

['sale.cashier', 'sale.cashier_inventory', 'sale.credit'].forEach((operationType) => {
  registerFinancialProjectionHandler(operationType, applySalesFinancialResponseProjection);
});
registerFinancialProjectionHandler('sale.split', applySplitSalesFinancialResponseProjection);
registerFinancialProjectionHandler('sale.layaway_complete', applyLayawayFinancialResponseProjection);

const friendlyCloudCashierError = (error) => {
  const raw = String(error?.message || error?.code || error || '');
  const rawCode = String(error?.code || '').trim();
  const semanticCode = raw.match(/[A-Z0-9_]+(?::[a-z_]+)?/)?.[0] || '';
  const code = /^\d{5}$/.test(rawCode) ? rawCode : semanticCode || rawCode || raw;

  const messages = {
    CLOUD_CASH_SESSION_REQUIRED: 'Para recibir abono inicial en efectivo necesitas abrir caja primero.',
    CASH_SESSION_NOT_FOUND: 'No se encontró la caja seleccionada. Abre tu caja e intenta de nuevo.',
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
    FINANCIAL_RECOVERY_RECEIPT_PENDING: 'El cobro anterior todavía no tiene confirmación. Revisa el estado de la venta antes de volver a intentarlo.',
    FINANCIAL_RECOVERY_RECEIPT_UNAVAILABLE: 'No se pudo confirmar el cobro anterior. La venta permanece protegida; revisa tu conexión e inténtalo de nuevo.',
    FINANCIAL_RECOVERY_LEASE_HELD: 'Este cobro ya está siendo reintentado. Espera un momento y revisa el resultado.',
    CLOUD_SALES_CASHIER_DISABLED: 'Venta cloud con caja aún no está activa para esta licencia.',
    CLOUD_SALES_CREDIT_DISABLED: 'Venta fiada cloud aún no está activa para esta licencia.',
    CLOUD_SALES_INVENTORY_DISABLED: 'Venta cloud con inventario aún no está activa para esta licencia.',
    FINANCIAL_SPLIT_RESPONSE_INVALID: 'La respuesta cloud del cobro dividido no fue válida. La operación quedó protegida; revisa el estado antes de reintentar.',
    FINANCIAL_SPLIT_CONTRACT_INVALID: 'Los datos de la cuenta dividida no son válidos. Vuelve a abrir Separar pago y revisa los tickets.',
    FINANCIAL_SPLIT_CHILD_COUNT_INVALID: 'La cuenta dividida debe contener entre 2 y 8 tickets válidos.',
    FINANCIAL_SPLIT_CHILD_INVALID: 'Uno de los tickets de la cuenta dividida no es válido.',
    FINANCIAL_SPLIT_LABEL_DUPLICATE: 'Los tickets de la cuenta dividida deben tener nombres únicos.',
    FINANCIAL_SPLIT_SALE_ID_DUPLICATE: 'La cuenta dividida generó identificadores repetidos. Vuelve a abrir Separar pago.',
    RESTAURANT_ORDER_NOT_FOUND: 'No se encontró la comanda cloud de la mesa. Actualiza las mesas antes de cobrar.',
    RESTAURANT_ORDER_ALREADY_PAID: 'La comanda de esta mesa ya fue cobrada en otro dispositivo. Actualiza las mesas.',
    RESTAURANT_ORDER_ALREADY_CANCELLED: 'La comanda de esta mesa ya fue cerrada o cancelada. Actualiza las mesas.',
    RESTAURANT_SPLIT_TOTAL_MISMATCH: 'El total de los tickets no coincide con el total vigente de la comanda. Actualiza la mesa y vuelve a dividir.',
    RESTAURANT_ORDER_VERSION_CONFLICT: 'La mesa cambió en otro dispositivo. Actualiza la mesa y vuelve a dividirla para proteger el cobro.',
    SPLIT_ROUNDING_INVALID: 'El reparto cloud solo admite diferencias de centavos. Usa reparto manual o ajusta los productos antes de cobrar.',
    SPLIT_ROUNDING_MISMATCH: 'Los centavos distribuidos en la cuenta dividida no coinciden con el total. Vuelve a abrir Separar pago.',
    CASH_SESSION_STATION_MISMATCH: 'La caja abierta pertenece a otra estación. Selecciona la caja de este dispositivo.',
    CASH_SESSION_NOT_OPEN: 'No hay una caja abierta en esta estación. Abre Caja antes de dividir o cobrar.',
    LAYAWAY_NOT_FULLY_PAID: 'El apartado todavía no está liquidado en Caja cloud. No se entregó la mercancía.',
    LAYAWAY_PAYMENT_TOTAL_MISMATCH: 'Los abonos cloud del apartado no coinciden con su total. La entrega quedó protegida.',
    LAYAWAY_TOTAL_MISMATCH: 'Los artículos del apartado no coinciden con el importe de la entrega. La entrega quedó protegida.',
    LAYAWAY_ALREADY_CONVERTED_CLOUD: 'Este apartado ya fue convertido en una venta cloud con otro identificador. Revisa Ventas antes de reintentar.',
    CLOUD_LAYAWAY_COMPLETION_REQUIRED: 'Este apartado requiere entrega cloud. Verifica conexión, permisos y funciones cloud antes de reintentar.',
    FINANCIAL_LAYAWAY_PAYMENTS_INVALID: 'La entrega del apartado debe llevar un único comprobante de liquidación.',
    LAYAWAY_ITEMS_REQUIRED: 'El apartado no tiene artículos válidos para generar la venta de entrega.',
    SPLIT_PARENT_ID_REQUIRED: 'No se encontró la orden local de la mesa para proyectar el cobro.',
    SPLIT_PARENT_LOCAL_NOT_FOUND: 'La mesa cobrada cloud no existe ya en el almacenamiento local. Sincroniza y revisa Ventas.',
    'POS_PERMISSION_DENIED:customers': 'Tu perfil no tiene permiso para consultar clientes; un administrador debe habilitar customers para vender fiado.',
    POS_SYNC_AUTH_CONTEXT_INCOMPLETE: 'No se pudo validar la licencia de este dispositivo. Revisa conexión y licencia.',
    DEVICE_ID_REQUIRED: 'No se pudo identificar este dispositivo de forma segura. No se registró la venta cloud.',
    OFFLINE: 'Sin conexión. Esta venta cloud necesita internet para proteger caja, inventario y crédito.',
    INSUFFICIENT_CLOUD_STOCK: 'No hay suficiente stock en la nube para completar esta venta. No se creó el movimiento.',
    PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE: 'Este producto aún no está listo para venta cloud. Sincroniza el catálogo antes de venderlo.',
    CLOUD_PRODUCT_NOT_AVAILABLE: 'Este producto no está activo en la nube. Revisa el catálogo antes de venderlo.',
    CLOUD_BATCH_NOT_AVAILABLE: 'El lote seleccionado no está disponible en la nube. Actualiza lotes e intenta de nuevo.',
    CLOUD_BATCH_ALLOCATION_MISMATCH: 'Las cantidades por lote no cuadran con la cantidad vendida. Revisa el producto e intenta de nuevo.',
    SALE_PRICE_MISMATCH: 'El precio del producto cambió en el servidor. Actualiza el catálogo y revisa el carrito.',
    MANUAL_ITEM_PRICE_POLICY_REQUIRED: 'Este artículo no tiene una política de precio cloud segura y no se puede cobrar todavía.',
    DISCOUNT_PERMISSION_REQUIRED: 'Tu sesión no tiene permiso vigente para aplicar descuentos.',
    DISCOUNT_REASON_REQUIRED: 'El descuento necesita un motivo válido antes de confirmar la venta.',
    DISCOUNT_AMOUNT_INVALID: 'El descuento no puede superar el subtotal de la venta.',
    DISCOUNT_VALUE_INVALID: 'El valor del descuento no es válido.',
    DISCOUNT_PERCENT_INVALID: 'El porcentaje de descuento no puede superar el 100%.',
    SALE_ARITHMETIC_MISMATCH: 'Los importes de la venta no cuadran. Revisa precios, descuentos y pagos.',
    SALE_PAYMENT_ARITHMETIC_MISMATCH: 'Los importes recibidos y el cambio no cuadran con el pago.',
    '57014': 'El servidor tardó demasiado en responder. El cobro quedó protegido; verifica el estado antes de volver a intentarlo.',
    '55P03': 'La caja está ocupada por otra operación. Espera unos segundos y verifica el estado antes de volver a cobrar.',
    POS_OPERATIONAL_FOLIO_UNRESOLVED: 'No se pudo asignar el folio POS global. La venta no se registró; actualiza y vuelve a intentarlo.',
    SALE_PAYMENT_METHOD_MISMATCH: 'El método de pago no coincide con el desglose capturado.',
    SALE_TAX_SOURCE_UNRESOLVED: 'La venta contiene impuestos sin una fuente fiscal server-side configurada.',
    ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED: 'La conversión ecommerce ya no está reservada para este cobro.',
    ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH: 'El pedido ecommerce cambió. Actualiza el pedido antes de cobrarlo.',
    ECOMMERCE_TOTAL_MISMATCH: 'El total ecommerce no coincide con el pedido aceptado.',
    ECOMMERCE_DISCOUNT_NOT_IN_ORDER: 'El descuento de la línea no pertenece al pedido ecommerce aceptado.',
    ECOMMERCE_TAX_LINE_UNRESOLVED: 'El impuesto ecommerce no tiene un desglose de línea seguro.',
    IDEMPOTENCY_CONFLICT: 'La clave de cobro ya fue usada con datos distintos. No se repitió la venta.',
    FINANCIAL_REQUEST_HASH_INVALID: 'El intento anterior de esta venta tiene datos financieros distintos. No se repitió para evitar un cobro duplicado; verifica el estado antes de iniciar un cobro nuevo.',
    BATCH_SELECTION_REQUIRED: 'Selecciona un lote o variante vigente antes de cobrar.',
    BATCH_ALLOCATION_INVALID: 'Las asignaciones de lote no son válidas.',
    MODIFIER_NOT_AUTHORIZED: 'Una opción seleccionada ya no pertenece a la configuración vigente del producto.',
    MODIFIER_REQUIRED: 'Falta una opción obligatoria del producto.',
    MODIFIER_PRICE_INVALID: 'El precio de una opción del producto no es válido.',
    SALE_CREDIT_DUPLICATE_OR_CONFLICT: 'La venta fiada ya fue registrada o hay un conflicto de folio. Actualiza ventas antes de reintentar.',
    EXPIRED_BATCH_BLOCKED: 'Este lote ya está vencido y no puede venderse. Muévelo a merma o corrige la fecha si fue un error.',
    INSUFFICIENT_NON_EXPIRED_STOCK: 'No hay stock vigente suficiente para completar esta venta. Revisa los lotes vencidos en Caducidad.',
    STRICT_EXPIRY_REQUIRED: 'Este producto requiere fecha de caducidad por lote antes de poder venderse.'
  };

  const friendly = messages[code] || messages[raw] || raw || 'No se pudo confirmar la venta cloud.';
  const mapped = new Error(friendly);
  mapped.code = code;
  mapped.originalError = error;
  return mapped;
};

const getCloudSaleMetadata = (sale = {}) => (
  sale.metadata && typeof sale.metadata === 'object' ? sale.metadata : {}
);

const getEcommerceBusinessIdempotencyKey = (sale = {}) => {
  const metadata = getCloudSaleMetadata(sale);
  const key = metadata.ecommerceConversionKey || metadata.idempotencyKey || null;
  const isEcommerce = sale.origin === 'ecommerce'
    || metadata.origin === 'ecommerce'
    || Boolean(metadata.ecommerceOrderId);
  return isEcommerce && key ? String(key) : null;
};

const buildCloudSaleIdempotencyKey = ({ sale, payload, deviceId }) => (
  getEcommerceBusinessIdempotencyKey(sale)
  || `${payload.idempotencyKey}:${deviceId}`
);

const getCloudSaleConversionKey = (sale = {}) => {
  const metadata = getCloudSaleMetadata(sale);
  return sale.idempotency_key
    || sale.idempotencyKey
    || metadata.ecommerceConversionKey
    || metadata.idempotencyKey
    || null;
};

const matchesCommittedCloudSale = (sale = {}, { localSaleId, idempotencyKey }) => {
  const localId = sale.local_sale_id || sale.localSaleId || null;
  const conversionKey = getCloudSaleConversionKey(sale);
  return (
    (localSaleId && (localId === localSaleId || sale.id === localSaleId))
    || (idempotencyKey && conversionKey === idempotencyKey)
  );
};

const normalizeCloudSalesPayload = (payload = {}) => ({
  sales: Array.isArray(payload.sales) ? payload.sales : (payload.sale ? [payload.sale] : []),
  items: Array.isArray(payload.items) ? payload.items : [],
  payments: Array.isArray(payload.payments) ? payload.payments : []
});

const buildRecoveryDateFrom = (startedAt) => {
  const parsed = startedAt ? new Date(startedAt) : new Date();
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  safeDate.setHours(safeDate.getHours() - 24);
  return safeDate.toISOString();
};

const saveRecoveredCloudSale = async ({ localSaleId, idempotencyKey, payload, cloudSale }) => {
  const normalized = normalizeCloudSalesPayload(payload);
  const cloudSaleId = cloudSale.id;
  const items = normalized.items.filter((item) => (
    item.sale_id === cloudSaleId || item.saleId === cloudSaleId
  ));
  const payments = normalized.payments.filter((payment) => (
    payment.sale_id === cloudSaleId || payment.saleId === cloudSaleId
  ));
  const metadata = {
    ...getCloudSaleMetadata(cloudSale),
    origin: 'ecommerce',
    idempotencyKey,
    ecommerceConversionKey: idempotencyKey
  };
  const localSale = await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({
    localSale: {
      id: localSaleId,
      status: 'closed',
      sourceMode: 'cloud_committed',
      metadata
    },
    response: {
      ...payload,
      sale: { ...cloudSale, local_sale_id: localSaleId, metadata },
      items,
      payments
    }
  });

  if (!localSale) {
    const error = new Error('CLOUD_SALE_LOCAL_RECOVERY_FAILED');
    error.code = 'CLOUD_SALE_LOCAL_RECOVERY_FAILED';
    throw error;
  }
  return localSale;
};

const findAndRecoverCloudSale = async ({ localSaleId, idempotencyKey, startedAt, licenseKey }) => {
  let directPayload = null;
  try {
    directPayload = await salesCloudRepository.getSale({
      licenseKey,
      saleId: localSaleId,
      force: true
    });
    const direct = normalizeCloudSalesPayload(directPayload);
    const directSale = direct.sales.find((sale) => (
      matchesCommittedCloudSale(sale, { localSaleId, idempotencyKey })
    ));
    if (directSale) {
      const localSale = await saveRecoveredCloudSale({
        localSaleId,
        idempotencyKey,
        payload: directPayload,
        cloudSale: directSale
      });
      return { success: true, exists: true, saleId: localSale.id, cloudSaleId: directSale.id, localSale };
    }
  } catch (error) {
    Logger.warn('[SalesCloud/Cashier] Consulta directa de recuperación no concluyente:', error);
  }

  const dateFrom = buildRecoveryDateFrom(startedAt);
  let offset = 0;

  for (let page = 0; page < CLOUD_RECOVERY_MAX_PAGES; page += 1) {
    const payload = await salesCloudRepository.pullSalesSnapshot({
      licenseKey,
      limit: CLOUD_RECOVERY_PAGE_LIMIT,
      offset,
      dateFrom,
      dateTo: null,
      includeDeleted: true,
      force: true
    });
    if (payload?.success === false) {
      const error = new Error(payload.message || payload.code || 'CLOUD_SALE_VERIFICATION_FAILED');
      error.code = payload.code || 'CLOUD_SALE_VERIFICATION_FAILED';
      throw error;
    }

    const normalized = normalizeCloudSalesPayload(payload);
    const cloudSale = normalized.sales.find((sale) => (
      matchesCommittedCloudSale(sale, { localSaleId, idempotencyKey })
    ));
    if (cloudSale) {
      const localSale = await saveRecoveredCloudSale({
        localSaleId,
        idempotencyKey,
        payload,
        cloudSale
      });
      return { success: true, exists: true, saleId: localSale.id, cloudSaleId: cloudSale.id, localSale };
    }

    if (normalized.sales.length < CLOUD_RECOVERY_PAGE_LIMIT) {
      return { success: true, exists: false };
    }
    offset += CLOUD_RECOVERY_PAGE_LIMIT;
  }

  return {
    success: false,
    code: CLOUD_SALE_VERIFICATION_PENDING,
    message: 'La consulta cloud no pudo completarse dentro del límite seguro de paginación.'
  };
};

export const salesCloudCashierService = {
  async canUseCloudSplitTableSale({ tickets = [], licenseDetails = null } = {}) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    if (!context.online || !context.experimentalEnabled || !context.licenseKey || !isCloudSalesCashierEnabled(details)) {
      return false;
    }
    const hasCredit = (Array.isArray(tickets) ? tickets : []).some((ticket) => (
      isCreditLikePaymentMethod(ticket?.paymentData?.paymentMethod || ticket?.paymentData?.method)
    ));
    return !hasCredit || isCloudSalesCreditEnabled(details);
  },

  async canUseCloudLayawayCompletion(licenseDetails = null) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    return Boolean(
      context.online &&
      context.experimentalEnabled &&
      context.licenseKey &&
      isCloudSalesCashierEnabled(details)
    );
  },

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

    const cashierCompatible = isCloudCashierCompatiblePayment(paymentData);
    if (!cashierCompatible) return { useCloud: false, reason: 'payment_not_compatible' };

    if (!context.online) {
      return {
        useCloud: true,
        reason: 'cloud_cashier_offline_block',
        mode: context.inventoryFeatureEnabled ? 'cloud_cashier_inventory' : 'cloud_cashier',
        context
      };
    }

    return {
      useCloud: true,
      reason: context.inventoryFeatureEnabled ? 'cloud_cashier_inventory_enabled' : 'cloud_cashier_enabled',
      mode: context.inventoryFeatureEnabled ? 'cloud_cashier_inventory' : 'cloud_cashier',
      context
    };
  },

  async verifyCommittedSale({
    localSaleId,
    idempotencyKey,
    startedAt = null,
    licenseDetails = null
  } = {}) {
    if (!localSaleId || !idempotencyKey) {
      return {
        success: false,
        code: 'CLOUD_SALE_VERIFICATION_INVALID_ARGUMENT',
        message: 'Faltan identificadores estables para comprobar la venta cloud.'
      };
    }

    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    const licenseKey = getLicenseKeyFromDetails(details) || context.licenseKey;
    if (!licenseKey || !context.online) {
      return {
        success: false,
        code: CLOUD_SALE_VERIFICATION_PENDING,
        message: 'No se pudo consultar la venta cloud. El pedido permanece reservado.'
      };
    }

    try {
      return await findAndRecoverCloudSale({
        localSaleId,
        idempotencyKey,
        startedAt,
        licenseKey
      });
    } catch (error) {
      Logger.error('[SalesCloud/Cashier] No se pudo verificar la venta cloud:', error);
      return {
        success: false,
        code: CLOUD_SALE_VERIFICATION_PENDING,
        message: 'No se pudo confirmar todavía si la venta cloud fue registrada.',
        error
      };
    }
  },

  async processCloudSplitTableSale({
    parentOrderId,
    parentExpectedVersion = null,
    splitGroupId,
    childDefinitions = [],
    total,
    licenseDetails = null,
    cashSessionId = null
  } = {}) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    const hasCredit = childDefinitions.some((child) => (
      isCreditLikePaymentMethod(child?.paymentData?.paymentMethod || child?.paymentData?.method)
    ));

    if (!context.online) throw friendlyCloudCashierError(new Error('OFFLINE'));
    if (!context.experimentalEnabled || !context.licenseKey || !isCloudSalesCashierEnabled(details)) {
      throw friendlyCloudCashierError(new Error('CLOUD_SALES_CASHIER_DISABLED'));
    }
    if (hasCredit && !isCloudSalesCreditEnabled(details)) {
      throw friendlyCloudCashierError(new Error('CLOUD_SALES_CREDIT_DISABLED'));
    }
    if (!parentOrderId || !splitGroupId || !Array.isArray(childDefinitions) || childDefinitions.length < 2) {
      throw friendlyCloudCashierError(new Error('FINANCIAL_SPLIT_CONTRACT_INVALID'));
    }

    const actorHandle = actorRuntimeController.capture();

    try {
      const current = await cashRepository.getCurrentCashSession({ force: true });
      actorHandle.assertCurrent?.();
      const currentSession = current?.cashSession || null;
      if (current?.success === false || !currentSession || currentSession.estado !== 'abierta' || current.readOnly || current.stateKnown === false) {
        throw new Error('CASH_SESSION_NOT_OPEN');
      }
      const resolvedCashSessionId = cashSessionId || currentSession.id;
      if (!resolvedCashSessionId || String(resolvedCashSessionId) !== String(currentSession.id)) {
        throw new Error('CASH_SESSION_STATION_MISMATCH');
      }

      const inventoryEnabled = isCloudSalesInventoryEnabled(details);
      const children = childDefinitions.map((child) => {
        const paymentData = {
          ...(child.paymentData || {}),
          cashSessionId: resolvedCashSessionId
        };
        const credit = isCreditLikePaymentMethod(paymentData.paymentMethod || paymentData.method);
        const mapped = credit
          ? mapLocalCreditCheckoutToCloudSale({
            sale: child.sale,
            processedItems: child.processedItems || [],
            paymentData,
            total: child.sale?.total,
            inventoryEnabled
          })
          : mapLocalCheckoutToCloudSale({
            sale: child.sale,
            processedItems: child.processedItems || [],
            paymentData,
            total: child.sale?.total,
            inventoryEnabled
          });
        const mappedSale = {
          ...mapped.sale,
          metadata: {
            ...(mapped.sale?.metadata || {}),
            source: 'split_bill_child',
            splitGroupId,
            splitParentId: parentOrderId,
            splitLabel: child.label || null
          }
        };
        return {
          label: child.label,
          sale: mappedSale,
          items: mapped.items,
          payments: mapped.payments,
          customer_id: mapped.customerId || mappedSale.customer_id || child.paymentData?.customerId || null,
          local_items: child.processedItems || [],
          payment_data: paymentData
        };
      });

      const request = {
        parent_order_id: parentOrderId,
        parent_order_version: parentExpectedVersion || null,
        split_group_id: splitGroupId,
        cash_session_id: resolvedCashSessionId,
        children
      };
      const idempotencyKey = 'sales.cloud_split:' + splitGroupId;

      const response = await salesCloudRepository.createCloudSplitTableSale({
        licenseKey: context.licenseKey,
        split: request,
        cashSessionId: resolvedCashSessionId,
        idempotencyKey,
        actorHandle,
        project: applySplitSalesFinancialResponseProjection
      });

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CLOUD_SPLIT_FAILED');
        error.code = response.code;
        error.response = response;
        throw error;
      }

      const projection = response?.projection || null;
      if (projection?.outcome === 'projection_failed') {
        throw projection.error || Object.assign(new Error('SALE_LOCAL_PROJECTION_FAILED'), { code: 'SALE_LOCAL_PROJECTION_FAILED' });
      }

      if (inventoryEnabled && children.some((child) => child.sale?.metadata?.cloudInventoryEffects === true)) {
        pullCatalogChanges(context.licenseKey).catch((pullError) => {
          Logger.warn('[SalesCloud/Cashier] No se pudo refrescar catalogo tras split cloud inventory:', pullError);
        });
      }

      const projectedSales = projection?.result?.localSales || [];
      return {
        success: true,
        sourceMode: 'cloud_committed',
        cloudCommitted: true,
        parentOrderId,
        splitGroupId,
        childSaleIds: projectedSales.map((sale) => sale.id).filter(Boolean),
        childSales: projectedSales,
        total: total ?? response.total ?? null,
        response,
        projection,
        idempotencyKey,
        inventoryEnabled,
        creditSale: hasCredit,
        pendingSyncRequired: false
      };
    } catch (error) {
      Logger.error('[SalesCloud/Cashier] Split cloud no confirmado:', error);
      throw friendlyCloudCashierError(error);
    }
  },

  async processCloudLayawayCompletion({ request, licenseDetails = null } = {}) {
    const context = await getRuntimeContext();
    const details = licenseDetails || context.licenseDetails;
    if (!context.online) throw friendlyCloudCashierError(new Error('OFFLINE'));
    if (!context.experimentalEnabled || !context.licenseKey || !isCloudSalesCashierEnabled(details)) {
      throw friendlyCloudCashierError(new Error('CLOUD_SALES_CASHIER_DISABLED'));
    }

    const actorHandle = actorRuntimeController.capture();
    const idempotencyKey = 'sales.layaway_complete:' + (request?.layaway_id || request?.layawayId || 'unknown');

    try {
      const response = await salesCloudRepository.createCloudLayawayCompletion({
        licenseKey: context.licenseKey,
        request,
        idempotencyKey,
        actorHandle,
        project: applyLayawayFinancialResponseProjection
      });
      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CLOUD_LAYAWAY_COMPLETION_FAILED');
        error.code = response.code;
        error.response = response;
        throw error;
      }
      const projection = response?.projection || null;
      if (projection?.outcome === 'projection_failed') {
        throw projection.error || Object.assign(new Error('SALE_LOCAL_PROJECTION_FAILED'), { code: 'SALE_LOCAL_PROJECTION_FAILED' });
      }
      const localSale = projection?.result?.localSale || null;
      return {
        success: true,
        sourceMode: 'cloud_committed',
        cloudCommitted: true,
        saleId: localSale?.id || response.sale?.id || request?.sale?.id || null,
        cloudSaleId: response.sale?.id || null,
        folio: localSale?.folio || response.sale?.folio || null,
        posFolio: localSale?.posFolio || response.sale?.pos_folio || null,
        total: request?.sale?.total || response.sale?.total || null,
        response,
        projection,
        idempotencyKey,
        pendingSyncRequired: false
      };
    } catch (error) {
      Logger.error('[SalesCloud/Cashier] Layaway cloud no confirmado:', error);
      throw friendlyCloudCashierError(error);
    }
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

    const actorHandle = actorRuntimeController.capture();

    const payload = creditSale
      ? mapLocalCreditCheckoutToCloudSale({ sale, processedItems, paymentData, total, inventoryEnabled })
      : mapLocalCheckoutToCloudSale({ sale, processedItems, paymentData, total, inventoryEnabled });

    const idempotencyKey = buildCloudSaleIdempotencyKey({
      sale,
      payload,
      deviceId: context.deviceId
    });

    try {
      const createSale = creditSale
        ? salesCloudRepository.createCloudCreditSale
        : (inventoryEnabled ? salesCloudRepository.createCloudCashierInventorySale : salesCloudRepository.createCloudCashierSale);

      const response = await createSale.call(salesCloudRepository, {
        licenseKey: context.licenseKey,
        ...payload,
        cashSessionId: paymentData.cashSessionId || paymentData.cash_session_id || null,
        customerId: payload.customerId || paymentData.customerId || sale?.customerId || null,
        idempotencyKey,
        actorHandle,
        project: applySalesFinancialResponseProjection
      });

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CLOUD_CASHIER_SALE_FAILED');
        error.code = response.code;
        error.response = response;
        throw error;
      }

      const projection = response?.projection || null;
      if (projection?.outcome === 'projection_failed') {
        throw projection.error || Object.assign(new Error('SALE_LOCAL_PROJECTION_FAILED'), { code: 'SALE_LOCAL_PROJECTION_FAILED' });
      }
      const localSale = projection?.result?.localSale || null;

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

export const salesCloudCashierServiceInternals = Object.freeze({
  CLOUD_RECOVERY_PAGE_LIMIT,
  CLOUD_RECOVERY_MAX_PAGES,
  CLOUD_SALE_VERIFICATION_PENDING,
  getRuntimeContext,
  getEcommerceBusinessIdempotencyKey,
  buildCloudSaleIdempotencyKey,
  getCloudSaleConversionKey,
  matchesCommittedCloudSale,
  normalizeCloudSalesPayload,
  buildRecoveryDateFrom,
  saveRecoveredCloudSale,
  findAndRecoverCloudSale
});

export default salesCloudCashierService;
