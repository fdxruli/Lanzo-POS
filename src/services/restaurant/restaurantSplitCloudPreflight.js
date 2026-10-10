import { Money } from '../../utils/moneyMath';
import { buildRestaurantOrderPayloadFromOpenSale } from './restaurantOrderMapper';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { verifyRestaurantTableAuthority } from './restaurantTableAuthority';
import { isRestaurantTableInScope } from './restaurantActiveTables';
import {
  hasInvalidRestaurantSplitCommercialSnapshot,
  stableRestaurantSplitCommercialStringify
} from './restaurantSplitCommercialSnapshot';

const OPERATIONAL_ORDER_STATUSES = new Set(['pending', 'preparing', 'ready', 'delivered']);
const OPERATIONAL_ITEM_STATUSES = new Set(['pending', 'preparing', 'ready', 'delivered']);

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const hasValue = (value) => (
  (typeof value === 'number' || typeof value === 'string')
  && !(typeof value === 'string' && value.trim() === '')
  && Number.isFinite(Number(value))
);
const isPresent = (value) => value !== null && value !== undefined;
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const normalizeStatus = (value) => text(value).toLowerCase();

const toMoneyCents = (value) => {
  if (!hasValue(value)) return null;
  try {
    const cents = Money.init(value).times(100);
    if (!cents.eq(cents.round(0))) return null;
    const result = Number(cents.toString());
    return Number.isSafeInteger(result) ? result : null;
  } catch {
    return null;
  }
};

const toQuantity = (value) => {
  if (!hasValue(value)) return null;
  try {
    return Money.toExactString(value);
  } catch {
    return null;
  }
};

const invalid = (code, message) => ({ success: false, code, errorType: code, message });

const validFinancialField = (source, keys) => keys.some((key) => hasValue(source?.[key]));
const financialAliasesAgree = (source, keys) => {
  const values = keys.filter((key) => hasOwn(source, key)).map((key) => toMoneyCents(source[key]));
  return values.every((value) => value !== null) && (values.length < 2 || values.every((value) => value === values[0]));
};

const hasMeaningfulDiscount = (value) => {
  if (value === null || value === undefined || value === '') return false;
  if (isRecord(value)) return true;
  const cents = toMoneyCents(value);
  return cents === null || cents !== 0;
};

const lineHasDiscountEvidence = (item) => (
  hasMeaningfulDiscount(item?.discount)
  || ['discountAmount', 'discount_amount'].some((key) => hasMeaningfulDiscount(item?.[key]))
  || Boolean(text(item?.discountReason ?? item?.discount_reason))
);

const orderHasDiscountEvidence = (sale) => (
  hasMeaningfulDiscount(sale?.saleDiscount)
  || hasMeaningfulDiscount(sale?.sale_discount)
  || hasMeaningfulDiscount(sale?.metadata?.discount)
  || hasMeaningfulDiscount(sale?.discount)
  || ['discountTotal', 'discount_total', 'saleDiscountAmount', 'sale_discount_amount']
    .some((key) => hasMeaningfulDiscount(sale?.[key]))
  || sale.items.some(lineHasDiscountEvidence)
);

