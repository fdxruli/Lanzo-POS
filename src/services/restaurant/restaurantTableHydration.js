import { db, STORES } from '../db/dexie';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { Money } from '../../utils/moneyMath';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { getRestaurantCloudTableState, isRestaurantTableInScope } from './restaurantActiveTables';
import { preflightCloudRestaurantOrderSplit } from './restaurantSplitCloudPreflight';
import {
  buildRestaurantOrderCommercialSnapshot,
  buildRestaurantOrderLineCommercialSnapshot,
  hasInvalidRestaurantSplitCommercialSnapshot
} from './restaurantSplitCommercialSnapshot';

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const numberPresent = (value) => ['number', 'string'].includes(typeof value)
  && text(value) !== '' && Number.isFinite(Number(value));
const moneyAliasesAgree = (source, keys) => {
  const values = keys.filter((key) => hasOwn(source, key)).map((key) => source[key]);
  return values.length > 0 && values.every(numberPresent)
    && values.every((value) => Money.toCents(value) === Money.toCents(values[0]));
};
const failure = (code, message, localOrderId) => ({ success: false, code, message, localOrderId });
const incomplete = (localOrderId) => failure(
  'CLOUD_TABLE_SNAPSHOT_INCOMPLETE',
  'Esta mesa necesita actualizarse antes de poder cargarse en este dispositivo.',
  localOrderId
);

// Snapshot money stays an exact decimal string for comparisons and preflight.
const restoreMoneyForSnapshotComparison = (field) => {
  if (!Number.isSafeInteger(field.value)) throw new Error('INCOMPLETE_SNAPSHOT');
  return Money.toExactString(Money.fromCents(field.value));
};

// The POS cart contract consumes item.price as a number (for example, OrderSummary
// calls toFixed on it). Convert only that operational field at the UI boundary.
const restoreMoneyForLocalPosField = (field) => {
  if (!Number.isSafeInteger(field.value)) throw new Error('INCOMPLETE_SNAPSHOT');
  return Money.toNumber(Money.fromCents(field.value));
};

// Commercial snapshots record absence separately from null and zero. Rebuild
// only their original fields; adding price aliases changes split authority.
const restoreScalar = (field, kind = 'raw') => {
  if (!isRecord(field)) throw new Error('INCOMPLETE_SNAPSHOT');
  if (field.state === 'absent') return { present: false };
  if (field.state === 'null') return { present: true, value: null };
  if (field.state !== 'value') throw new Error('INCOMPLETE_SNAPSHOT');
  if (kind === 'money') {
    return { present: true, value: restoreMoneyForSnapshotComparison(field) };
  }
  return { present: true, value: field.value };
};

const restoreFields = (target, fields, expectedKeys, kind = 'raw') => {
  if (!isRecord(fields)) throw new Error('INCOMPLETE_SNAPSHOT');
  for (const key of expectedKeys) {
    const decoded = restoreScalar(fields[key], kind);
    if (decoded.present) target[key] = decoded.value;
  }
};

const restoreDiscount = (discount) => {
  if (!isRecord(discount)) throw new Error('INCOMPLETE_SNAPSHOT');
  if (discount.state === 'absent' || discount.state === 'null') return restoreScalar(discount);
  if (discount.state === 'scalar') return restoreScalar(discount.value, 'money');
  if (discount.state !== 'object' || !isRecord(discount.fields)) throw new Error('INCOMPLETE_SNAPSHOT');
  const value = {};
  restoreFields(value, discount.fields, ['type', 'scope', 'reason']);
  restoreFields(value, discount.fields, ['amount'], 'money');
  restoreFields(value, discount.fields, ['value'], value.type === 'amount' ? 'money' : 'raw');
  return { present: true, value };
};

const assignDiscount = (target, key, snapshot) => {
  const restored = restoreDiscount(snapshot);
  if (restored.present) target[key] = restored.value;
};

const ORDER_FIELDS = Object.keys(buildRestaurantOrderCommercialSnapshot().amounts);
const LINE_TEMPLATE = buildRestaurantOrderLineCommercialSnapshot();
const LINE_FIELDS = Object.keys(LINE_TEMPLATE.amounts);
const VARIANT_FIELDS = Object.keys(LINE_TEMPLATE.variants);
const ADJUSTMENT_FIELDS = ['taxTotal', 'tax_total', 'taxAmount', 'tax_amount', 'deliveryFee', 'delivery_fee',
  'serviceFee', 'service_fee', 'tipAmount', 'tip_amount', 'roundingAdjustment', 'rounding_adjustment'];

