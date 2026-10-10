const ACTIVE_PENDING_STATUSES = new Set(['pending', 'open', 'sent', 'sent_to_kitchen']);
export const RESTAURANT_CLOUD_STATUS_EVENT = 'lanzo:restaurant-orders-cloud-updated';
const PREPARING_STATUSES = new Set(['preparing']);
const READY_STATUSES = new Set(['ready']);
const DONE_STATUSES = new Set(['ready', 'delivered']);
const CANCELLED_STATUSES = new Set(['cancelled']);
const PAID_STATUSES = new Set(['paid']);

export const RESTAURANT_ORDER_STATUS_LABELS = Object.freeze({
  pending: 'En cocina',
  preparing: 'En preparación',
  ready: 'Lista',
  cancelled: 'Cancelada',
  delivered: 'Entregada'
});

export const RESTAURANT_ORDER_ITEM_STATUS_LABELS = Object.freeze({
  pending: 'Pendiente',
  preparing: 'En preparación',
  ready: 'Listo',
  cancelled: 'Cancelado',
  delivered: 'Entregado'
});

export const normalizeRestaurantCloudStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const normalizePaymentStatus = (status) => String(status || 'unpaid').trim().toLowerCase() || 'unpaid';

export const hasStaffPermission = (canAccess, permissions = []) => (
  typeof canAccess === 'function' && permissions.some((permission) => canAccess(permission))
);

const getCloudItems = (cloudOrder) => (
  Array.isArray(cloudOrder?.items) ? cloudOrder.items : []
);

export const getStatusLabel = (status, labels = RESTAURANT_ORDER_STATUS_LABELS) => (
  labels[normalizeRestaurantCloudStatus(status)] || 'En cocina'
);

export const friendlyStatusError = (error) => {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error?.message || error?.code || String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('sin conexión') || normalized.includes('offline') || normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'No se pudo verificar cocina cloud porque el dispositivo está sin conexión.';
  }

  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('pos_permission_denied')) {
    return 'Tu usuario no tiene permiso para ver el estado de cocina de esta mesa.';
  }

  if (normalized.includes('food_service') || normalized.includes('restaurant_orders_food_service_required')) {
    return 'El estado de cocina cloud solo está disponible para negocios tipo restaurante.';
  }

  if (normalized.includes('disabled') || normalized.includes('plan')) {
    return 'Tu plan actual no tiene activo el estado de cocina cloud.';
  }

  return message || 'No se pudo verificar cocina cloud en este momento.';
};

export const buildRestaurantCloudStatusSummary = (cloudOrder) => {
  const items = getCloudItems(cloudOrder);
  const normalizedOrderStatus = normalizeRestaurantCloudStatus(
    cloudOrder?.fulfillmentStatus || cloudOrder?.status
  );
  const paymentStatus = normalizePaymentStatus(cloudOrder?.paymentStatus || cloudOrder?.payment_status);
  const isPaid = PAID_STATUSES.has(paymentStatus);

  const cancelledItems = items.filter((item) => CANCELLED_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const pendingItems = items.filter((item) => ACTIVE_PENDING_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const preparingItems = items.filter((item) => PREPARING_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const readyItems = items.filter((item) => READY_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const doneItems = items.filter((item) => DONE_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const activeItems = items.filter((item) => !CANCELLED_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));

  const hasCancelledItems = cancelledItems.length > 0;
  const hasPendingItems = pendingItems.length > 0;
  const hasPreparingItems = preparingItems.length > 0;
  const isCancelled = normalizedOrderStatus === 'cancelled' || (items.length > 0 && activeItems.length === 0);
  const isReady = !isCancelled && (
    normalizedOrderStatus === 'ready' ||
    normalizedOrderStatus === 'delivered' ||
    (activeItems.length > 0 && doneItems.length === activeItems.length)
  );
  const isPaidPendingKitchen = isPaid && !isCancelled && !isReady && (hasPendingItems || hasPreparingItems || normalizedOrderStatus === 'pending' || normalizedOrderStatus === 'preparing');

  return {
    items,
    status: normalizedOrderStatus,
    statusLabel: isPaidPendingKitchen ? 'Pagada, pendiente de cocina' : getStatusLabel(normalizedOrderStatus),
    paymentStatus,
    isPaid,
    isPaidPendingKitchen,
    paidAt: cloudOrder?.paidAt || cloudOrder?.paid_at || null,
    paidSaleId: cloudOrder?.paidSaleId || cloudOrder?.paid_sale_id || null,
    paidSaleFolio: cloudOrder?.paidSaleFolio || cloudOrder?.paid_sale_folio || null,
    paidTotal: cloudOrder?.paidTotal ?? cloudOrder?.paid_total ?? null,
    checkoutClosedAt: cloudOrder?.checkoutClosedAt || cloudOrder?.checkout_closed_at || null,
    hasCancelledItems,
    cancelledItems,
    hasPendingItems,
    pendingItems,
    hasPreparingItems,
    preparingItems,
    readyItems,
    doneItems,
    activeItems,
    isReady,
    isCancelled
  };
};