const localSnapshotIsComplete = (sale, payload) => {
  if (!isRecord(sale) || !Array.isArray(sale.items) || !sale.items.length) return false;
  if (!hasValue(sale.total)) return false;
  if (hasOwn(sale, 'subtotal') && !hasValue(sale.subtotal)) return false;
  const discountTotalKeys = ['discountTotal', 'discount_total'];
  const hasDiscountTotalField = discountTotalKeys.some((key) => hasOwn(sale, key));
  if (hasDiscountTotalField && !validFinancialField(sale, discountTotalKeys)) return false;
  if (!financialAliasesAgree(sale, discountTotalKeys)) return false;
  if (hasInvalidRestaurantSplitCommercialSnapshot(payload.order?.metadata?.restaurantSplitCommercialSnapshot)) return false;

  if (!sale.items.every((item) => hasValue(item?.quantity))) return false;
  const sellableItems = sale.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number(item.quantity) > 0);
  if (!sellableItems.length || payload.items.length !== sellableItems.length) return false;

  const completeLines = sellableItems.every(({ item, index }) => {
    const unitPricePresent = validFinancialField(item, ['unitPrice', 'unit_price', 'price']);
    const lineTotalKeys = ['lineTotal', 'line_total'];
    const lineTotalPresent = validFinancialField(item, lineTotalKeys);
    const hasLineTotalField = lineTotalKeys.some((key) => hasOwn(item, key));
    const discountAmountKeys = ['discountAmount', 'discount_amount'];
    const discountAmountPresent = validFinancialField(item, discountAmountKeys);
    const hasDiscountAmountField = discountAmountKeys.some((key) => hasOwn(item, key));
    const hasLineDiscount = lineHasDiscountEvidence(item);
    const quantityPresent = hasValue(item.quantity) && Number(item.quantity) > 0;
    const productId = text(item.productId || item.id);
    const lineId = text(
      item.lineId || item.cartLineId || item.cartItemId || item.orderItemId || item.uniqueLineId || item.localLineId
    ) || `${sale.id}_${index}`;
    const expectedItem = payload.items.find((candidate) => candidate.localLineId === lineId);
    const snapshot = expectedItem?.metadata?.restaurantSplitCommercialSnapshot;
    const canDeriveLineTotal = !hasLineTotalField
      && !hasLineDiscount
      && !(Array.isArray(item.selectedModifiers) && item.selectedModifiers.length > 0);
    return Boolean(
      quantityPresent
      && unitPricePresent
      && financialAliasesAgree(item, ['unitPrice', 'unit_price', 'price'])
      && financialAliasesAgree(item, lineTotalKeys)
      && financialAliasesAgree(item, discountAmountKeys)
      && (lineTotalPresent || canDeriveLineTotal)
      && !(hasLineTotalField && !lineTotalPresent)
      && (discountAmountPresent || (!hasDiscountAmountField && !hasLineDiscount))
      && productId
      && lineId
      && expectedItem
      && snapshot
      && !hasInvalidRestaurantSplitCommercialSnapshot(snapshot)
    );
  });
  if (!completeLines) return false;

  const needsFinancialDerivation = !hasOwn(sale, 'subtotal') || !hasDiscountTotalField;
  if (needsFinancialDerivation) {
    if (orderHasDiscountEvidence(sale)) return false;
    const lineTotalCents = payload.items.reduce((sum, item) => {
      const amount = toMoneyCents(item.lineTotal);
      return amount === null ? null : (sum === null ? null : sum + amount);
    }, 0);
    const orderTotalCents = toMoneyCents(sale.total);
    if (lineTotalCents === null || orderTotalCents === null || lineTotalCents !== orderTotalCents) return false;
  }

  return true;
};

const validTimestampToken = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value === value.trim()
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)
  && !Number.isNaN(Date.parse(value))
);

// Date.parse drops fractional precision beyond milliseconds. Keep it when
// rejecting older Cloud snapshots; the original token still goes to SQL.
const timestampRank = (value) => {
  const fraction = value.match(/\.(\d+)(?:[zZ]|[+-]\d{2}:\d{2})$/)?.[1] || '';
  return BigInt(Math.floor(Date.parse(value) / 1000)) * 1000000000n
    + BigInt(fraction.padEnd(9, '0').slice(0, 9));
};

const compareLine = (expected, actual) => {
  const expectedModifiers = expected.selectedModifiers;
  const actualModifiers = actual.selectedModifiers ?? actual.selected_modifiers;
  const expectedSnapshot = expected.metadata?.restaurantSplitCommercialSnapshot;
  const actualSnapshot = actual.metadata?.restaurantSplitCommercialSnapshot;

  if (!text(actual.localLineId ?? actual.local_line_id)) return false;
  if (text(expected.localLineId) !== text(actual.localLineId ?? actual.local_line_id)) return false;
  if (!text(actual.productId ?? actual.product_id)) return false;
  if (text(expected.productId) !== text(actual.productId ?? actual.product_id)) return false;

  const expectedQuantity = toQuantity(expected.quantity);
  const actualQuantity = toQuantity(actual.quantity);
  const expectedUnitPrice = toMoneyCents(expected.unitPrice);
  const actualUnitPrice = toMoneyCents(actual.unitPrice ?? actual.unit_price);
  const expectedLineTotal = toMoneyCents(expected.lineTotal);
  const actualLineTotal = toMoneyCents(actual.lineTotal ?? actual.line_total);
  if ([expectedQuantity, actualQuantity, expectedUnitPrice, actualUnitPrice, expectedLineTotal, actualLineTotal].includes(null)) return false;
  if (expectedQuantity !== actualQuantity || expectedUnitPrice !== actualUnitPrice || expectedLineTotal !== actualLineTotal) return false;

  if (!Array.isArray(actualModifiers)) return false;
  if (stableRestaurantSplitCommercialStringify(expectedModifiers) !== stableRestaurantSplitCommercialStringify(actualModifiers)) return false;
  if (!isRecord(actualSnapshot) || actualSnapshot.version !== expectedSnapshot?.version) return false;
  return stableRestaurantSplitCommercialStringify(expectedSnapshot) === stableRestaurantSplitCommercialStringify(actualSnapshot);
};

