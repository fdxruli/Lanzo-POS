/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fingerprintLoad: vi.fn(),
  fingerprintGet: vi.fn(),
  rpc: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  checkInternetConnection: vi.fn(),
  readDeviceRegistryValue: vi.fn(),
  writeDeviceRegistryValue: vi.fn()
}));

vi.mock('@fingerprintjs/fingerprintjs', () => ({
  default: { load: mocks.fingerprintLoad }
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mocks.rpc })
}));

vi.mock('../database', () => ({
  STORES: { SYNC_CACHE: 'sync_cache' },
  loadData: mocks.loadData,
  saveData: mocks.saveData
}));

vi.mock('../device/deviceRegistry', () => ({
  DEVICE_REGISTRY_KEYS: {
    STABLE_DEVICE_ID: 'lanzo_device_id',
    LICENSE_ATTEMPTS: 'lanzo_license_attempts'
  },
  readDeviceRegistryValue: mocks.readDeviceRegistryValue,
  writeDeviceRegistryValue: mocks.writeDeviceRegistryValue
}));

vi.mock('../utils', () => ({
  safeLocalStorageSet: (key, value) => localStorage.setItem(key, value),
  checkInternetConnection: mocks.checkInternetConnection
}));

vi.mock('../Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(),
  isLocalTenantAccessError: () => false,
  runWithLocalTenantSyncLease: vi.fn()
}));

describe('activation storage boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.fingerprintGet.mockResolvedValue({ visitorId: 'fingerprint-fresh' });
    mocks.fingerprintLoad.mockResolvedValue({ get: mocks.fingerprintGet });
    mocks.rpc.mockResolvedValue({ data: { success: false, code: 'LICENSE_NOT_FOUND' }, error: null });
    mocks.readDeviceRegistryValue.mockRejectedValue(new Error('forced registry read failure'));
    mocks.writeDeviceRegistryValue.mockRejectedValue(new Error('forced registry write failure'));
  });

  it('keeps registry failures best-effort when the centralized native IndexedDB probe succeeds', async () => {
    const { activateLicense } = await import('../supabase');

    await expect(activateLicense('LANZO-REGISTRY-BEST-EFFORT')).resolves.toMatchObject({
      valid: false,
      code: 'LICENSE_NOT_FOUND'
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.fingerprintGet).toHaveBeenCalledTimes(1);
  });
});
