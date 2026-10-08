import { buildRestaurantCloudStatusSummary } from './restaurantCloudStatusSummary';

export const getRestaurantCloudTableState = (order) => {
  if (!order?.localOrderId) return 'invalid';
  if (order.status === 'cancelled' && order.metadata?.cancelledFromPos === true) return 'terminal';
  const summary = buildRestaurantCloudStatusSummary(order);
  const states = [order.status, order.fulfillmentStatus].map((value) => String(value || '').toLowerCase());
  if (summary.isPaid || states.some((value) => ['paid', 'closed', 'archived', 'delivered', 'completed'].includes(value))
    || order.archivedAt || order.archived_at || order.checkoutClosedAt || order.checkout_closed_at
    || order.paidAt || order.paid_at || order.metadata?.archived === true) return 'terminal';
  if (summary.isCancelled || states.includes('cancelled')) return 'kitchen-cancelled';
  return 'active';
};

const dateToken = (order) => new Date(order?.updatedAt || order?.timestamp || order?.createdAt || 0).getTime() || 0;
const isNewer = (left, right) => {
  const leftVersion = left?.serverVersion;
  const rightVersion = right?.serverVersion;
  if (leftVersion !== null && leftVersion !== undefined && rightVersion !== null && rightVersion !== undefined && Number.isFinite(Number(leftVersion))
    && Number.isFinite(Number(rightVersion)) && Number(leftVersion) !== Number(rightVersion)) {
    return Number(leftVersion) > Number(rightVersion);
  }
  return dateToken(left) >= dateToken(right);
};

export const isRestaurantTableInScope = (order, licenseKey, tenantId) => (
  (!licenseKey || !order?.restaurantCloudLicenseKey || order.restaurantCloudLicenseKey === licenseKey)
  && (!licenseKey || !(order?.licenseKey || order?.license_key) || (order.licenseKey || order.license_key) === licenseKey)
  && (!tenantId || !order?.restaurantCloudTenantId || order.restaurantCloudTenantId === tenantId)
  && (!tenantId || !order?.tenantOpaqueId || order.tenantOpaqueId === tenantId)
);

// This projection is for discovery/display only. Loading always reads the local
// original or hydrates a freshly revalidated commercial snapshot before POS use.
const cloudDisplayItems = (order) => (Array.isArray(order.items) ? order.items : []).map((item) => ({
  ...item,
  id: item.productId,
  lineId: item.localLineId,
  name: item.productName,
  price: item.unitPrice,
  selectedModifiers: item.selectedModifiers || item.metadata?.selectedModifiers || []
}));