const unadjustedTotalIsConsistent = (sale) => {
  // The snapshot does not define whether tax or fees are inclusive. Keep those
  // explicit cloud totals intact; only check the unambiguous gross-discount case.
  const hasAdjustment = (source, keys) => keys.some((key) => hasOwn(source, key)
    && (!numberPresent(source[key]) || Money.toCents(source[key]) !== 0));
  if (hasAdjustment(sale, ADJUSTMENT_FIELDS)
    || sale.items.some((item) => hasAdjustment(item, ['tax', 'taxAmount', 'tax_amount',
      'splitRoundingAdjustment', 'split_rounding_adjustment']))) return true;
  const discount = sale.discountTotal ?? sale.discount_total;
  if (!numberPresent(sale.subtotal) || !numberPresent(discount)) return true;
  return Money.toCents(sale.total) === Money.toCents(sale.subtotal) - Money.toCents(discount);
};

const saleFromCloudSnapshot = (order, localOrderId, licenseKey, actorHandle) => {
  const snapshot = order.metadata?.restaurantSplitCommercialSnapshot;
  if (!isRecord(snapshot) || snapshot.version !== 1 || hasInvalidRestaurantSplitCommercialSnapshot(snapshot)) {
    throw new Error('INCOMPLETE_SNAPSHOT');
  }
  if (!Array.isArray(order.items) || !order.items.length
    || !numberPresent(order.subtotal) || !numberPresent(order.total)
    || Number(order.subtotal) < 0 || Number(order.total) < 0
    || !text(order.currency)) throw new Error('INCOMPLETE_SNAPSHOT');

  const sale = {
    id: localOrderId,
    localOrderId,
    status: 'open',
    orderType: 'table',
    fulfillmentStatus: order.fulfillmentStatus ?? order.fulfillment_status,
    tableData: order.tableLabel ?? order.table_label ?? null,
    customerId: order.customerId ?? order.customer_id ?? null,
    customerName: order.customerName ?? order.customer_name ?? null,
    notes: order.notes ?? null,
    total: order.total,
    timestamp: order.createdAt ?? order.created_at ?? order.updatedAt ?? order.updated_at,
    createdAt: order.createdAt ?? order.created_at ?? order.updatedAt ?? order.updated_at,
    updatedAt: order.updatedAt ?? order.updated_at,
    cloudUpdatedAt: order.updatedAt ?? order.updated_at,
    restaurantCloudExpectedVersion: order.updatedAt ?? order.updated_at,
    restaurantOrderId: order.id,
    cloudOrderId: order.id,
    cloudRestaurantOrderId: order.id,
    restaurantCloudHydrated: true,
    reservationAuthority: 'cloud',
    syncStatus: 'synced',
    licenseKey,
    tenantOpaqueId: actorHandle.tenant.opaqueId,
    restaurantCloudLicenseKey: licenseKey,
    restaurantCloudTenantId: actorHandle.tenant.opaqueId,
    actorKey: actorHandle.actorKey,
    deviceId: actorHandle.deviceRef ?? null,
    staffUserId: actorHandle.actorType === 'staff' ? actorHandle.actorId : null,
    metadata: {
      ...order.metadata,
      restaurantCloudHydration: {
        cloudOrderId: order.id,
        actorKey: actorHandle.actorKey,
        actorSessionId: actorHandle.sessionId,
        actorGeneration: actorHandle.generation,
        tenantOpaqueId: actorHandle.tenant.opaqueId,
        tenantDatabaseName: actorHandle.tenant.databaseName,
        tenantGeneration: actorHandle.tenant.generation
      }
    }
  };
  if (hasOwn(order, 'serverVersion')) sale.serverVersion = order.serverVersion;
  else if (hasOwn(order, 'server_version')) sale.serverVersion = order.server_version;
  if (hasOwn(sale, 'serverVersion')) sale.cloudRestaurantOrderServerVersion = sale.serverVersion;
  restoreFields(sale, snapshot, ['currency']);
  restoreFields(sale, snapshot.amounts, ORDER_FIELDS, 'money');
  assignDiscount(sale, 'saleDiscount', snapshot.saleDiscounts?.saleDiscount);
  assignDiscount(sale, 'sale_discount', snapshot.saleDiscounts?.sale_discount);
  assignDiscount(sale, 'discount', snapshot.saleDiscounts?.legacyDiscount);
  assignDiscount(sale.metadata, 'discount', snapshot.saleDiscounts?.metadataDiscount);

  sale.items = order.items.map((item) => {
    const commercial = item?.metadata?.restaurantSplitCommercialSnapshot;
    const productId = text(item?.productId ?? item?.product_id);
    const localLineId = text(item?.localLineId ?? item?.local_line_id);
    if (!productId || !localLineId || !isRecord(commercial) || commercial.version !== 1
      || hasInvalidRestaurantSplitCommercialSnapshot(commercial)
      || !numberPresent(item.quantity) || Number(item.quantity) <= 0
      || !moneyAliasesAgree(item, ['unitPrice', 'unit_price'])
      || !numberPresent(item.unitPrice ?? item.unit_price) || Number(item.unitPrice ?? item.unit_price) < 0
      || !moneyAliasesAgree(item, ['lineTotal', 'line_total'])
      || !numberPresent(item.lineTotal ?? item.line_total) || Number(item.lineTotal ?? item.line_total) < 0
      || !Array.isArray(item.selectedModifiers ?? item.selected_modifiers)
      || commercial.amounts?.price?.state !== 'value') throw new Error('INCOMPLETE_SNAPSHOT');
    const line = {
      id: productId,
      productId,
      lineId: localLineId,
      localLineId,
      name: item.productName ?? item.product_name,
      productName: item.productName ?? item.product_name,
      notes: item.notes ?? null,
      printStation: item.stationCode ?? item.station_code,
      printStationName: item.stationName ?? item.station_name,
      metadata: item.metadata
    };
    restoreFields(line, commercial.amounts, LINE_FIELDS, 'money');
    line.price = restoreMoneyForLocalPosField(commercial.amounts.price);
    restoreFields(line, commercial.quantities, ['quantity']);
    restoreFields(line, commercial.variants, VARIANT_FIELDS);
    assignDiscount(line, 'discount', commercial.discounts?.discount);
    restoreFields(line, commercial.discounts, ['discountAmount', 'discount_amount'], 'money');
    restoreFields(line, commercial.discounts, ['discountReason', 'discount_reason']);
    const modifiers = restoreScalar(commercial.selectedModifiers);
    if (modifiers.present) line.selectedModifiers = modifiers.value === null
      ? null : (item.selectedModifiers ?? item.selected_modifiers);
    return line;
  });
  return sale;
};

