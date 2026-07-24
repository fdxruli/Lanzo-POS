import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  activateLicense: vi.fn(),
  adminLoginOnDevice: vi.fn(),
  adminLogoutSession: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  enrollAdminOwnerOnDevice: vi.fn()
}));
const storageMocks = vi.hoisted(() => ({ saveLicenseToStorage: vi.fn() }));
const runtimeMocks = vi.hoisted(() => ({ ensureLocalDatabaseReady: vi.fn() }));

vi.mock('../../../../services/supabase', () => supabaseMocks);
vi.mock('../../../../services/licenseStorage', () => storageMocks);
vi.mock('../../../../services/db/databaseRuntime', () => runtimeMocks);

import { createLicenseAdminActions } from '../licenseAdminActions';
import { clearDatabaseRecoveryState } from '../../../../services/db/databaseRecoveryState';

const createHarness = () => {
  const state = {
    licenseDetails: { license_key: 'LIC-1' },
    adminLoginLicenseKey: 'LIC-1',
    _loadProfile: vi.fn().mockResolvedValue({ id: 'profile' }),
    stopLicenseSync: vi.fn(),
    _processOfflineMode: vi.fn()
  };
  const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  const get = () => state;
  Object.assign(state, createLicenseAdminActions({ set, get }));
  return state;
};

beforeEach(() => {
  vi.clearAllMocks();
  clearDatabaseRecoveryState();
  supabaseMocks.clearStaffSessionCache.mockResolvedValue(undefined);
  storageMocks.saveLicenseToStorage.mockResolvedValue(undefined);
  runtimeMocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
});

describe('admin session local recovery', () => {
  it('keeps a valid remote session and reuses it after UpgradeError', async () => {
    const remoteResult = {
      success: true,
      details: { license_key: 'LIC-1', plan_code: 'pro' },
      admin_user: { id: 'admin-1' }
    };
    supabaseMocks.adminLoginOnDevice.mockResolvedValue(remoteResult);
    const upgradeError = new Error('Not yet support for changing primary key');
    upgradeError.name = 'UpgradeError';
    runtimeMocks.ensureLocalDatabaseReady.mockRejectedValueOnce(upgradeError);
    const state = createHarness();

    const first = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(first).toMatchObject({
      success: false,
      remoteAuthenticated: true,
      localRecoveryRequired: true
    });
    expect(state.currentAdminUser).toEqual({ id: 'admin-1' });
    expect(state.pendingAdminSessionResult).toBe(remoteResult);
    expect(storageMocks.saveLicenseToStorage).toHaveBeenCalled();
    expect(supabaseMocks.adminLogoutSession).not.toHaveBeenCalled();

    runtimeMocks.ensureLocalDatabaseReady.mockResolvedValueOnce(undefined);
    const second = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(second).toMatchObject({ success: true, remoteAuthenticated: true });
    expect(supabaseMocks.adminLoginOnDevice).toHaveBeenCalledTimes(1);
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it('does not revoke the remote session when profile loading fails later', async () => {
    supabaseMocks.adminLoginOnDevice.mockResolvedValue({
      success: true,
      details: { license_key: 'LIC-1' },
      admin_user: { id: 'admin-1' }
    });
    const state = createHarness();
    state._loadProfile.mockRejectedValueOnce(new Error('profile local write failed'));

    const result = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(result).toMatchObject({
      success: false,
      remoteAuthenticated: true,
      code: 'ADMIN_LOCAL_BOOTSTRAP_FAILED'
    });
    expect(supabaseMocks.adminLogoutSession).not.toHaveBeenCalled();
    expect(state.currentAdminUser).toEqual({ id: 'admin-1' });
  });
});
