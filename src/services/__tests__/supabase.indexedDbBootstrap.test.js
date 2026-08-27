/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_RECOVERY_CODES } from '../db/databaseRecoveryState';

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
    localStorage.clear();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.fingerprintGet.mockResolvedValue({ visitorId: 'fingerprint-fresh' });
    mocks.fingerprintLoad.mockResolvedValue({ get: mocks.fingerprintGet });
    mocks.rpc.mockResolvedValue({ data: { success: false, code: 'LICENSE_NOT_FOUND' }, error: null });
    mocks.readDeviceRegistryValue.mockRejectedValue(new Error('forced registry read failure'));
    mocks.writeDeviceRegistryValue.mockRejectedValue(new Error('forced registry write failure'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('fails free-license creation before registry access or RPC when native IndexedDB is unavailable', async () => {
    const { createFreeTrial } = await import('../supabase');
    const nativeError = new DOMException('Internal error.', 'UnknownError');
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => { throw nativeError; })
    });

    try {
      await expect(createFreeTrial()).rejects.toMatchObject({
        name: 'BrowserStorageUnavailableError',
        code: DATABASE_RECOVERY_CODES.BROWSER_STORAGE_UNAVAILABLE,
        cause: nativeError
      });
      expect(mocks.readDeviceRegistryValue).not.toHaveBeenCalled();
      expect(mocks.fingerprintLoad).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('orders the free-license preflight before rate limit, stable identity, and RPC', async () => {
    const { createFreeTrial } = await import('../supabase');
    const events = [];
    const nativeOpen = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      events.push('preflight');
      return nativeOpen(...args);
    });
    mocks.readDeviceRegistryValue.mockImplementation(async (key) => {
      events.push(key === 'lanzo_license_attempts' ? 'rate-limit' : 'stable-id');
      return null;
    });
    mocks.rpc.mockImplementation(async () => {
      events.push('rpc');
      return {
        data: {
          success: true,
          details: {
            license_key: 'LANZO-FREE-ORDER',
            security_token: 'token-order'
          }
        },
        error: null
      };
    });

    await expect(createFreeTrial()).resolves.toMatchObject({ success: true });
    expect(events).toEqual(['preflight', 'rate-limit', 'stable-id', 'rpc']);
  });

  it('keeps free-license creation available when persistence is denied but IndexedDB works', async () => {
    const { createFreeTrial } = await import('../supabase');
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn().mockResolvedValue(false) }
    });
    mocks.rpc.mockResolvedValue({
      data: {
        success: true,
        details: {
          license_key: 'LANZO-FREE-PERSISTENCE-DENIED',
          security_token: 'token-persistence-denied'
        }
      },
      error: null
    });

    try {
      await expect(createFreeTrial()).resolves.toMatchObject({ success: true });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
      else delete navigator.storage;
    }
  });
});