const compareCommercialSnapshot = (sale, order) => {
  if (!isRecord(order) || !isRecord(order.metadata)) return false;
  if (!text(order.id)) return false;
  if (!text(order.localOrderId ?? order.local_order_id) || text(order.localOrderId ?? order.local_order_id) !== text(sale.id)) return false;
  if (!text(order.saleId ?? order.sale_id) || text(order.saleId ?? order.sale_id) !== text(sale.id)) return false;

  const expectedPayload = buildRestaurantOrderPayloadFromOpenSale({ sale });
  if (!localSnapshotIsComplete(sale, expectedPayload)) return false;

  const expectedOrderSnapshot = expectedPayload.order.metadata.restaurantSplitCommercialSnapshot;
  const actualOrderSnapshot = order.metadata.restaurantSplitCommercialSnapshot;
  if (!isRecord(actualOrderSnapshot) || actualOrderSnapshot.version !== expectedOrderSnapshot.version) return false;
  if (hasInvalidRestaurantSplitCommercialSnapshot(actualOrderSnapshot)) return false;
  if (stableRestaurantSplitCommercialStringify(expectedOrderSnapshot) !== stableRestaurantSplitCommercialStringify(actualOrderSnapshot)) return false;

  const expectedCurrency = text(expectedPayload.order.currency).toUpperCase();
  const actualCurrency = text(order.currency).toUpperCase();
  if (!expectedCurrency || !actualCurrency || expectedCurrency !== actualCurrency) return false;

  for (const field of ['subtotal', 'total']) {
    const expectedAmount = toMoneyCents(expectedPayload.order[field]);
    const actualAmount = toMoneyCents(order[field]);
    if (expectedAmount === null || actualAmount === null || expectedAmount !== actualAmount) return false;
  }

  if (!Array.isArray(order.items) || order.items.length !== expectedPayload.items.length) return false;
  const expectedByLineId = new Map();
  for (const item of expectedPayload.items) {
    const key = text(item.localLineId);
    if (!key || expectedByLineId.has(key)) return false;
    expectedByLineId.set(key, item);
  }

  const actualByLineId = new Map();
  for (const item of order.items) {
    if (!isRecord(item)) return false;
    const key = text(item.localLineId ?? item.local_line_id);
    if (!key || actualByLineId.has(key)) return false;
    actualByLineId.set(key, item);
  }

  if (actualByLineId.size !== expectedByLineId.size) return false;
  for (const [lineId, expected] of expectedByLineId) {
    const actual = actualByLineId.get(lineId);
    if (!actual || !compareLine(expected, actual)) return false;
  }
  return true;
};

