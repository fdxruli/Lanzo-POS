export const ECOMMERCE_ORDERS_CHANGED_EVENT = 'lanzo:ecommerce-orders-changed';
export const ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS = 300;

const normalizeOrderId = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

export const getEcommerceOrderIdFromEvent = (event) => {
  const detail = event?.detail;
  if (!detail || typeof detail !== 'object') return null;
  return normalizeOrderId(
    detail.orderId
    ?? detail.order_id
    ?? detail.metadata?.order_id
  );
};

export const normalizeEcommerceOrderId = normalizeOrderId;
