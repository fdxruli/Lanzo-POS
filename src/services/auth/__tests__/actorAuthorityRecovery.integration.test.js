/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cache = new Map();
  const tenant = {
    opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    databaseName: 'LanzoDB_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 7
  };
  return {
    cache, tenant, hydrate: vi.fn(async () => []),
    adminLogin: vi.fn(), staffLogin: vi.fn(), adminLogout: vi.fn(), staffLogout: vi.fn(),
    saveLicense: vi.fn(async () => {}),
    clearAdmin: vi.fn(async () => {
      cache.delete('admin_session_token'); cache.delete('admin_session_id');
    }),
    clearStaff: vi.fn(async () => {
      cache.delete('staff_session_token'); cache.delete('staff_session_id');
    })
  };
});
vi.mock('../../db/tenantRuntimeRouter', () => ({
  db: { table: () => ({ get: async (key) => ({ value: mocks.cache.get(key) }) }) },
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: mocks.tenant })
}));
vi.mock('../../supabase', () => ({
  getStableDeviceId: async () => 'fingerprint-X',
  activateLicense: vi.fn(), adminLoginOnDevice: mocks.adminLogin,
  staffLoginOnDevice: mocks.staffLogin, adminLogoutSession: mocks.adminLogout,
  staffLogoutSession: mocks.staffLogout, adminTakeoverFreeDevice: vi.fn(),
  enrollAdminOwnerOnDevice: vi.fn(), clearAdminSessionCache: mocks.clearAdmin,
  clearStaffSessionCache: mocks.clearStaff, hasStaffSessionToken: async () => true
}));
vi.mock('../../tenant/tenantScopedStorage', () => ({
  hydrateTenantStorageConsumers: mocks.hydrate, resumeTenantStorageWrites: vi.fn()
}));
vi.mock('../actorOperationalHandoff', () => ({
  configureActorOperationalPersistence: vi.fn(), installActorOperationalHandoffGuards: vi.fn(),
  refreshPersistedActorCheckoutOwnership: vi.fn(), assertActorOperationalHandoffClear: vi.fn(),
  rebindActorOperationalOwnership: vi.fn()
}));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => true), initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: () => false, lockLocalTenantAccess: vi.fn()
}));
vi.mock('../../licenseStorage', () => ({ saveLicenseToStorage: mocks.saveLicense }));
vi.mock('../../db/databaseRuntime', () => ({ ensureLocalDatabaseReady: async () => true }));
vi.mock('../../Logger', () => ({ default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../products/posCatalogSessionEvents', () => ({ notifyPosCatalogSessionReset: vi.fn() }));

import { actorRuntimeController } from '../actorRuntimeController';
import {
  beginActorRuntimeAuthentication, grantAuthenticatedActorRuntime, lockActorRuntime
} from '../actorSessionRuntimeBridge';
import {
  captureActorScopedStorageHandle, getActorScopedStorageState, getActorStorageItem,
  setActorStorageItem, invalidateActorScopedStorage
} from '../actorScopedStorage';
import {
  clearActorAuthorityRecovery, getActorAuthorityRecoverySnapshot, reportActorAuthorityError
} from '../actorAuthorityRecovery';
import { createLicenseAdminActions } from '../../../store/slices/license/licenseAdminActions';
import { createLicenseStaffActions } from '../../../store/slices/license/licenseStaffActions';
import { createLicenseAuthorityRecoveryActions } from '../../../store/slices/license/licenseAuthorityRecoveryActions';
import { cloudRequestManager } from '../../cloud/cloudRequestManager';

const CART_KEY = 'lanzo-active-orders-storage';
let store;
const createStore = () => {
  const state = {
    appStatus: 'ready', licenseStatus: 'active', currentDeviceRole: 'admin',
    licenseDetails: { license_key: 'QA-RECOVERY', valid: true, status: 'active', device_role: 'admin' },
    stopLicenseSync: vi.fn(async () => {}),
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; })
  };
  const context = { set: (partial) => Object.assign(state, partial), get: () => state };
  Object.assign(state, createLicenseAuthorityRecoveryActions(context),
    createLicenseAdminActions(context), createLicenseStaffActions(context));
  return state;
};
const initialGrant = async (actorType = 'admin') => {
  mocks.cache.set('device_security_token', 'token-A');
  mocks.cache.set(`${actorType}_session_token`, `${actorType}-token-A`);
  mocks.cache.set(`${actorType}_session_id`, `${actorType}-session-A`);
  beginActorRuntimeAuthentication(actorType);
  await grantAuthenticatedActorRuntime({ actorType, actor: { id: `${actorType}-qa`, permissions: ['sales'] } });
  store.currentDeviceRole = actorType;
  store.licenseDetails.device_role = actorType;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  lockActorRuntime('test_reset');
  clearActorAuthorityRecovery();
  window.localStorage.clear();
  store = createStore();
  mocks.adminLogin.mockImplementation(async () => {
    mocks.cache.set('device_security_token', 'token-B');
    mocks.cache.set('admin_session_token', 'admin-token-B');
    mocks.cache.set('admin_session_id', 'admin-session-B');
    return { success: true, admin_user: { id: 'admin-qa' }, details: { license_key: 'QA-RECOVERY' } };
  });
  mocks.staffLogin.mockImplementation(async () => {
    mocks.cache.set('device_security_token', 'token-B');
    mocks.cache.set('staff_session_token', 'staff-token-B');
    mocks.cache.set('staff_session_id', 'staff-session-B');
    return { success: true, staff_user: { id: 'staff-qa', permissions: ['sales'] }, details: { license_key: 'QA-RECOVERY' } };
  });
});
afterEach(() => {
  store._disposeActorAuthorityRecoveryObserver();
  invalidateActorScopedStorage('test_cleanup');
  clearActorAuthorityRecovery();
});

