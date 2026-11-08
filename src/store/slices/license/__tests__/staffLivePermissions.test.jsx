// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createStore } from 'zustand/vanilla';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  vi.stubEnv('VITE_ENABLE_LICENSE_REALTIME', 'true');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fixture-key');
  return { db: null, store: null, rpc: vi.fn(), callbacks: null, device: 'device-a',
    tenant: { opaqueId: 'tenant-a', databaseName: 'staff-live-fixture', generation: 1 } };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: fixture.rpc }) }));
vi.mock('../../../../services/db/tenantRuntimeRouter', () => ({
  db: { table: name => fixture.db.table(name) },
  getActiveTenantRuntime: () => fixture.tenant,
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: fixture.tenant })
}));
vi.mock('../../../../services/database', () => ({ STORES: { SYNC_CACHE: 'sync_cache' },
  loadData: (table, key) => fixture.db.table(table).get(key),
  saveData: (table, row) => fixture.db.table(table).put(row)
}));
vi.mock('../../../../services/device/deviceRegistry', () => ({
  DEVICE_REGISTRY_KEYS: { STABLE_DEVICE_ID: 'device_id' }, readDeviceRegistryValue: async () => fixture.device, writeDeviceRegistryValue: vi.fn()
}));
vi.mock('../../../../services/utils', () => ({ checkInternetConnection: async () => navigator.onLine,
  safeLocalStorageSet: vi.fn(), showMessageModal: vi.fn(), generateID: () => crypto.randomUUID() }));
vi.mock('../../../../services/licenseStorage', () => ({ getLicenseFromStorage: async () => null, saveLicenseToStorage: async () => {} }));
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: async () => {}, assertLocalTenantSyncAccess: async () => {},
  runWithLocalTenantSyncLease: async (_identity, _options, operation) => operation(),
  isLocalTenantAccessError: () => false, getLocalTenantBinding: async () => null,
  initializeLocalTenantGuard: vi.fn(), lockLocalTenantAccess: vi.fn()
}));
vi.mock('../../../../services/licenseRealtime', () => ({
  startLicenseListener: (_key, _device, _topic, callbacks) => { fixture.callbacks = callbacks; return { id: 'channel' }; },
  stopLicenseListener: async () => {}, getConnectionStatus: () => ({ isActive: true })
}));
vi.mock('../../../useAppStore', async () => {
  const { useStore } = await import('zustand');
  return { useAppStore: selector => useStore(fixture.store, selector) };
});

import Dexie from 'dexie';
import { actorRuntimeController } from '../../../../services/auth/actorRuntimeController';
import PermissionRoute from '../../../../components/common/PermissionRoute';
import { captureLicenseValidationContext, assertLicenseValidationContextCurrent } from '../licenseValidationContext';
import { reconcileLicenseSessionIdentity } from '../licenseActorReconciliation';
import { createLicenseStaffActions } from '../licenseStaffActions';
import { createLicenseSyncActions } from '../licenseSyncActions';
import { createLicenseMaintenanceActions } from '../licenseMaintenanceActions';
import { createLicenseRealtimeActions } from '../licenseRealtimeActions';

const verified = pos => ({ data: { success: true, valid: true,
  staff_user: { id: 'staff-a', permissions: { pos, settings: false } } }, error: null });
const state = () => fixture.store.getState();
const event = () => fixture.callbacks.onLicenseChanged({ type: 'LICENSE_UPDATE', permissions: { settings: true } });
const grant = (actorId = 'staff-a', sessionId = 'session-a') => {
  actorRuntimeController.lock('test_login');
  actorRuntimeController.beginAuthentication({ actorType: 'staff' });
  actorRuntimeController.grant({ actorType: 'staff', actorId, sessionId, deviceRef: 'device-a', permissions: ['pos'] });
};

