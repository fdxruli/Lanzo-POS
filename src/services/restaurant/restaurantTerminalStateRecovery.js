import { db, STORES } from '../db/dexie';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { getRestaurantCloudTableState, isRestaurantTableInScope } from './restaurantActiveTables';

const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const present = (value) => value !== null && value !== undefined && text(value) !== '';
const normalize = (value) => text(value).toLowerCase();
const failure = (code, message, localOrderId) => ({ success: false, recovered: false, code, message, localOrderId });
const markerFields = [
  'restaurantCloudTerminalState',
  'restaurantCloudTerminalPaymentStatus',
  'cloudRestaurantTerminalUpdatedAt',
  'cloudRestaurantTerminalServerVersion'
];
const blocked = (id, message = 'La mesa no se puede reabrir de forma segura. Actualiza las mesas y vuelve a intentarlo.') =>
  failure('CLOUD_TABLE_RECOVERY_BLOCKED', message, id);

const localFinanciallyOpen = (sale) => {
  if (!sale || sale.status !== 'open') return false;
  const paymentStatus = normalize(sale.paymentStatus);
  if (paymentStatus && paymentStatus !== 'unpaid') return false;
  if (['paidAt', 'paid_at', 'paidSaleId', 'paid_sale_id', 'checkoutClosedAt', 'checkout_closed_at',
    'archivedAt', 'archived_at', 'deletedAt', 'deleted_at', 'cancelledAt', 'cancelled_at']
    .some((key) => present(sale[key]))) return false;
  if ((sale.restaurantCancellationCleanupPending !== null && sale.restaurantCancellationCleanupPending !== undefined)
    || sale.metadata?.cancelledFromPos === true
    || normalize(sale.restaurantCloudTerminalPaymentStatus) !== 'unpaid') return false;
  const settlements = [sale.restaurantSettlement, sale.restaurantCheckoutSettlement, sale.restaurantCloudSettlement];
  if (settlements.some((value) => value && (
    value.success === true || present(value.paidSaleId) || present(value.paid_sale_id)
    || ['paid', 'settled', 'confirmed', 'closed', 'complete', 'completed'].includes(normalize(value.status))
  ))) return false;
  return true;
};

const localIdentityMatches = (sale, id, licenseKey, tenantId) => {
  if (!sale || text(sale.id) !== id || (present(sale.localOrderId) && text(sale.localOrderId) !== id)) return false;
  for (const field of ['licenseKey', 'license_key', 'restaurantCloudLicenseKey']) {
    if (present(sale[field]) && text(sale[field]) !== licenseKey) return false;
  }
  for (const field of ['tenantOpaqueId', 'restaurantCloudTenantId']) {
    if (present(sale[field]) && text(sale[field]) !== tenantId) return false;
  }
  return true;
};
const parentIds = (sale) => ['restaurantOrderId', 'cloudRestaurantOrderId', 'cloudOrderId']
  .map((key) => text(sale?.[key])).filter(Boolean);

const timestampCompare = (left, right) => {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  if (leftMs !== rightMs) return leftMs < rightMs ? -1 : 1;
  const fraction = (value) => String(value).match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] || '';
  const leftFraction = fraction(left);
  const rightFraction = fraction(right);
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const a = leftFraction.padEnd(precision, '0');
  const b = rightFraction.padEnd(precision, '0');
  return a === b ? 0 : a < b ? -1 : 1;
};

const cloudVersionCompatible = (sale, order) => {
  const incomingVersionRaw = order.serverVersion ?? order.server_version;
  const incomingVersion = Number(incomingVersionRaw);
  const hasIncomingVersion = present(incomingVersionRaw) && Number.isSafeInteger(incomingVersion) && incomingVersion > 0;
  const incomingUpdatedAt = order.updatedAt ?? order.updated_at;
  if (!hasIncomingVersion && !present(incomingUpdatedAt)) return false;

  const savedVersions = [sale.cloudRestaurantTerminalServerVersion, sale.cloudRestaurantOrderServerVersion]
    .filter(present);
  for (const rawVersion of savedVersions) {
    const savedVersion = Number(rawVersion);
    if (Number.isSafeInteger(savedVersion) && savedVersion > 0) {
      if (!hasIncomingVersion || incomingVersion < savedVersion) return false;
    } else {
      const savedTimestamp = sale.cloudRestaurantTerminalUpdatedAt || sale.cloudRestaurantOrderUpdatedAt
        || sale.restaurantCloudExpectedVersion;
      const compare = present(savedTimestamp) && present(incomingUpdatedAt)
        ? timestampCompare(incomingUpdatedAt, savedTimestamp) : null;
      if (compare === null || compare < 0) return false;
    }
  }

  for (const savedTimestamp of [sale.cloudRestaurantTerminalUpdatedAt, sale.cloudRestaurantOrderUpdatedAt,
    sale.restaurantCloudExpectedVersion].filter(present)) {
    const compare = present(incomingUpdatedAt) ? timestampCompare(incomingUpdatedAt, savedTimestamp) : null;
    if (compare === null || compare < 0) return false;
  }
  return true;
};

