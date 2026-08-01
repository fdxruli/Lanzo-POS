import { dispatchTickerInventoryAlert } from '../tickerAlertEvents';
import { PRODUCT_SYNC_EVENT } from './productConstants';

export const notifyProductsChanged = (detail = {}) => {
  if (typeof window === 'undefined') return;

  const productIds = Array.from(new Set([
    ...(Array.isArray(detail.productIds) ? detail.productIds : []),
    ...(detail.productId ? [detail.productId] : [])
  ].filter(Boolean)));
  const catalogEvent = {
    ...detail,
    source: detail.source || PRODUCT_SYNC_EVENT,
    operation: detail.operation || null,
    productId: detail.productId || productIds[0] || null,
    productIds,
    timestamp: Number(detail.timestamp) || Date.now()
  };
  window.dispatchEvent(new CustomEvent(PRODUCT_SYNC_EVENT, { detail: catalogEvent }));
  dispatchTickerInventoryAlert(catalogEvent.productIds, {
    reason: catalogEvent.source || 'products-changed'
  });
};

export default notifyProductsChanged;
