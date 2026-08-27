/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  readDeviceRegistryValue: vi.fn(),
  writeDeviceRegistryValue: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient
}));

vi.mock('@fingerprintjs/fingerprintjs', () => ({
  default: { load: vi.fn() }
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
  safeLocalStorageSet: vi.fn(),
  checkInternetConnection: vi.fn(async () => true)
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

vi.mock('../auth/actorRuntimeController', () => {
  class ActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }

  return {
    ActorRuntimeError,
    ACTOR_RUNTIME_ERROR_CODES: {
      SESSION_REQUIRED: 'ACTOR_SESSION_REQUIRED',
      CONTEXT_STALE: 'ACTOR_CONTEXT_STALE'
    }
  };
});

const client = {
  rpc: mocks.rpc,
  channel: vi.fn(),
  removeChannel: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() }
};

const importFresh = async (path) => {
  vi.resetModules();
  return import(path);
};

describe('Supabase client configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    mocks.createClient.mockReturnValue(client);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('disables unused GoTrue browser session behavior on the main client', async () => {
    const { supabaseClient } = await importFresh('../supabase');

    expect(supabaseClient).toBe(client);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-publishable-key',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );
  });

  it('keeps the public store client on its existing isolated auth configuration', async () => {
    const {
      supabasePublicClient,
      SUPABASE_PUBLIC_AUTH_OPTIONS
    } = await importFresh('../supabasePublic');

    expect(supabasePublicClient).toBe(client);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-publishable-key',
      { auth: SUPABASE_PUBLIC_AUTH_OPTIONS }
    );
    expect(SUPABASE_PUBLIC_AUTH_OPTIONS).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'lanzo-public-store-auth'
    });
  });
});
