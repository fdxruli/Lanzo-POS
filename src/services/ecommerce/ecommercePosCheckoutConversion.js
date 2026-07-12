export const ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION = 1;

export const ECOMMERCE_CONVERSION_STATUS = Object.freeze({
  IDLE: 'idle',
  VALIDATING: 'validating',
  PAYMENT_PENDING: 'payment_pending',
  PROCESSING_SALE: 'processing_sale',
  SALE_CREATED: 'sale_created',
  CONFIRMATION_PENDING: 'confirmation_pending',
  COMPLETED: 'completed',
  ERROR: 'error'
});

export const ECOMMERCE_CHECKOUT_CODE = Object.freeze({
  DRAFT_NOT_PREPARED: 'ECOMMERCE_DRAFT_NOT_PREPARED',
  CONTEXT_MISMATCH: 'ECOMMERCE_CONTEXT_MISMATCH',
  PERMISSION_DENIED: 'ECOMMERCE_PERMISSION_DENIED',
  INVENTORY_NOT_READY: 'ECOMMERCE_INVENTORY_NOT_READY',
  INVENTORY_STALE: 'ECOMMERCE_INVENTORY_STALE',
  PRODUCT_MISSING: 'ECOMMERCE_PRODUCT_MISSING',
  BATCH_MISSING: 'ECOMMERCE_BATCH_MISSING',
  TOTAL_MISMATCH: 'ECOMMERCE_TOTAL_MISMATCH',
  CONVERSION_IN_PROGRESS: 'ECOMMERCE_CONVERSION_IN_PROGRESS',
  ALREADY_CONVERTED: 'ECOMMERCE_ALREADY_CONVERTED',
  CLAIM_LOST: 'ECOMMERCE_CLAIM_LOST',
  REMOTE_CONTRACT_PENDING: 'ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING'
});

const MESSAGE_BY_CODE = Object.freeze({
  [ECOMMERCE_CHECKOUT_CODE.DRAFT_NOT_PREPARED]: 'Solo los pedidos preparados pueden cobrarse.',
  [ECOMMERCE_CHECKOUT_CODE.CONTEXT_MISMATCH]: 'Este pedido pertenece a otro contexto del Punto de Venta.',
  [ECOMMERCE_CHECKOUT_CODE.PERMISSION_DENIED]: 'No tienes permisos vigentes para cobrar este pedido.',
  [ECOMMERCE_CHECKOUT_CODE.INVENTORY_NOT_READY]: 'Resuelve el inventario antes de cobrar.',
  [ECOMMERCE_CHECKOUT_CODE.INVENTORY_STALE]: 'El inventario debe comprobarse nuevamente antes de cobrar.',
  [ECOMMERCE_CHECKOUT_CODE.PRODUCT_MISSING]: 'Uno o más productos ya no están disponibles en el catálogo local.',
  [ECOMMERCE_CHECKOUT_CODE.BATCH_MISSING]: 'Selecciona un lote vigente y suficiente antes de cobrar.',
  [ECOMMERCE_CHECKOUT_CODE.TOTAL_MISMATCH]: 'El total del pedido cambió y debe revisarse antes de cobrar.',
  [ECOMMERCE_CHECKOUT_CODE.CONVERSION_IN_PROGRESS]: 'Este pedido ya está siendo procesado.',
  [ECOMMERCE_CHECKOUT_CODE.ALREADY_CONVERTED]: 'Este pedido ya fue convertido en una venta.',
  [ECOMMERCE_CHECKOUT_CODE.CLAIM_LOST]: 'La reserva del pedido ya no pertenece a este dispositivo.',
  [ECOMMERCE_CHECKOUT_CODE.REMOTE_CONTRACT_PENDING]: 'El cobro seguirá bloqueado hasta que el contrato remoto de conversión sea aplicado y validado.'
});

const IN_PROGRESS_STATUSES = new Set([
  ECOMMERCE_CONVERSION_STATUS.VALIDATING,
  ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
  ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
  ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
  ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
]);

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toCents = (value) => Math.round((toFiniteNumber(value) + Number.EPSILON) * 100);
const fromCents = (value) => Number((value / 100).toFixed(2));

const getProductId = (item = {}) => item.parentId || item.id || null;
const getLineId = (item = {}, index = 0) => (
  item.lineId || item.uniqueLineId || item.ecommerceOrderItemId || `${getProductId(item) || 'item'}-${index}`
);