beforeEach(async () => {
  vi.useRealTimers();
  fixture.device = 'device-a';
  fixture.tenant = { opaqueId: 'tenant-a', databaseName: 'staff-live-fixture', generation: 1 };
  fixture.db ||= new Dexie('staff-live-fixture');
  if (!fixture.db.isOpen()) fixture.db.version(1).stores({ sync_cache: 'key' });
  await fixture.db.table('sync_cache').clear();
  await fixture.db.table('sync_cache').bulkPut([
    { key: 'staff_session_token', value: 'staff-token' }, { key: 'staff_session_id', value: 'session-a' }
  ]);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  fixture.rpc.mockReset().mockResolvedValue(verified(true));
  grant();
  fixture.store = createStore((set, get) => ({
    appStatus: 'ready', licenseDetails: { valid: true, license_key: 'fixture-license', device_mode: 'shared',
      device_role: 'staff', realtime_topic: 'license:fixture', features: { realtime_license_sync: true } },
    currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions: { pos: true } },
    licenseSyncMode: 'hybrid_realtime', licenseSyncActive: true,
    _loadProfile: async () => {}, verifySessionIntegrity: async () => true,
    ...createLicenseStaffActions({ set, get }), ...createLicenseSyncActions({ set, get }),
    ...createLicenseMaintenanceActions({ set, get }),
    ...createLicenseRealtimeActions({ set, get, hasStaffValidationContext: async () => true })
  }));
  await state().startRealtimeSecurity();
});
afterEach(async () => { cleanup(); await state().stopLicenseSync(); vi.useRealTimers(); });
afterAll(async () => { await fixture.db.delete(); });

it('revokes and restores POS through the listener, verifier, store, runtime and route without login', async () => {
  render(<MemoryRouter><PermissionRoute permission="pos"><div>POS content</div></PermissionRoute></MemoryRouter>);
  expect(screen.getByText('POS content')).toBeTruthy();
  const original = actorRuntimeController.getState();
  const oldHandle = actorRuntimeController.capture('pos');
  fixture.rpc.mockResolvedValue(verified(false));
  await act(async () => { await event(); });
  expect(fixture.rpc).toHaveBeenCalledWith('verify_staff_session', expect.any(Object));
  expect(screen.queryByText('POS content')).toBeNull();
  expect(() => oldHandle.assertCurrent('pos')).toThrow();
  expect(actorRuntimeController.getState()).toMatchObject({ actorId: original.actorId, sessionId: original.sessionId,
    generation: original.generation, deviceRef: original.deviceRef, tenant: original.tenant, permissions: [] });
  fixture.rpc.mockResolvedValue(verified(true));
  await act(async () => { await event(); });
  expect(screen.getByText('POS content')).toBeTruthy();
  expect(() => actorRuntimeController.capture('settings')).toThrow();
  expect(state().currentDeviceRole).toBe('staff');
});

it('removes a revoked customer payment grant from the live Staff runtime', async () => {
  const captured = actorRuntimeController.capture();
  actorRuntimeController.refreshStaffPermissions({
    captured,
    actorId: 'staff-a',
    permissions: ['pos', 'customers', 'customer_payments']
  });
  fixture.store.setState({ currentStaffUser: {
    id: 'staff-a',
    permissions: { pos: true, customers: true, customer_payments: true }
  } });
  expect(() => actorRuntimeController.capture('customer_payments')).not.toThrow();

  fixture.rpc.mockResolvedValue({ data: {
    success: true,
    valid: true,
    staff_user: { id: 'staff-a', permissions: { pos: true, customers: true, customer_payments: false } }
  }, error: null });
  await act(async () => { await event(); });

  expect(state().currentStaffUser.permissions).toMatchObject({ customers: true, customer_payments: false });
  expect(actorRuntimeController.getState().permissions).toContain('customers');
  expect(actorRuntimeController.getState().permissions).not.toContain('customer_payments');
  expect(() => actorRuntimeController.capture('customer_payments')).toThrow();
});


it('keeps verified Staff grants when a shared-device license describes Admin or older permissions', async () => {
  fixture.store.setState({ licenseDetails: { ...state().licenseDetails, device_role: 'admin', staff_user: null } });
  const oldLicenseResponse = captureLicenseValidationContext(state());
  fixture.rpc.mockResolvedValue(verified(false));
  await event();
  expect(() => assertLicenseValidationContextCurrent(oldLicenseResponse, state())).toThrow();
  const reconciled = reconcileLicenseSessionIdentity(state(), state().licenseDetails, {
    device_role: 'admin', staff_user: { id: 'staff-a', permissions: { pos: true, settings: true } }
  });
  expect(reconciled).toMatchObject({ device_role: 'staff', staff_user: { permissions: { pos: false } }, admin_user: null });
  expect(actorRuntimeController.getState()).toMatchObject({ actorType: 'staff', actorId: 'staff-a', permissions: [] });
});

it('recovers a missed event on resume and bounds repeated checks independently of the license TTL', async () => {
  fixture.rpc.mockResolvedValue(verified(false));
  await event();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await state().performSystemHealthCheck('online');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  fixture.rpc.mockResolvedValue(verified(true));
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  await state().performSystemHealthCheck('visibility');
  await state().performSystemHealthCheck('online');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(90_001);
  await vi.waitFor(() => expect(state().currentStaffUser.permissions.pos).toBe(true));
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
});

