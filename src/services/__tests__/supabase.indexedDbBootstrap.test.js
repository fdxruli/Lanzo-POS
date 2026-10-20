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
  writeDeviceRegistryValue: vi.fn(),
  getLicenseFromStorage: vi.fn()
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

vi.mock('../db/tenantRuntimeRouter', () => ({
  db: { table: () => ({ get: async () => null }) },
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: { opaqueId: 'tenant-fixture', databaseName: 'LanzoDB_fixture', generation: 1 } }),
  getActiveTenantRuntime: () => ({ opaqueId: 'tenant-fixture', databaseName: 'LanzoDB_fixture', generation: 1 })
}));

vi.mock('../licenseStorage', () => ({
  getLicenseFromStorage: mocks.getLicenseFromStorage
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
  getLocalTenantBinding: vi.fn(async () => ({ tenantAliases: ['license-id:fixture-license'] })),
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
  it('returns canonical Admin session/device evidence without exposing the session token', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) }
    });
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    mocks.rpc.mockResolvedValue({ data: {
      success: true, admin_user: { id: 'fixture-admin' }, admin_session_id: 'fixture-session',
      admin_user_id: 'fixture-admin', license_id: 'fixture-license',
      admin_session_token: 'fixture-token', device_id: 'fixture-device-row',
      device_security_token: 'fixture-device-token',
      admin_session_expires_at: '2030-01-01T00:00:00Z', details: { license_key: 'QA-AUTH-CONTRACT' }
    }, error: null });
    const { adminLoginOnDevice } = await import('../supabase');
    const result = await adminLoginOnDevice({ licenseKey: 'QA-AUTH-CONTRACT', username: 'owner', password: 'fixture-only', beforeLocalPersistence: vi.fn() });
    expect(result).toMatchObject({ success: true, session: { id: 'fixture-session' }, device_id: 'fixture-device-row' });
    expect(result).not.toHaveProperty('admin_session_token');
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'admin_session_id', value: 'fixture-session' });
    const savedProof = mocks.saveData.mock.calls
      .map(([, record]) => record)
      .find((record) => record?.key === 'last_valid_admin_session')?.value;
    expect(savedProof).toMatchObject({
      version: 2,
      sessionId: 'fixture-session',
      adminUserId: 'fixture-admin',
      licenseId: 'fixture-license',
      deviceId: 'fixture-device-row',
      deviceRef: 'fixture-device',
      tenantOpaqueId: 'tenant-fixture'
    });
    expect(savedProof).not.toHaveProperty('sessionTokenDigest', 'fixture-token');
  });

  it('does not persist credentials for an explicit valid:false RPC denial', async () => {
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    mocks.rpc.mockResolvedValue({ data: { success: true, valid: false, code: 'ADMIN_SESSION_INVALID', admin_session_token: 'rejected-token' }, error: null });
    const beforeLocalPersistence = vi.fn();
    const { adminLoginOnDevice } = await import('../supabase');
    expect(await adminLoginOnDevice({ licenseKey: 'QA-AUTH-CONTRACT', username: 'owner', password: 'fixture-only', beforeLocalPersistence })).toMatchObject({ success: false, code: 'ADMIN_SESSION_INVALID' });
    expect(beforeLocalPersistence).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('preserves Admin credentials when the verification RPC cannot be reached', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = {
      device_security_token: 'device-token',
      admin_session_token: 'admin-token',
      admin_session_id: 'admin-session-id'
    };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    mocks.rpc.mockResolvedValue({ data: null, error: new TypeError('Failed to fetch') });

    const { verifyAdminSession } = await import('../supabase');
    await expect(verifyAdminSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      success: false,
      valid: false,
      verificationStatus: 'transport_unavailable'
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(values).toEqual({
      device_security_token: 'device-token',
      admin_session_token: 'admin-token',
      admin_session_id: 'admin-session-id'
    });
  });

  it.each([
    [{ status: 503, code: 'PGRST000' }, 'server_error'],
    [{ status: 429, code: 'PGRST003' }, 'server_error'],
    [{ status: 401, code: 'PGRST301' }, 'server_error'],
    [new DOMException('request aborted', 'AbortError'), 'transport_unavailable']
  ])('preserves Admin credentials for technical RPC failure %o', async (error, verificationStatus) => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    mocks.loadData.mockImplementation(async (_store, key) => ({
      value: {
        device_security_token: 'device-token',
        admin_session_token: 'admin-token',
        admin_session_id: 'admin-session-id'
      }[key] || null
    }));
    mocks.rpc.mockResolvedValue({ data: null, error });

    const { verifyAdminSession } = await import('../supabase');
    await expect(verifyAdminSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      verificationStatus,
      valid: false
    });
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('clears both exclusive-role caches only for a recognized authoritative session denial', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = {
      device_security_token: 'device-token',
      admin_session_token: 'admin-token',
      admin_session_id: 'admin-session-id',
      staff_session_token: 'stale-staff-token',
      staff_session_id: 'stale-staff-session-id'
    };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    mocks.rpc.mockResolvedValue({
      data: { success: false, valid: false, code: 'ADMIN_SESSION_EXPIRED' },
      error: null
    });

    const { verifyAdminSession } = await import('../supabase');
    await expect(verifyAdminSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      verificationStatus: 'authoritative_denial',
      code: 'ADMIN_SESSION_EXPIRED',
      sessionCredentialCleared: true
    });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'admin_session_token', value: null });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'admin_session_id', value: null });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'staff_session_token', value: null });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'staff_session_id', value: null });
  });

  it('reports local storage failure separately and does not call the RPC', async () => {
    mocks.loadData.mockRejectedValue(new Error('fixture storage read failure'));
    const { verifyAdminSession } = await import('../supabase');

    await expect(verifyAdminSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      verificationStatus: 'local_storage_error',
      valid: false
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('does not clear Admin credentials replaced while an authoritative response was in flight', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = {
      device_security_token: 'device-token',
      admin_session_token: 'admin-token-old',
      admin_session_id: 'admin-session-old'
    };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    let resolveRpc;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveRpc = resolve; }));

    const { verifyAdminSession } = await import('../supabase');
    const verification = verifyAdminSession('QA-AUTH-CONTRACT');
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    values.admin_session_token = 'admin-token-new';
    values.admin_session_id = 'admin-session-new';
    resolveRpc({ data: { success: false, valid: false, code: 'ADMIN_SESSION_EXPIRED' }, error: null });

    await expect(verification).rejects.toMatchObject({
      code: 'SESSION_VERIFICATION_CONTEXT_STALE'
    });
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(values).toMatchObject({
      admin_session_token: 'admin-token-new',
      admin_session_id: 'admin-session-new'
    });
  });

  it('does not clear either role when a new Staff session replaces the cross-role snapshot', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = {
      device_security_token: 'device-token',
      admin_session_token: 'admin-token-old',
      admin_session_id: 'admin-session-old',
      staff_session_token: 'staff-token-old',
      staff_session_id: 'staff-session-old'
    };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    let resolveRpc;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveRpc = resolve; }));

    const { verifyAdminSession } = await import('../supabase');
    const verification = verifyAdminSession('QA-AUTH-CONTRACT');
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    values.staff_session_token = 'staff-token-new';
    values.staff_session_id = 'staff-session-new';
    resolveRpc({ data: { success: false, valid: false, code: 'ADMIN_SESSION_EXPIRED' }, error: null });

    await expect(verification).rejects.toMatchObject({ code: 'SESSION_VERIFICATION_CONTEXT_STALE' });
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(values).toMatchObject({
      admin_session_token: 'admin-token-old',
      staff_session_token: 'staff-token-new',
      staff_session_id: 'staff-session-new'
    });
  });

  it('keeps Staff credentials on a transport failure and continues to require online verification', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    mocks.loadData.mockImplementation(async (_store, key) => (
      key === 'staff_session_token' ? { value: 'staff-token' } : null
    ));
    mocks.rpc.mockResolvedValue({ data: null, error: new TypeError('Failed to fetch') });

    const { verifyStaffSession } = await import('../supabase');
    await expect(verifyStaffSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      verificationStatus: 'transport_unavailable',
      valid: false
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.saveData).not.toHaveBeenCalled();

    mocks.rpc.mockClear();
    mocks.checkInternetConnection.mockResolvedValue(false);
    await expect(verifyStaffSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      verificationStatus: 'transport_unavailable',
      valid: false
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('clears both unchanged role caches on authoritative Staff denial and marks cleanup complete', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = {
      staff_session_token: 'staff-token',
      staff_session_id: 'staff-session-id',
      admin_session_token: 'stale-admin-token',
      admin_session_id: 'stale-admin-session-id'
    };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    mocks.rpc.mockResolvedValue({
      data: { success: false, valid: false, code: 'SESSION_EXPIRED' },
      error: null
    });

    const { verifyStaffSession } = await import('../supabase');
    await expect(verifyStaffSession('QA-AUTH-CONTRACT')).resolves.toMatchObject({
      verificationStatus: 'authoritative_denial',
      code: 'SESSION_EXPIRED',
      sessionCredentialCleared: true
    });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'staff_session_token', value: null });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'staff_session_id', value: null });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'admin_session_token', value: null });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', { key: 'admin_session_id', value: null });
  });

  it('does not clear Staff credentials replaced while an authoritative response was in flight', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = { staff_session_token: 'staff-token-old', staff_session_id: 'staff-session-old' };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    let resolveRpc;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveRpc = resolve; }));

    const { verifyStaffSession } = await import('../supabase');
    const verification = verifyStaffSession('QA-AUTH-CONTRACT');
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    values.staff_session_token = 'staff-token-new';
    values.staff_session_id = 'staff-session-new';
    resolveRpc({ data: { success: false, valid: false, code: 'SESSION_EXPIRED' }, error: null });

    await expect(verification).resolves.toMatchObject({
      verificationStatus: 'invalid_response',
      code: 'SESSION_VERIFICATION_CONTEXT_STALE'
    });
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(values).toEqual({ staff_session_token: 'staff-token-new', staff_session_id: 'staff-session-new' });
  });

  it('does not clear either role when a new Admin session replaces the cross-role snapshot', async () => {
    const { runWithLocalTenantSyncLease } = await import('../tenant/localTenantGuard');
    vi.mocked(runWithLocalTenantSyncLease).mockImplementation(async (_source, _options, operation) => operation());
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.readDeviceRegistryValue.mockResolvedValue('fixture-device');
    const values = {
      staff_session_token: 'staff-token-old',
      staff_session_id: 'staff-session-old',
      admin_session_token: 'admin-token-old',
      admin_session_id: 'admin-session-old'
    };
    mocks.loadData.mockImplementation(async (_store, key) => (
      Object.hasOwn(values, key) ? { value: values[key] } : null
    ));
    let resolveRpc;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveRpc = resolve; }));

    const { verifyStaffSession } = await import('../supabase');
    const verification = verifyStaffSession('QA-AUTH-CONTRACT');
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    values.admin_session_token = 'admin-token-new';
    values.admin_session_id = 'admin-session-new';
    resolveRpc({ data: { success: false, valid: false, code: 'SESSION_EXPIRED' }, error: null });

    await expect(verification).resolves.toMatchObject({
      verificationStatus: 'invalid_response',
      code: 'SESSION_VERIFICATION_CONTEXT_STALE'
    });
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(values).toEqual({
      staff_session_token: 'staff-token-old',
      staff_session_id: 'staff-session-old',
      admin_session_token: 'admin-token-new',
      admin_session_id: 'admin-session-new'
    });
  });

  it('does not treat the legacy timestamp-only cache as Admin offline authority', async () => {
    const { hasValidOfflineAdminSession } = await import('../supabase');
    const now = Date.parse('2026-10-19T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    mocks.loadData.mockImplementation(async (_store, key) => (
      key === 'last_valid_admin_session'
        ? { value: { validatedAt: now - 60_000, expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString() } }
        : null
    ));

    await expect(hasValidOfflineAdminSession()).resolves.toBe(false);
  });

});