const isBatchResolution = (resolution = {}, item = {}) => (
  resolution.mode === 'batch'
  || item.batchManagement?.enabled === true
  || item.batch_management?.enabled === true
  || String(item.expirationMode || item.expiration_mode || '').trim().toLowerCase() === 'batch'
);

const buildBlocked = (code, details = null) => ({
  eligible: false,
  code,
  message: MESSAGE_BY_CODE[code] || 'Este pedido no se puede cobrar todavía.',
  ...(details ? { details } : {})
});

export const getEcommerceConversionKey = (orderId) => (
  orderId ? `ecommerce:${String(orderId).trim()}` : null
);

export const calculateEcommerceAcceptedTotals = (order = {}) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const lineSubtotalCents = items.reduce((sum, item) => {
    const quantity = toFiniteNumber(item?.quantity, Number.NaN);
    const unitPrice = toFiniteNumber(
      item?.ecommerceSnapshotPrice ?? item?.price,
      Number.NaN
    );
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return Number.NaN;
    }
    return sum + Math.round((quantity * unitPrice + Number.EPSILON) * 100);
  }, 0);

  const expectedSubtotalCents = toCents(order.expectedSubtotal);
  const deliveryFeeCents = toCents(order.expectedDeliveryFee);
  const discountTotalCents = toCents(order.expectedDiscountTotal);
  const taxTotalCents = toCents(order.expectedTaxTotal);
  const expectedTotalCents = toCents(order.expectedTotal);
  const composedTotalCents = expectedSubtotalCents
    - discountTotalCents
    + deliveryFeeCents
    + taxTotalCents;

  return {
    validLines: Number.isFinite(lineSubtotalCents),
    lineSubtotal: Number.isFinite(lineSubtotalCents) ? fromCents(lineSubtotalCents) : null,
    expectedSubtotal: fromCents(expectedSubtotalCents),
    deliveryFee: fromCents(deliveryFeeCents),
    discountTotal: fromCents(discountTotalCents),
    taxTotal: fromCents(taxTotalCents),
    expectedTotal: fromCents(expectedTotalCents),
    composedTotal: fromCents(composedTotalCents),
    subtotalMatches: Number.isFinite(lineSubtotalCents) && lineSubtotalCents === expectedSubtotalCents,
    totalMatches: composedTotalCents === expectedTotalCents,
    currency: String(order.currency || 'MXN').trim().toUpperCase()
  };
};

