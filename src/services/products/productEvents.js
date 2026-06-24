import Logger from '../Logger';
import { useProductStore } from '../../store/useProductStore';
import { PRODUCT_SYNC_EVENT } from './productConstants';

export const notifyProductsChanged = (detail = {}) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(PRODUCT_SYNC_EVENT, { detail }));

  try {
    useProductStore.getState().invalidateAndReset();
  } catch (error) {
    Logger.warn('[Products/Sync] No se pudo invalidar product store:', error);
  }
};

export default notifyProductsChanged;