describe('authenticated authority recovery with actor storage', () => {
  it('reauthenticates Admin using the existing login and hydrates durable storage before writes resume', async () => {
    await initialGrant();
    const handle = actorRuntimeController.capture();
    const storageHandle = captureActorScopedStorageHandle();
    const durableCart = JSON.stringify({ state: { activeOrders: [['cart-1', { items: ['Hamburguesa QA'] }]] } });
    setActorStorageItem(CART_KEY, durableCart);
    const transitions = [];
    const unsubscribe = actorRuntimeController.subscribe((state) => transitions.push(state.status));
    reportActorAuthorityError({ code: 'P0001', message: 'DEVICE_TOKEN_INVALID' }, { operation: 'restaurant_list_open_orders' });
    expect(store.appStatus).toBe('admin_login_required');
    expect(store.licenseStatus).toBe('active');
    expect(getActorScopedStorageState()).toMatchObject({ writesSuspended: true, active: null });
    expect(getActorAuthorityRecoverySnapshot()).toMatchObject({ kind: 'device_auth', actorType: 'admin' });
    expect(() => actorRuntimeController.capture()).toThrow('ACTOR_CONTEXT_LOCKED');

    const result = await store.handleAdminLogin({ username: 'qa-admin', password: 'password' });
    unsubscribe();
    expect(result.success).toBe(true);
    expect(mocks.adminLogin).toHaveBeenCalledTimes(1);
    expect(mocks.cache.get('device_security_token')).toBe('token-B');
    expect(transitions).toEqual(['locked', 'authenticating', 'handoff_check', 'granted']);
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorType: 'admin', sessionId: 'admin-session-B' });
    expect(getActorScopedStorageState()).toMatchObject({ writesSuspended: false, active: { actorKey: 'admin:admin-qa' } });
    expect(getActorStorageItem(CART_KEY)).toBe(durableCart);
    expect(getActorAuthorityRecoverySnapshot()).toBeNull();
    expect(() => handle.assertCurrent()).toThrow('ACTOR_CONTEXT_STALE');
    expect(() => storageHandle.assertCurrent()).toThrow('ACTOR_CONTEXT_STALE');
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    expect(actorRuntimeController.getDiagnostics().at(-1)).toMatchObject({
      previousStatus: 'granted', newStatus: 'locked',
      reason: 'device_auth_reauthentication_required', operation: 'restaurant_list_open_orders'
    });
  });

  it('recovers an expired Staff session through Staff login and never selects Admin', async () => {
    await initialGrant('staff');
    reportActorAuthorityError({ code: 'STAFF_LOGIN_REQUIRED' }, { operation: 'checkout' });
    expect(store.appStatus).toBe('staff_login_required');
    expect(getActorAuthorityRecoverySnapshot().actorType).toBe('staff');
    expect((await store.handleStaffLogin({ username: 'qa-staff', password: 'password' })).success).toBe(true);
    expect(mocks.staffLogin).toHaveBeenCalledTimes(1);
    expect(mocks.adminLogin).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorType: 'staff', permissions: ['sales'] });
    expect(getActorScopedStorageState().writesSuspended).toBe(false);
  });

  it('locks Tab A on a foreign context without overwriting Tab B and allows explicit same-actor recovery', async () => {
    await initialGrant();
    const active = getActorScopedStorageState().active;
    const contextKey = `lanzo:t:${mocks.tenant.opaqueId}:actor-runtime-context:v1`;
    const foreign = { version: 1, tenantOpaqueId: mocks.tenant.opaqueId,
      actorOpaqueId: active.actorOpaqueId, actorGeneration: active.actorGeneration + 1,
      contextToken: 'tab-B-new-context', status: 'granted' };
    const raw = JSON.stringify(foreign);
    window.localStorage.setItem(contextKey, raw);
    window.dispatchEvent(new StorageEvent('storage', { key: contextKey, newValue: raw }));
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'locked', reason: 'actor_context_changed_in_other_tab' });
    expect(window.localStorage.getItem(contextKey)).toBe(raw);
    expect(store.appStatus).toBe('admin_login_required');
    expect(getActorAuthorityRecoverySnapshot().kind).toBe('foreign_tab');
    expect(() => actorRuntimeController.capture()).toThrow('ACTOR_CONTEXT_LOCKED');
    expect((await store.handleAdminLogin({ username: 'qa-admin', password: 'password' })).success).toBe(true);
    expect(actorRuntimeController.getState().status).toBe('granted');
    expect(getActorScopedStorageState().writesSuspended).toBe(false);
  });

  it('voluntary logout clears recovery and cannot restore the actor automatically', async () => {
    await initialGrant();
    reportActorAuthorityError({ code: 'DEVICE_TOKEN_REQUIRED' });
    await store.logoutAdmin();
    expect(getActorAuthorityRecoverySnapshot()).toBeNull();
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'locked', reason: 'admin_actor_logged_out' });
    expect(() => actorRuntimeController.capture()).toThrow('ACTOR_CONTEXT_LOCKED');
    expect(mocks.adminLogin).not.toHaveBeenCalled();
    expect(reportActorAuthorityError({ code: 'DEVICE_TOKEN_INVALID' })).toBe(false);
    expect(getActorAuthorityRecoverySnapshot()).toBeNull();
  });

  it('consumes an old handle rejection after recovery without relocking the newly granted actor', async () => {
    await initialGrant();
    const oldHandle = actorRuntimeController.capture();
    reportActorAuthorityError({ code: 'DEVICE_TOKEN_INVALID' });
    await store.handleAdminLogin({ username: 'qa-admin', password: 'password' });
    let staleError;
    try { oldHandle.assertCurrent(); } catch (error) { staleError = error; }
    expect(staleError.code).toBe('ACTOR_CONTEXT_STALE');
    expect(reportActorAuthorityError(staleError, { operation: 'checkout' })).toBe(true);
    expect(actorRuntimeController.getState().status).toBe('granted');
    expect(getActorAuthorityRecoverySnapshot()).toBeNull();
  });

  it.each(['DEVICE_NOT_ALLOWED', 'DEVICE_RELEASED', 'CLONING_DETECTED'])(
    'keeps the existing hard block for %s outside simple reauthentication', async (code) => {
      await initialGrant();
      expect(reportActorAuthorityError({ code })).toBe(false);
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
      expect(mocks.adminLogin).not.toHaveBeenCalled();
      expect(actorRuntimeController.getState().status).toBe('locked');
      expect(getActorScopedStorageState().writesSuspended).toBe(true);
      store.appStatus = 'device_revoked';
      store.licenseStatus = code;
      expect(() => actorRuntimeController.capture()).toThrow('ACTOR_CONTEXT_LOCKED');
      reportActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' });
      expect(store.appStatus).toBe('device_revoked');
      expect(store.licenseStatus).toBe(code);
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
    }
  );

  it('preserves the durable table recovery message through later locked handlers', async () => {
    await initialGrant();
    reportActorAuthorityError({ code: 'DEVICE_TOKEN_INVALID' }, { durableSaveSucceeded: true, operation: 'save_table' });
    reportActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, { operation: 'removeOrder' });
    expect(getActorAuthorityRecoverySnapshot()).toMatchObject({
      durableSaveSucceeded: true,
      message: 'La mesa quedó guardada. Vuelve a iniciar sesión para continuar operándola.'
    });
  });

  it('discards an in-flight successful read after real logout and login without relocking the new session', async () => {
    await initialGrant();
    cloudRequestManager.clear();
    let resolveRead;
    const response = new Promise((resolve) => { resolveRead = resolve; });
    const oldRead = cloudRequestManager.request({
      key: 'before-logout', rpcName: 'restaurant_list_open_orders', ttlMs: 60_000,
      fn: () => response
    });
    await Promise.resolve();
    await store.logoutAdmin();
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect((await store.handleAdminLogin({ username: 'qa-admin', password: 'password' })).success).toBe(true);
    resolveRead({ tables: ['obsolete-table'] });
    await expect(oldRead).rejects.toMatchObject({ code: 'CLOUD_REQUEST_RESPONSE_STALE', reason: 'actor_changed' });
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', sessionId: 'admin-session-B' });
    expect(getActorAuthorityRecoverySnapshot()).toBeNull();
    expect(cloudRequestManager.getStats().cacheSize).toBe(0);
  });
});
