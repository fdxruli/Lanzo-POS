export const TICKER_INVENTORY_ALERT_EVENT = 'lanzo:ticker-inventory-alert';

export function dispatchTickerInventoryAlert(productIds = []) {
  if (typeof window === 'undefined' || productIds.length === 0) return;

  window.dispatchEvent(new CustomEvent(TICKER_INVENTORY_ALERT_EVENT, {
    detail: { productIds }
  }));
}
