import Logger from '../services/Logger';
import {
  isDatabaseRecoveryPending,
  subscribeDatabaseRecoveryState
} from '../services/db/databaseRecoveryState';
import { useInventoryCatalogStore } from './useInventoryCatalogStore';
import { usePosCatalogStore } from './usePosCatalogStore';

let installed = false;
let unsubscribe = null;

export const installProductStoreRecoveryGuard = () => {
  if (installed) return unsubscribe || (() => {});
  installed = true;

  const catalogStores = [useInventoryCatalogStore, usePosCatalogStore];
  for (const catalogStore of catalogStores) {
    const originalInvalidate = catalogStore.getState().invalidateAndReset;
    const guardedInvalidate = (...args) => {
      if (isDatabaseRecoveryPending()) {
        catalogStore.setState({ isInvalidating: false, isLoading: false });
        Logger.debug('[ProductStore] Invalidation omitida: recuperación local pendiente.');
        return undefined;
      }
      return originalInvalidate(...args);
    };

    Object.defineProperty(guardedInvalidate, '__lanzoRecoveryGuard', { value: true });
    catalogStore.setState({ invalidateAndReset: guardedInvalidate });
  }

  unsubscribe = subscribeDatabaseRecoveryState((state) => {
    if (state.status === 'recovery_required' || state.status === 'failed' || state.status === 'migrating') {
      for (const catalogStore of catalogStores) {
        catalogStore.setState({ isInvalidating: false, isLoading: false });
      }
      usePosCatalogStore.getState().reset?.();
    }
  });

  return unsubscribe;
};

export const resetProductStoreRecoveryGuardForTests = () => {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
};