it('keeps the actor and credentials on a temporary transport failure', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: new TypeError('Failed to fetch') });
  await event();
  expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorType: 'staff' });
  expect(state().appStatus).toBe('ready');
  expect((await fixture.db.table('sync_cache').get('staff_session_token')).value).toBe('staff-token');
});

it('uses the existing login recovery for an authoritatively deactivated Staff', async () => {
  fixture.rpc.mockResolvedValue({ data: { success: false, valid: false, code: 'STAFF_USER_INACTIVE' }, error: null });
  await event();
  expect(actorRuntimeController.getState().status).toBe('locked');
  expect(state().appStatus).toBe('staff_login_required');
  expect(state().currentStaffUser).toBeNull();
});

it.each(['actor', 'session', 'tenant', 'device', 'denied'])('discards a late response after changing %s', async change => {
  let resolve;
  fixture.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
  const request = event();
  await vi.waitFor(() => expect(fixture.rpc).toHaveBeenCalledTimes(1));
  if (change === 'device') {
    actorRuntimeController.lock('device_changed');
    actorRuntimeController.beginAuthentication({ actorType: 'staff' });
    actorRuntimeController.grant({ actorType: 'staff', actorId: 'staff-a', sessionId: 'session-a',
      deviceRef: 'different-device', permissions: ['pos'] });
  }
  else {
    if (change === 'tenant') fixture.tenant = { opaqueId: 'other', databaseName: 'other', generation: 2 };
    const id = change === 'session' ? 'staff-a' : 'staff-b';
    grant(id, 'replacement');
    fixture.store.setState({ currentStaffUser: { id, permissions: { pos: true } } });
    await fixture.db.table('sync_cache').put({ key: 'staff_session_id', value: 'replacement' });
  }
  await resolve(change === 'denied'
    ? { data: { success: false, valid: false, code: 'STAFF_USER_INACTIVE' }, error: null } : verified(false));
  await request;
  expect(state().currentStaffUser.permissions.pos).toBe(true);
  expect(actorRuntimeController.getState().permissions).toEqual(['pos']);
});

it('coalesces in-flight events and verifies again so a later restitution is not lost', async () => {
  let resolve;
  fixture.rpc.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue(verified(true));
  const first = event();
  await vi.waitFor(() => expect(fixture.rpc).toHaveBeenCalledTimes(1));
  const second = event();
  await new Promise(done => setTimeout(done, 0));
  resolve(verified(false));
  await Promise.all([first, second]);
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
  expect(state().currentStaffUser.permissions.pos).toBe(true);
});

it('leaves legitimate Admin authority unchanged without invoking the Staff verifier', async () => {
  actorRuntimeController.lock('test_admin');
  actorRuntimeController.beginAuthentication({ actorType: 'admin' });
  actorRuntimeController.grant({ actorType: 'admin', actorId: 'owner', sessionId: 'admin-session', deviceRef: 'device-a',
    authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString() });
  fixture.store.setState({ currentDeviceRole: 'admin', currentStaffUser: null, currentAdminUser: { id: 'owner' } });
  const original = actorRuntimeController.getState();
  await event();
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(actorRuntimeController.getState()).toEqual(original);
});


it('verifies Staff on resume when the Realtime channel is unavailable', async () => {
  fixture.store.setState({ realtimeSubscription: null, licenseSyncMode: 'hybrid_polling' });
  fixture.rpc.mockResolvedValue(verified(false));
  await state().performSystemHealthCheck('visibility');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect(state().currentDeviceRole).toBe('staff');
  expect(() => actorRuntimeController.capture('pos')).toThrow();
});


it('does not publish a stale grant when a newer signal arrived during verification', async () => {
  fixture.rpc.mockResolvedValue(verified(false));
  await event();
  let resolve;
  fixture.rpc.mockReset().mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue(verified(false));
  const updates = [];
  const unsubscribe = actorRuntimeController.subscribe(snapshot => updates.push(snapshot.permissions));
  try {
    const first = event();
    await vi.waitFor(() => expect(fixture.rpc).toHaveBeenCalledTimes(1));
    const second = event();
    await new Promise(done => setTimeout(done, 0));
    resolve(verified(true));
    await Promise.all([first, second]);
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(updates.every(permissions => !permissions.includes('pos'))).toBe(true);
    expect(state().currentStaffUser.permissions.pos).toBe(false);
  } finally { unsubscribe(); }
});
