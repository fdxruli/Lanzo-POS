import { create } from 'zustand';
import { createUISlice } from './slices/createUISlice';
import { createLicenseSlice } from './slices/createLicenseSlice';
import { createProfileSlice } from './slices/createProfileSlice';
import { createPWASlice } from './slices/createPWASlice';
import { createDriveSlice } from './slices/createDriveSlice';
import {
  createNotificationSlice,
  shouldResetNotificationRuntimeForStatePatch
} from './slices/createNotificationActorStateSlice';
import { createEcommercePublishedStockAlertSlice } from './slices/createEcommercePublishedStockAlertSlice';
import { localTenantAccessController } from '../services/tenant/localTenantPolicy';
import { isUnsafeTenantStatePatch } from './tenantSafeState';

export const useAppStore = create((set, get, store) => {
  const tenantSafeSet = (partial, replace) => {
    const currentState = get();
    const patch = typeof partial === 'function' ? partial(currentState) : partial;
    if (!patch || isUnsafeTenantStatePatch(
      patch,
      localTenantAccessController.getState(),
      currentState
    )) return undefined;

    if (shouldResetNotificationRuntimeForStatePatch(currentState, patch, replace)) {
      currentState.resetNotificationRuntime?.();
    }

    return set(patch, replace);
  };
  const args = [tenantSafeSet, get, store];

  return {
    ...createUISlice(...args),
    ...createLicenseSlice(...args),
    ...createProfileSlice(...args),
    ...createPWASlice(...args),
    ...createDriveSlice(...args),
    ...createNotificationSlice(...args),
    ...createEcommercePublishedStockAlertSlice(...args)
  };
});

// Zustand exposes a public setState that bypasses the creator's `set` wrapper.
// Lazy-installed slices and tests use that API, so it must enforce the same
// tenant boundary as every slice-local mutation.
const setAppStateUnsafe = useAppStore.setState;
useAppStore.setState = (partial, replace) => {
  const currentState = useAppStore.getState();
  const patch = typeof partial === 'function' ? partial(currentState) : partial;
  if (!patch || isUnsafeTenantStatePatch(
    patch,
    localTenantAccessController.getState(),
    currentState
  )) return undefined;

  if (shouldResetNotificationRuntimeForStatePatch(currentState, patch, replace)) {
    currentState.resetNotificationRuntime?.();
  }

  return setAppStateUnsafe(patch, replace);
};
