/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  readDeviceRegistryValue: vi.fn(),
  writeDeviceRegistryValue: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mocks.rpc })
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
  safeLocalStorageSet: (key, value) => localStorage.setItem(key, value),
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

const setSessionCache = ({
  actorType = 'admin',
  actorToken = `${actorType}-token`,
  sessionId = `${actorType}-session`,
  oppositeToken = null,
  oppositeSessionId = null
} = {}) => {
  const selectedPrefix = actorType;
  const oppositePrefix = actorType === 'admin' ? 'staff' : 'admin';
  const values = {
    device_security_token: 'device-security-token',
    [`${selectedPrefix}_session_token`]: actorToken,
    [`${selectedPrefix}_session_id`]: sessionId,
    [`${oppositePrefix}_session_token`]: oppositeToken,
    [`${oppositePrefix}_session_id`]: oppositeSessionId
  };
  mocks.loadData.mockImplementation(async (_store, key) => (
    values[key] === undefined || values[key] === null ? null : { key, value: values[key] }
  ));
};

const createActorHandle = (actorType = 'admin', sessionId = `${actorType}-session`) => ({
  actorType,
  sessionId,
  assertCurrent: vi.fn(() => ({ actorType, sessionId }))
});

const importSupabase = async () => {
  vi.resetModules();
  return import('../supabase');
};

describe('saveBusinessProfile actor binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    localStorage.clear();
    mocks.readDeviceRegistryValue.mockResolvedValue('device-fingerprint');
    mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it.each(['admin', 'staff'])('sends the captured %s session token in the unique five-argument RPC payload', async (actorType) => {
    setSessionCache({ actorType });
    const actorHandle = createActorHandle(actorType);
    const { saveBusinessProfile } = await importSupabase();

    await expect(saveBusinessProfile('LANZO-PROFILE', {
      name: 'Actor profile',
      phone: '555',
      address: 'Address',
      business_type: ['hardware']
    }, { actorHandle })).resolves.toEqual({ success: true });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('save_business_profile_secure', {
      license_key_param: 'LANZO-PROFILE',
      device_fingerprint_param: 'device-fingerprint',
      security_token_param: 'device-security-token',
      actor_session_token_param: `${actorType}-token`,
      profile_data: {
        name: 'Actor profile',
        phone: '555',
        address: 'Address',
        logo_url: '',
        business_type: ['hardware']
      }
    });
    expect(actorHandle.assertCurrent).toHaveBeenCalledWith('settings');
  });

  it('fails closed without a captured actor and never calls the RPC', async () => {
    setSessionCache();
    const { saveBusinessProfile } = await importSupabase();

    await expect(saveBusinessProfile('LANZO-PROFILE', {
      name: 'Missing actor', business_type: ['hardware']
    })).resolves.toMatchObject({ success: false, code: 'ACTOR_SESSION_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when both credential families remain cached', async () => {
    setSessionCache({ oppositeToken: 'residual-staff-token', oppositeSessionId: 'staff-session' });
    const { saveBusinessProfile } = await importSupabase();

    await expect(saveBusinessProfile('LANZO-PROFILE', {
      name: 'Ambiguous actor', business_type: ['hardware']
    }, { actorHandle: createActorHandle('admin') })).resolves.toMatchObject({
      success: false,
      code: 'ACTOR_SESSION_AMBIGUOUS'
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a persisted session id that does not match the captured actor handle', async () => {
    setSessionCache({ actorType: 'staff', sessionId: 'new-staff-session' });
    const { saveBusinessProfile } = await importSupabase();

    await expect(saveBusinessProfile('LANZO-PROFILE', {
      name: 'Cross binding', business_type: ['hardware']
    }, { actorHandle: createActorHandle('staff', 'captured-staff-session') })).resolves.toMatchObject({
      success: false,
      code: 'ACTOR_CONTEXT_STALE'
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('revalidates the handle immediately before RPC dispatch', async () => {
    setSessionCache();
    const actorHandle = createActorHandle('admin');
    const stale = Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
    actorHandle.assertCurrent
      .mockImplementationOnce(() => ({}))
      .mockImplementationOnce(() => ({}))
      .mockImplementationOnce(() => { throw stale; });
    const { saveBusinessProfile } = await importSupabase();

    await expect(saveBusinessProfile('LANZO-PROFILE', {
      name: 'Stale actor', business_type: ['hardware']
    }, { actorHandle })).resolves.toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not accept a successful callback after the captured actor becomes stale', async () => {
    setSessionCache();
    const actorHandle = createActorHandle('admin');
    const stale = Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
    actorHandle.assertCurrent
      .mockImplementationOnce(() => ({}))
      .mockImplementationOnce(() => ({}))
      .mockImplementationOnce(() => ({}))
      .mockImplementationOnce(() => { throw stale; });
    const { saveBusinessProfile } = await importSupabase();

    await expect(saveBusinessProfile('LANZO-PROFILE', {
      name: 'Late callback', business_type: ['hardware']
    }, { actorHandle })).resolves.toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
