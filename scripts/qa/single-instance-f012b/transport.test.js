/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fingerprintLoad: vi.fn(),
  fingerprintGet: vi.fn(),
  rpc: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  checkInternetConnection: vi.fn(),
  readDeviceRegistryValue: vi.fn(),
  writeDeviceRegistryValue: vi.fn(),
  getLicenseFromStorage: vi.fn(),
  getLocalTenantBinding: vi.fn()
}));

vi.mock('@fingerprintjs/fingerprintjs', () => ({
  default: { load: mocks.fingerprintLoad }
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mocks.rpc })
}));

vi.mock('../../../src/services/database', () => ({
  STORES: { SYNC_CACHE: 'sync_cache' },
  loadData: mocks.loadData,
  saveData: mocks.saveData
}));

vi.mock('../../../src/services/device/deviceRegistry', () => ({
  DEVICE_REGISTRY_KEYS: {
    STABLE_DEVICE_ID: 'lanzo_device_id',
    LICENSE_ATTEMPTS: 'lanzo_license_attempts'
  },
  readDeviceRegistryValue: mocks.readDeviceRegistryValue,
  writeDeviceRegistryValue: mocks.writeDeviceRegistryValue
}));

vi.mock('../../../src/services/db/tenantRuntimeRouter', () => ({
  db: { table: () => ({ get: async () => null }) },
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: { opaqueId: 'tenant-fixture', databaseName: 'LanzoDB_fixture', generation: 1 } }),
  getActiveTenantRuntime: () => ({ opaqueId: 'tenant-fixture', databaseName: 'LanzoDB_fixture', generation: 1 })
}));

vi.mock('../../../src/services/licenseStorage', () => ({
  getLicenseFromStorage: mocks.getLicenseFromStorage
}));

vi.mock('../../../src/services/utils', () => ({
  safeLocalStorageSet: (key, value) => localStorage.setItem(key, value),
  checkInternetConnection: mocks.checkInternetConnection
}));

vi.mock('../../../src/services/Logger', () => ({
  default: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../src/services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(),
  isLocalTenantAccessError: () => false,
  getLocalTenantBinding: mocks.getLocalTenantBinding,
  runWithLocalTenantSyncLease: vi.fn()
}));


import { createBootstrapLifecycle, installTraceRecorder } from './trace.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'synthetic-public-key');
  mocks.checkInternetConnection.mockResolvedValue(true);
  mocks.readDeviceRegistryValue.mockImplementation(async key => key === 'lanzo_device_id' ? 'fixture-device' : null);
  mocks.loadData.mockImplementation(async (_store, key) => key === 'device_security_token' ? { value: 'synthetic-token' } : null);
  mocks.saveData.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('BG-41 real revalidateLicense retains raw transport beyond its internal timeout', async () => {
  const { revalidateLicense } = await import('../../../src/services/supabase');
  const { runWithLocalTenantSyncLease } = await import('../../../src/services/tenant/localTenantGuard');
  runWithLocalTenantSyncLease.mockImplementation(async (_license, _options, run) => run());
  const pending = deferred(), lifecycle = createBootstrapLifecycle(); mocks.rpc.mockReturnValue(pending.promise);
  const publicResult = revalidateLicense('synthetic-transport', { bootstrapLifecycle: lifecycle });
  await vi.advanceTimersByTimeAsync(0); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(8000); await publicResult;
  expect(lifecycle.getSnapshot().pending).toBe(1);
  lifecycle.quiesce(); pending.reject(new Error('late synthetic transport failure'));
  await lifecycle.drain(); expect(lifecycle.getSnapshot()).toMatchObject({ pending: 0, rejected: 1 });
});
it('BG-42 shared revalidation owner remains unknown instead of false drain', async () => {
  const { revalidateLicense } = await import('../../../src/services/supabase');
  const { runWithLocalTenantSyncLease } = await import('../../../src/services/tenant/localTenantGuard');
  runWithLocalTenantSyncLease.mockImplementation(async (_license, _options, run) => run());
  const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
  const first = revalidateLicense('synthetic-shared'); await vi.advanceTimersByTimeAsync(0);
  const lifecycle = createBootstrapLifecycle(); const second = revalidateLicense('synthetic-shared', { bootstrapLifecycle: lifecycle });
  expect(lifecycle.getSnapshot().unknown).toEqual(['shared_license_revalidation_owner']);
  pending.resolve({ data: { valid: false, reason: 'synthetic' }, error: null }); await Promise.all([first, second]);
  await expect(revalidateLicense('synthetic-null-options', null)).resolves.toMatchObject({ valid: false });
});

installTraceRecorder('transport', { metrics: () => ({ rpcStarts: mocks.rpc.mock.calls.length }) });
