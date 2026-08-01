import { dispatchTickerInventoryAlert } from '../tickerAlertEvents';
import { PRODUCT_SYNC_EVENT } from './productConstants';

export const notifyProductsChanged = (detail = {}) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(PRODUCT_SYNC_EVENT, { detail }));
  dispatchTickerInventoryAlert(detail.productIds || [], {
    reason: detail.source || 'products-changed'
  });

};

export default notifyProductsChanged;