const isShadow = (sale) => sale?.restaurantCloudHydrated === true || sale?.reservationAuthority === 'cloud';
const isLocallyMarkedTerminal = (sale) => sale?.restaurantCloudTerminalState === 'terminal';
const localTerminalFailure = (sale, localOrderId) => failure('CLOUD_TABLE_TERMINAL',
  text(sale.restaurantCloudTerminalPaymentStatus).toLowerCase() === 'paid'
    ? 'La mesa ya fue cobrada.'
    : 'La mesa cloud ya está cerrada. Actualiza las mesas antes de continuar.', localOrderId);
const isDirty = (sale) => sale?.isDirty === true || sale?.dirty === true
  || (sale?.syncStatus && !['synced', 'clean'].includes(sale.syncStatus))
  || sale?.isLockedForCheckout === true || sale?.tableTabCleanup?.status === 'pending';

// Date.parse truncates submillisecond digits. Compare their suffix separately
// so concurrent refreshes cannot replace a newer microsecond cloud revision.
const isOlderCloudTimestamp = (incoming, current) => {
  const incomingTime = Date.parse(incoming);
  const currentTime = Date.parse(current);
  if (!Number.isFinite(incomingTime) || !Number.isFinite(currentTime)) return false;
  if (incomingTime !== currentTime) return incomingTime < currentTime;
  const fraction = (value) => String(value).match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1]?.slice(3) || '';
  const incomingFraction = fraction(incoming);
  const currentFraction = fraction(current);
  const precision = Math.max(incomingFraction.length, currentFraction.length);
  return incomingFraction.padEnd(precision, '0') < currentFraction.padEnd(precision, '0');
};

