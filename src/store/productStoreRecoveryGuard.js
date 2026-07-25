import Logger from '../services/Logger';
import {
  isDatabaseRecoveryPending,
  subscribeDatabaseRecoveryState
} from '../services/db/databaseRecoveryState';
import { useProductStore } from './useProductStore';

let installed = false;
let unsubscribe = null;

export const installProductStoreRecoveryGuard = () => {
  if (installed) return unsubscribe || (() => {});
  installed = true;

  const originalInvalidate = useProductStore.getState().invalidateAndReset;

  const guardedInvalidate = (...args) => {
    if (isDatabaseRecoveryPending()) {
      useProductStore.setState({
        isInvalidating: false,
        isLoading: false
      });
      Logger.debug('[ProductStore] Invalidation omitida: recuperación local pendiente.');
      return undefined;
    }
    return originalInvalidate(...args);
  };

  Object.defineProperty(guardedInvalidate, '__lanzoRecoveryGuard', { value: true });
  useProductStore.setState({ invalidateAndReset: guardedInvalidate });

  unsubscribe = subscribeDatabaseRecoveryState((state) => {
    if (state.status === 'recovery_required' || state.status === 'failed' || state.status === 'migrating') {
      useProductStore.setState({
        isInvalidating: false,
        isLoading: false
      });
    }
  });

  return unsubscribe;
};

export const resetProductStoreRecoveryGuardForTests = () => {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
};