const validateCloudSnapshot = ({ order, sale, id, licenseKey, tenantId, expectedCloudOrderId }) => {
  if (!order || !text(order.id)
    || text(order.localOrderId ?? order.local_order_id) !== id
    || text(order.saleId ?? order.sale_id) !== id
    || !isRestaurantTableInScope(order, licenseKey, tenantId)
    || (expectedCloudOrderId && text(order.id) !== text(expectedCloudOrderId))) {
    return failure('CLOUD_TABLE_SNAPSHOT_INCOMPLETE',
      'No se pudo confirmar la identidad cloud de esta mesa.', id);
  }
  const knownParents = [...new Set(parentIds(sale))];
  if (knownParents.length > 1 || (knownParents.length === 1 && knownParents[0] !== text(order.id))) {
    return failure('CLOUD_TABLE_SNAPSHOT_INCOMPLETE',
      'El registro cloud no coincide con la mesa local.', id);
  }
  if (!cloudVersionCompatible(sale, order)) return failure('CLOUD_TABLE_STALE_SNAPSHOT',
    'La mesa local tiene una versión cloud más reciente. Actualiza las mesas.', id);

  const paymentStatus = normalize(order.paymentStatus ?? order.payment_status);
  if (paymentStatus !== 'unpaid' || getRestaurantCloudTableState(order) !== 'active') {
    const paid = paymentStatus === 'paid' || present(order.paidAt ?? order.paid_at)
      || present(order.paidSaleId ?? order.paid_sale_id);
    const message = paid ? 'La mesa ya fue cobrada. Actualiza las mesas.'
      : order.metadata?.cancelledFromPos === true
        ? 'La mesa fue cancelada desde Punto de Venta. Actualiza las mesas.'
        : 'La mesa ya no está activa y pendiente de pago. Actualiza las mesas.';
    return blocked(id, message);
  }
  if (![order.status, order.fulfillmentStatus ?? order.fulfillment_status]
    .some((status) => normalize(status) === 'delivered')) return blocked(id);
  return { success: true, order };
};

/**
 * Clears only the legacy Cloud terminal markers written for a delivered,
 * unpaid table. A forced, actor-scoped parent lookup and an atomic Dexie
 * recheck are required. This function never changes sale or inventory data.
 */
export const recoverRestaurantFalseTerminalMarker = async ({
  licenseKey,
  localOrderId,
  expectedCloudOrderId = null,
  actorHandle = null,
  repository = restaurantOrdersRepository,
  database = db,
  stores = STORES,
  authoritativeResponse = null
} = {}) => {
  const id = text(localOrderId);
  if (!licenseKey || !id) return failure('CLOUD_TABLE_RECOVERY_UNVERIFIED',
    'No se pudo confirmar la mesa cloud actual.', id);

  try {
    const handle = actorHandle || actorRuntimeController.capture();
    handle.assertCurrent();
    const tenantId = handle.tenant?.opaqueId;
    if (!tenantId || !handle.tenant?.databaseName || !Number.isFinite(handle.tenant?.generation)) {
      return failure('ACTOR_TENANT_NOT_READY', 'No se pudo confirmar el negocio activo.', id);
    }
    const table = database.table(stores.SALES);
    const listed = await table.get(id);
    handle.assertCurrent();
    if (listed?.restaurantCloudTerminalState !== 'terminal') {
      return { success: true, recovered: false, code: 'NO_OP', localOrderId: id, sale: listed || null };
    }
    const terminalPayment = normalize(listed.restaurantCloudTerminalPaymentStatus);
    if (terminalPayment !== 'unpaid') return failure('CLOUD_TABLE_TERMINAL',
      terminalPayment === 'paid' ? 'La mesa ya fue cobrada.'
        : terminalPayment === 'cancelled' ? 'La mesa fue cancelada desde Punto de Venta.'
          : 'La mesa ya está cerrada.', id);
    if (!localIdentityMatches(listed, id, licenseKey, tenantId) || !localFinanciallyOpen(listed)) return blocked(id);

    const response = authoritativeResponse || await repository.getRestaurantOrderByLocalOrder({
      licenseKey, localOrderId: id, force: true
    });
    handle.assertCurrent();
    if (response?.success !== true || response?.found !== true) {
      return failure('CLOUD_TABLE_RECOVERY_UNVERIFIED',
        response?.message || 'No se pudo verificar la mesa en la nube. El bloqueo se conserva.', id);
    }
    const validation = validateCloudSnapshot({
      order: response.order, sale: listed, id, licenseKey, tenantId, expectedCloudOrderId
    });
    if (!validation.success) return validation;

    const result = await database.transaction('rw', [table], async () => {
      handle.assertCurrent();
      const current = await table.get(id);
      handle.assertCurrent();
      if (current?.restaurantCloudTerminalState !== 'terminal') {
        return { success: true, recovered: false, code: 'NO_OP', localOrderId: id, sale: current || null };
      }
      if (!localIdentityMatches(current, id, licenseKey, tenantId) || !localFinanciallyOpen(current)
        || !cloudVersionCompatible(current, validation.order)) return blocked(id);

      const cleaned = { ...current };
      for (const field of markerFields) delete cleaned[field];
      handle.assertCurrent();
      await table.put(cleaned);
      handle.assertCurrent();
      return { success: true, recovered: true, code: 'RECOVERED', localOrderId: id, sale: cleaned };
    });
    handle.assertCurrent();
    return result.success ? { ...result, order: validation.order } : result;
  } catch (error) {
    return failure(error?.code || 'CLOUD_TABLE_RECOVERY_FAILED',
      error?.code === 'ACTOR_CONTEXT_STALE'
        ? 'La sesión cambió mientras se verificaba la mesa. Actualiza e inténtalo nuevamente.'
        : 'No se pudo recuperar la mesa de forma segura. Actualiza las mesas y vuelve a intentarlo.', id);
  }
};

export default recoverRestaurantFalseTerminalMarker;