export const preflightCloudRestaurantOrderSettlement = async ({
  licenseKey,
  parentOrderId,
  parentSale,
  settlementTotal,
  actorHandle = null,
  permission,
  operation = 'checkout',
  repository = restaurantOrdersRepository
} = {}) => {
  actorHandle?.assertCurrent(permission);
  if (!licenseKey || !parentOrderId || !parentSale?.id || text(parentSale.id) !== text(parentOrderId)) {
    return invalid(
      'RESTAURANT_ORDER_PREFLIGHT_FAILED',
      'No se pudo identificar la mesa para verificarla en la nube. No se realizó el cobro.'
    );
  }

  let response;
  try {
    response = await repository.getRestaurantOrderByLocalOrder({
      licenseKey,
      localOrderId: parentOrderId,
      force: true
    });
  } catch {
    return invalid(
      'RESTAURANT_ORDER_PREFLIGHT_FAILED',
      'No se pudo verificar la comanda cloud actual. Revisa la conexión y los permisos; no se realizó el cobro.'
    );
  }

  if (response?.success !== true || response?.found !== true || !isRecord(response.order)) {
    return invalid(
      'RESTAURANT_ORDER_PREFLIGHT_FAILED',
      'No se pudo confirmar la comanda cloud actual. Revisa la conexión y los permisos; no se realizó el cobro.'
    );
  }

  const order = response.order;
  actorHandle?.assertCurrent(permission);
  const cloudId = parentSale.cloudRestaurantOrderId || parentSale.restaurantOrderId;
  if ((cloudId && text(cloudId) !== text(order.id))
    || !isRestaurantTableInScope(parentSale, licenseKey, actorHandle?.tenant?.opaqueId)
    || !isRestaurantTableInScope(order, licenseKey, actorHandle?.tenant?.opaqueId)
    || parentSale.status !== 'open'
    || parentSale.restaurantCloudTerminalState === 'terminal') {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'No se pudo verificar la identidad o autoridad de la mesa. Actualiza la cuenta.');
  }
  const orderStatus = normalizeStatus(order.status);
  if (orderStatus === 'cancelled' || isPresent(order.cancelledAt) || isPresent(order.cancelled_at)) {
    return invalid('RESTAURANT_ORDER_ALREADY_CANCELLED', 'La mesa cloud está cancelada. Actualiza la mesa antes de cobrar.');
  }
  if (!OPERATIONAL_ORDER_STATUSES.has(orderStatus)) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'El estado cloud de la mesa no permite verificar el cobro. Actualiza la mesa.');
  }
  const fulfillmentStatus = normalizeStatus(order.fulfillmentStatus ?? order.fulfillment_status);
  if (!OPERATIONAL_ORDER_STATUSES.has(fulfillmentStatus)) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'El estado de entrega cloud no permite verificar el cobro. Actualiza la mesa.');
  }

  const paymentStatus = normalizeStatus(order.paymentStatus ?? order.payment_status);
  if (paymentStatus === 'paid' || isPresent(order.paidAt) || isPresent(order.paid_at)
    || isPresent(order.paidSaleId) || isPresent(order.paid_sale_id)) {
    return invalid('RESTAURANT_ORDER_ALREADY_PAID', 'La comanda cloud ya fue pagada. Actualiza las mesas antes de continuar.');
  }
  if (paymentStatus !== 'unpaid' || isPresent(order.paidAt) || isPresent(order.paid_at)) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'El estado de pago cloud no permite confirmar este split. Actualiza la mesa.');
  }
  if (isPresent(order.archivedAt) || isPresent(order.archived_at) || isPresent(order.checkoutClosedAt) || isPresent(order.checkout_closed_at)
    || isPresent(order.deletedAt) || isPresent(order.deleted_at) || order.metadata?.archived === true
    || order.metadata?.cancelledFromPos === true) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'La comanda cloud ya está cerrada o archivada. Actualiza las mesas.');
  }

  if (!Array.isArray(order.items)) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'La lectura cloud no incluyó las líneas necesarias para verificar la cuenta. No se realizó el cobro.');
  }
  for (const item of order.items) {
    const itemStatus = normalizeStatus(item?.status);
    if (itemStatus === 'cancelled' || isPresent(item?.cancelledAt) || isPresent(item?.cancelled_at)) {
      return invalid('RESTAURANT_ORDER_ITEM_CANCELLED', 'Un producto de la mesa se canceló en cocina. Actualiza la mesa antes de dividirla.');
    }
    if (!OPERATIONAL_ITEM_STATUSES.has(itemStatus)) {
      return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'El estado de una línea cloud no permite verificar el cobro. Actualiza la mesa.');
    }
  }

  if (!compareCommercialSnapshot(parentSale, order)
    || (settlementTotal !== undefined && (toMoneyCents(settlementTotal) === null
      || toMoneyCents(settlementTotal) !== toMoneyCents(order.total)))) {
    return invalid(
      'RESTAURANT_ORDER_COMMERCIAL_CONFLICT',
      'Los productos, cantidades, precios, descuentos o importes de la mesa cambiaron o no pudieron verificarse. Actualiza la mesa y vuelve a dividirla.'
    );
  }

  const updatedAt = order.updatedAt ?? order.updated_at;
  if (!validTimestampToken(updatedAt)) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'La comanda cloud no devolvió una versión válida. No se realizó el cobro.');
  }
  const knownVersions = [parentSale.restaurantCloudExpectedVersion, parentSale.cloudRestaurantOrderUpdatedAt, parentSale.cloudUpdatedAt];
  if (knownVersions.some((version) => validTimestampToken(version) && timestampRank(version) > timestampRank(updatedAt))
    || (hasValue(parentSale.cloudRestaurantOrderServerVersion)
      && hasValue(order.serverVersion ?? order.server_version)
      && Number(order.serverVersion ?? order.server_version) < Number(parentSale.cloudRestaurantOrderServerVersion))) {
    return invalid('RESTAURANT_ORDER_PREFLIGHT_FAILED', 'No se pudo confirmar una versión vigente de la mesa. Actualiza la cuenta.');
  }

  let authority;
  try {
    authority = await verifyRestaurantTableAuthority({ licenseKey, order: parentSale, operation,
      ...(actorHandle ? { actorHandle } : {}), repository });
  } catch (error) {
    return invalid(error.code || 'RESTAURANT_TABLE_AUTHORITY_UNCONFIRMED', error.message);
  }
  if (authority.parentVersion !== updatedAt || text(authority.cloudOrderId) !== text(order.id)) {
    return invalid('RESTAURANT_ORDER_VERSION_CONFLICT', 'La mesa cambió durante la verificación. Actualízala antes de continuar.');
  }
  return {
    success: true,
    commercialEquivalent: true,
    parentExpectedVersion: updatedAt,
    cloudOrderId: order.id,
    source: 'restaurant_order_cloud_preflight'
  };
};

export const preflightCloudRestaurantOrderSplit = preflightCloudRestaurantOrderSettlement;

export default preflightCloudRestaurantOrderSettlement;
