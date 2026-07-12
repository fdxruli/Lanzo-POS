export const TICKER_INVENTORY_ALERT_EVENT = 'lanzo:ticker-inventory-alert';

export function dispatchTickerInventoryAlert(productIds = [], detail = {}) {
  if (typeof window === 'undefined') return;

  const normalizedProductIds = Array.from(new Set(
    (Array.isArray(productIds) ? productIds : [])
      .map((productId) => String(productId || '').trim())
      .filter(Boolean)
  ));

  window.dispatchEvent(new CustomEvent(TICKER_INVENTORY_ALERT_EVENT, {
    detail: {
      ...detail,
      productIds: normalizedProductIds,
      reason: detail.reason || 'inventory-change'
    }
  }));
}