export const hydrateRestaurantCloudOrderToLocalOpenSale = async ({
  licenseKey,
  localOrderId,
  expectedCloudOrderId = null,
  actorHandle = null,
  repository = restaurantOrdersRepository,
  database = db
} = {}) => {
  const id = text(localOrderId);
  if (!licenseKey || !id) return incomplete(id);
  let handle;
  try {
    handle = actorHandle || actorRuntimeController.capture();
    handle.assertCurrent();
    if (!handle.tenant?.opaqueId || !handle.tenant?.databaseName) return failure(
      'ACTOR_TENANT_NOT_READY', 'No se pudo confirmar el negocio activo.', id
    );
    const response = await repository.getRestaurantOrderByLocalOrder({ licenseKey, localOrderId: id, force: true });
    handle.assertCurrent();
    if (response?.success !== true || response?.found !== true || !isRecord(response.order)) return failure(
      response?.code || 'CLOUD_TABLE_LOOKUP_FAILED',
      response?.message || 'No se pudo confirmar la mesa cloud actual. Revisa la conexión y vuelve a abrirla.', id
    );
    const order = response.order;
    if (!text(order.id) || text(order.localOrderId ?? order.local_order_id) !== id
      || text(order.saleId ?? order.sale_id) !== id
      || !isRestaurantTableInScope(order, licenseKey, handle.tenant.opaqueId)
      || (expectedCloudOrderId && text(order.id) !== text(expectedCloudOrderId))) return incomplete(id);
    const state = getRestaurantCloudTableState(order);
    if (state !== 'active') return failure(
      state === 'terminal' ? 'CLOUD_TABLE_TERMINAL' : 'CLOUD_TABLE_NOT_ACTIVE',
      text(order.paymentStatus ?? order.payment_status).toLowerCase() === 'paid'
        ? 'La mesa ya fue cobrada.'
        : (state === 'kitchen-cancelled' || text(order.status).toLowerCase() === 'cancelled'
          ? 'La mesa fue cancelada. Actualiza las mesas antes de continuar.'
          : 'La mesa cloud ya no está activa y pendiente de pago. Actualiza las mesas antes de continuar.'), id
    );

    const table = database.table(STORES.SALES);
    // Fetching is read-only. The transaction rechecks the durable record before
    // deciding whether a cloud shadow may be written.
    const existing = await table.get(id);
    handle.assertCurrent();
    if (isLocallyMarkedTerminal(existing)) return localTerminalFailure(existing, id);
    if (existing && (existing.status !== 'open' || isDirty(existing))) return failure(
      'CLOUD_TABLE_LOCAL_CONFLICT', 'La cuenta local cambió o ya está cerrada. Actualiza la mesa antes de continuar.', id
    );
    if (existing && !isShadow(existing)) return { success: true, localOrderId: id, sale: existing, hydrated: false };

    let sale;
    try {
      sale = saleFromCloudSnapshot(order, id, licenseKey, handle);
      if (!unadjustedTotalIsConsistent(sale)) return incomplete(id);
    } catch {
      return incomplete(id);
    }
    const preflight = await preflightCloudRestaurantOrderSplit({
      licenseKey, parentOrderId: id, parentSale: sale,
      repository: { getRestaurantOrderByLocalOrder: async () => response }
    });
    handle.assertCurrent();
    if (!preflight.success) return incomplete(id);

    const result = await database.transaction('rw', [table], async () => {
      handle.assertCurrent();
      const current = await table.get(id);
      handle.assertCurrent();
      if (isLocallyMarkedTerminal(current)) return localTerminalFailure(current, id);
      if (current && (current.status !== 'open' || isDirty(current))) return failure(
        'CLOUD_TABLE_LOCAL_CONFLICT', 'La cuenta local cambió o ya está cerrada. Actualiza la mesa antes de continuar.', id
      );
      if (current && !isShadow(current)) return { success: true, localOrderId: id, sale: current, hydrated: false };
      if (current && (current.tenantOpaqueId !== handle.tenant.opaqueId
        || current.restaurantCloudTenantId !== handle.tenant.opaqueId
        || current.restaurantCloudLicenseKey !== licenseKey
        || current.metadata?.restaurantCloudHydration?.tenantDatabaseName !== handle.tenant.databaseName
        || text(current.restaurantOrderId) !== text(order.id))) return failure(
        'CLOUD_TABLE_LOCAL_CONFLICT', 'No se pudo confirmar la autoridad de la cuenta local.', id
      );
      if (current && isOlderCloudTimestamp(sale.cloudUpdatedAt, current.cloudUpdatedAt)) return failure(
        'CLOUD_TABLE_STALE_SNAPSHOT', 'La mesa local tiene una versión cloud más reciente. Actualiza las mesas.', id
      );
      handle.assertCurrent();
      await table.put(sale);
      handle.assertCurrent();
      return { success: true, localOrderId: id, sale, hydrated: true };
    });
    handle.assertCurrent();
    return result;
  } catch (error) {
    return failure(error?.code || 'CLOUD_TABLE_HYDRATION_FAILED',
      'No se pudo abrir la mesa cloud de forma segura. Actualiza las mesas y vuelve a intentarlo.', id);
  }
};

export const hydrateRestaurantTableForCheckout = hydrateRestaurantCloudOrderToLocalOpenSale;
export default hydrateRestaurantCloudOrderToLocalOpenSale;