export const buildRestaurantActiveTables = ({
  localSales = [], cloudOrders = [], cloudEnabled = false, licenseKey = null, tenantId = null
} = {}) => {
  const locals = new Map(localSales.filter((sale) => sale?.id && isRestaurantTableInScope(sale, licenseKey, tenantId))
    .map((sale) => [sale.id, sale]));
  const clouds = new Map();
  if (cloudEnabled) {
    for (const order of cloudOrders) {
      if (!order?.localOrderId || !isRestaurantTableInScope(order, licenseKey, tenantId)) continue;
      const previous = clouds.get(order.localOrderId);
      if (!previous || isNewer(order, previous)) clouds.set(order.localOrderId, order);
    }
  }
  const tables = [];
  for (const localOrderId of new Set([...locals.keys(), ...clouds.keys()])) {
    const localSale = locals.get(localOrderId) || null;
    const cloudOrder = clouds.get(localOrderId) || null;
    const cloudState = cloudOrder ? getRestaurantCloudTableState(cloudOrder) : null;
    if (localSale?.restaurantCloudTerminalState === 'terminal') continue;
    if (cloudState === 'terminal' || cloudState === 'invalid') continue;
    const source = cloudOrder ? (localSale ? 'LOCAL_AND_CLOUD' : 'CLOUD_ONLY') : 'LOCAL_ONLY';
    const row = cloudOrder ? {
      ...localSale,
      id: localOrderId,
      tableData: cloudOrder.tableLabel || localSale?.tableData || 'Mesa',
      items: cloudDisplayItems(cloudOrder),
      total: cloudOrder.total,
      subtotal: cloudOrder.subtotal,
      currency: cloudOrder.currency,
      status: 'open',
      fulfillmentStatus: cloudState === 'kitchen-cancelled' ? 'cancelled' : cloudOrder.fulfillmentStatus || cloudOrder.status,
      updatedAt: cloudOrder.updatedAt,
      timestamp: cloudOrder.createdAt,
      restaurantCloudHydrated: !localSale || localSale.restaurantCloudHydrated === true,
      reservationAuthority: !localSale ? 'cloud' : localSale.reservationAuthority
    } : { ...localSale };
    tables.push({
      ...row,
      localOrderId,
      cloudOrderId: cloudOrder?.id || localSale?.cloudRestaurantOrderId || null,
      source,
      localSale,
      cloudOrder,
      serverVersion: cloudOrder?.serverVersion ?? localSale?.cloudRestaurantOrderServerVersion ?? null,
      paymentStatus: cloudOrder?.paymentStatus || localSale?.paymentStatus || 'unpaid',
      hydrationState: !localSale ? 'REQUIRED' : localSale.restaurantCloudHydrated ? 'REVALIDATE' : 'LOCAL',
      pendingSync: cloudEnabled && !cloudOrder && !localSale?.restaurantCloudHydrated
    });
  }
  return tables.sort((left, right) => dateToken(right) - dateToken(left) || String(left.id).localeCompare(String(right.id)));
};

export const countRestaurantActiveTables = (tables = []) => ({
  active: tables.filter((table) => table.fulfillmentStatus !== 'cancelled').length,
  kitchenRejected: tables.filter((table) => table.fulfillmentStatus === 'cancelled').length
});

export const fetchRestaurantTableDiscoveryOrders = async ({ repository, licenseKey, actorHandle, force = false }) => {
  const orders = [];
  const pageSize = 300;
  for (let offset = 0; ; offset += pageSize) {
    actorHandle.assertCurrent();
    const response = await repository.getRestaurantOrders({ licenseKey, includeCompleted: true,
      limit: pageSize, offset, force });
    actorHandle.assertCurrent();
    if (response?.success === false) return response;
    const page = Array.isArray(response?.orders) ? response.orders : [];
    orders.push(...page);
    if (page.length < pageSize) return { success: true, orders };
  }
};

// Keep explicit terminal evidence even when a later fetch fails or the origin
// device goes offline. This does not settle/delete its original sale or holds.
export const rememberRestaurantTableTerminalStates = async ({
  database, stores, localSales, cloudOrders, actorHandle, licenseKey = null,
  tenantId = actorHandle?.tenant?.opaqueId || null
}) => {
  const localIds = new Set(localSales.filter((sale) => isRestaurantTableInScope(sale, licenseKey, tenantId))
    .map((sale) => sale.id));
  const terminal = cloudOrders.filter((order) => localIds.has(order.localOrderId)
    && isRestaurantTableInScope(order, licenseKey, tenantId)
    && getRestaurantCloudTableState(order) === 'terminal');
  if (!terminal.length) return;
  const table = database.table(stores.SALES);
  await database.transaction('rw', [table], async () => {
    for (const order of terminal) {
      actorHandle.assertCurrent();
      const sale = await table.get(order.localOrderId);
      actorHandle.assertCurrent();
      if (!sale || sale.status !== 'open' || !isRestaurantTableInScope(sale, licenseKey, tenantId)) continue;
      await table.update(sale.id, { restaurantCloudTerminalState: 'terminal',
        restaurantCloudTerminalPaymentStatus: order.paymentStatus,
        cloudRestaurantTerminalUpdatedAt: order.updatedAt,
        cloudRestaurantTerminalServerVersion: order.serverVersion });
      actorHandle.assertCurrent();
    }
  });
};
