/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fingerprintLoad: vi.fn(),
  fingerprintGet: vi.fn(),
  rpc: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  checkInternetConnection: vi.fn(),
  localTenantAccessController: null
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

const freshModules = async () => {
  const currentRegistry = await import('../device/deviceRegistry');
  currentRegistry.closeDeviceRegistry();
  await Dexie.delete(currentRegistry.DEVICE_REGISTRY_DATABASE_NAME);
  vi.resetModules();
  return {
    registry: await import('../device/deviceRegistry'),
    supabase: await import('../supabase')
  };
};

describe('pre-tenant device registry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    mocks.fingerprintGet.mockResolvedValue({ visitorId: 'fingerprint-fresh' });
    mocks.fingerprintLoad.mockResolvedValue({ get: mocks.fingerprintGet });
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: { success: false, code: 'LICENSE_NOT_FOUND' }, error: null });
  });

  afterEach(async () => {
    const registry = await import('../device/deviceRegistry');
    registry.closeDeviceRegistry();
    await Dexie.delete(registry.DEVICE_REGISTRY_DATABASE_NAME);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('prewarms a localStorage device ID without any tenant sync_cache access', async () => {
    localStorage.setItem('lanzo_device_id', 'existing-device-id');
    const { registry, supabase } = await freshModules();
    const open = vi.spyOn(Dexie.prototype, 'open');

    await expect(supabase.getStableDeviceId()).resolves.toBe('existing-device-id');
    await expect(registry.readDeviceRegistryValue('lanzo_device_id')).resolves.toBe('existing-device-id');
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(open.mock.contexts.map((database) => database.name)).toEqual([
      'LanzoDeviceRegistry'
    ]);
  });

  it('recovers the registry authority and repairs a missing localStorage mirror', async () => {
    const { registry, supabase } = await freshModules();
    await registry.writeDeviceRegistryValue('lanzo_device_id', 'registry-device-id');

    await expect(supabase.getStableDeviceId()).resolves.toBe('registry-device-id');
    expect(localStorage.getItem('lanzo_device_id')).toBe('registry-device-id');
    expect(mocks.fingerprintLoad).not.toHaveBeenCalled();
  });

  it('uses the registry deterministically when registry and localStorage disagree', async () => {
    const { registry, supabase } = await freshModules();
    localStorage.setItem('lanzo_device_id', 'stale-local-id');
    await registry.writeDeviceRegistryValue('lanzo_device_id', 'registry-authority-id');

    await expect(supabase.getStableDeviceId()).resolves.toBe('registry-authority-id');
    expect(localStorage.getItem('lanzo_device_id')).toBe('registry-authority-id');
    expect(mocks.fingerprintLoad).not.toHaveBeenCalled();
  });

  it('generates one fresh ID and persists it to the two device-owned surfaces', async () => {
    const { registry, supabase } = await freshModules();

    await expect(supabase.getStableDeviceId()).resolves.toBe('fingerprint-fresh');
    await expect(supabase.getStableDeviceId()).resolves.toBe('fingerprint-fresh');
    expect(localStorage.getItem('lanzo_device_id')).toBe('fingerprint-fresh');
    await expect(registry.readDeviceRegistryValue('lanzo_device_id')).resolves.toBe('fingerprint-fresh');
    expect(mocks.fingerprintLoad).toHaveBeenCalledTimes(1);
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('keeps the exact stable device ID through A-to-B-to-A tenant transitions', async () => {
    const { supabase } = await freshModules();

    const idForTenantA = await supabase.getStableDeviceId();
    const idForTenantB = await supabase.getStableDeviceId();
    const idBackOnTenantA = await supabase.getStableDeviceId();

    expect([idForTenantA, idForTenantB, idBackOnTenantA]).toEqual([
      'fingerprint-fresh',
      'fingerprint-fresh',
      'fingerprint-fresh'
    ]);
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('keeps failed activation rate limiting available before tenant resolution', async () => {
    const { registry, supabase } = await freshModules();

    await expect(supabase.activateLicense('LANZO-NOT-FOUND')).resolves.toMatchObject({ valid: false });

    // A browser restart and a tenant switch must not clear this device-owned
    // counter. Re-importing is the closest deterministic restart boundary in
    // the browser test environment.
    registry.closeDeviceRegistry();
    vi.resetModules();
    const resumedRegistry = await import('../device/deviceRegistry');
    const resumedSupabase = await import('../supabase');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(resumedSupabase.activateLicense('LANZO-NOT-FOUND')).resolves.toMatchObject({ valid: false });
    }

    await expect(resumedSupabase.activateLicense('LANZO-NOT-FOUND')).resolves.toMatchObject({
      valid: false,
      message: expect.stringContaining('Demasiados intentos')
    });
    await expect(resumedRegistry.readDeviceRegistryValue('lanzo_license_attempts')).resolves.toMatchObject({
      attempts: 5,
      lockedUntil: expect.any(Number)
    });
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('blocks activation locally before the RPC when browser IndexedDB is unavailable', async () => {
    const { supabase } = await freshModules();
    const nativeError = new DOMException('Internal error.', 'UnknownError');
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => { throw nativeError; })
    });

    try {
      await expect(supabase.activateLicense('LANZO-IDB-UNAVAILABLE')).rejects.toMatchObject({
        name: 'BrowserStorageUnavailableError',
        code: 'DB_BROWSER_STORAGE_UNAVAILABLE',
        cause: nativeError
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps activation available when persistence is denied but IndexedDB works', async () => {
    const { supabase } = await freshModules();
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn().mockResolvedValue(false) }
    });

    try {
      await expect(supabase.activateLicense('LANZO-PERSISTENCE-DENIED')).resolves.toMatchObject({
        valid: false,
        code: 'LICENSE_NOT_FOUND'
      });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
      else delete navigator.storage;
    }
  });

  it('rejects every key and value outside the closed device-owned allowlist', async () => {
    const { registry } = await freshModules();

    await expect(registry.writeDeviceRegistryValue('license_key', 'secret')).rejects
      .toThrow('DEVICE_REGISTRY_KEY_NOT_ALLOWED');
    await expect(registry.writeDeviceRegistryValue('lanzo_license_attempts', {
      attempts: 1,
      lockedUntil: null,
      tenantId: 'forbidden'
    })).rejects.toThrow('DEVICE_REGISTRY_LICENSE_ATTEMPTS_INVALID');
  });
});