export function getEcommerceCheckoutEligibility(order, context = {}) {
  if (!order || order.origin !== 'ecommerce' || order.ecommerceDraftStatus !== 'prepared') {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.DRAFT_NOT_PREPARED);
  }

  const contextIdentity = context.contextIdentity || null;
  if (!contextIdentity || order.ecommerceLicenseIdentity !== contextIdentity) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.CONTEXT_MISMATCH);
  }

  if (context.permissionsAllowed !== true) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.PERMISSION_DENIED);
  }

  const conversionStatus = order.ecommerceConversionStatus || ECOMMERCE_CONVERSION_STATUS.IDLE;
  if (
    conversionStatus === ECOMMERCE_CONVERSION_STATUS.COMPLETED
    || order.ecommerceConvertedSaleId
    || context.existingSaleId
    || context.remoteConvertedSaleId
  ) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.ALREADY_CONVERTED, {
      saleId: order.ecommerceConvertedSaleId || context.existingSaleId || context.remoteConvertedSaleId || null
    });
  }

  if (IN_PROGRESS_STATUSES.has(conversionStatus) || context.conversionInProgress === true) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.CONVERSION_IN_PROGRESS);
  }

  if (context.claimOwned !== true) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.CLAIM_LOST);
  }

  if (
    toFiniteNumber(context.remoteContractVersion, 0)
    < ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION
  ) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.REMOTE_CONTRACT_PENDING);
  }

  if (order.ecommerceInventoryStatus !== 'ready') {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.INVENTORY_NOT_READY);
  }

  if (
    context.inventoryFresh === false
    || !order.ecommerceInventoryResolvedAt
    || toFiniteNumber(order.ecommerceInventoryResolutionVersion, 0) <= 0
  ) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.INVENTORY_STALE);
  }

  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.PRODUCT_MISSING);
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const productId = getProductId(item);
    const quantity = toFiniteNumber(item?.quantity, Number.NaN);
    const resolution = item?.inventoryResolution || {};

    if (!productId || item?.ecommerceProductMissing === true || !Number.isFinite(quantity) || quantity <= 0) {
      return buildBlocked(ECOMMERCE_CHECKOUT_CODE.PRODUCT_MISSING, { lineId: getLineId(item, index) });
    }

    if (item?.needsInventoryResolution !== false || resolution.status !== 'resolved') {
      return buildBlocked(ECOMMERCE_CHECKOUT_CODE.INVENTORY_NOT_READY, { lineId: getLineId(item, index) });
    }

    const requiredQuantity = toFiniteNumber(
      resolution.requiredInventoryQuantity ?? resolution.requestedQuantity,
      Number.NaN
    );
    if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
      return buildBlocked(ECOMMERCE_CHECKOUT_CODE.INVENTORY_STALE, { lineId: getLineId(item, index) });
    }

    if (isBatchResolution(resolution, item) && !(resolution.batchId || item.batchId)) {
      return buildBlocked(ECOMMERCE_CHECKOUT_CODE.BATCH_MISSING, { lineId: getLineId(item, index) });
    }
  }

  const totals = calculateEcommerceAcceptedTotals(order);
  if (!totals.validLines || !totals.subtotalMatches || !totals.totalMatches) {
    return buildBlocked(ECOMMERCE_CHECKOUT_CODE.TOTAL_MISMATCH, { totals });
  }

  return {
    eligible: true,
    conversionKey: getEcommerceConversionKey(order.ecommerceOrderId),
    totals
  };
}

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export function buildEcommerceCheckoutSnapshot(order, context = {}) {
  const eligibility = getEcommerceCheckoutEligibility(order, context);
  if (!eligibility.eligible) return eligibility;

  const lines = order.items.map((item, index) => {
    const resolution = item.inventoryResolution || {};
    const unitPriceSnapshot = toFiniteNumber(item.ecommerceSnapshotPrice ?? item.price);
    const quantity = toFiniteNumber(item.quantity);
    return {
      lineId: getLineId(item, index),
      ecommerceOrderItemId: item.ecommerceOrderItemId || null,
      productId: getProductId(item),
      quantity,
      unitPriceSnapshot,
      lineTotalSnapshot: fromCents(Math.round((quantity * unitPriceSnapshot + Number.EPSILON) * 100)),
      batchId: resolution.batchId || item.batchId || null,
      requiredInventoryQuantity: toFiniteNumber(
        resolution.requiredInventoryQuantity ?? resolution.requestedQuantity
      )
    };
  });

  const snapshot = {
    ecommerceOrderId: order.ecommerceOrderId,
    ecommerceOrderCode: order.ecommerceOrderCode || null,
    ecommerceClaimIdentity: context.claimIdentity || null,
    ecommerceLicenseIdentity: order.ecommerceLicenseIdentity,
    ecommerceActorIdentity: context.actorIdentity || null,
    ecommerceConversionKey: eligibility.conversionKey,
    orderRevision: toFiniteNumber(order.revision, 0),
    orderUpdatedAt: order.updatedAt || null,
    inventoryResolutionVersion: order.ecommerceInventoryResolutionVersion,
    inventoryResolvedAt: order.ecommerceInventoryResolvedAt,
    expectedSubtotal: eligibility.totals.expectedSubtotal,
    expectedDeliveryFee: eligibility.totals.deliveryFee,
    expectedDiscountTotal: eligibility.totals.discountTotal,
    expectedTaxTotal: eligibility.totals.taxTotal,
    expectedTotal: eligibility.totals.expectedTotal,
    currency: eligibility.totals.currency,
    lines
  };

  return { eligible: true, snapshot: deepFreeze(snapshot) };
}

export const createEcommerceConversionPatch = (status, values = {}, now = new Date()) => ({
  ecommerceConversionStatus: status,
  ...(status === ECOMMERCE_CONVERSION_STATUS.VALIDATING
    ? { ecommerceConversionStartedAt: values.ecommerceConversionStartedAt || now.toISOString() }
    : {}),
  ...(status === ECOMMERCE_CONVERSION_STATUS.COMPLETED
    ? { ecommerceConversionCompletedAt: values.ecommerceConversionCompletedAt || now.toISOString() }
    : {}),
  ...values
});

export const ecommercePosCheckoutConversionInternals = Object.freeze({
  MESSAGE_BY_CODE,
  IN_PROGRESS_STATUSES,
  getLineId,
  getProductId,
  isBatchResolution,
  toCents,
  fromCents
});
