/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidateLicense: vi.fn(), saveLicenseToStorage: vi.fn(), getLicenseFromStorage: vi.fn()
}));
const tenant = vi.hoisted(() => ({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1
}));
vi.mock('../../../../services/db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: tenant })
}));
vi.mock('../../../../services/Logger', () => ({ default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../services/supabase', () => ({ revalidateLicense: mocks.revalidateLicense }));
vi.mock('../../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage,
  getLicenseFromStorage: mocks.getLicenseFromStorage
}));
vi.mock('../../../../services/utils', () => ({
  checkInternetConnection: vi.fn(async () => true), showMessageModal: vi.fn()
}));
vi.mock('../../../../services/tenant/localTenantGuard', () => ({ isLocalTenantAccessError: () => false }));

import { createLicenseIntegrityActions } from '../licenseIntegrityActions';
import { createLicenseBackgroundValidationActions } from '../licenseBackgroundValidationActions';
import { actorRuntimeController } from '../../../../services/auth/actorRuntimeController';
import { clearActorAuthorityRecovery, getActorAuthorityRecoverySnapshot } from '../../../../services/auth/actorAuthorityRecovery';

const grantAdmin = () => {
  actorRuntimeController.lock('test_reset');
  actorRuntimeController.beginAuthentication({ actorType: 'admin' });
  actorRuntimeController.beginHandoffCheck();
  actorRuntimeController.grant({
    actorType: 'admin', actorId: 'admin-qa', sessionId: 'session-QA',
    tenantOpaqueId: tenant.opaqueId, deviceRef: 'fingerprint-QA'
  });
  clearActorAuthorityRecovery();
};

const createStore = () => {
  const state = {
    appStatus: 'ready', licenseStatus: 'active',
    licenseDetails: {
      license_key: 'QA-RECOVERY', valid: true, status: 'active', plan_code: 'free_trial',
      device_role: 'admin', localExpiry: '2099-01-01T00:00:00Z'
    },
    currentAdminUser: { id: 'admin-qa' },
    companyProfile: { license_key: 'QA-RECOVERY' },
    logout: vi.fn(), _loadProfile: vi.fn(), refreshLicenseSyncMode: vi.fn(),
    _processOfflineMode: vi.fn(), _requireStaffLogin: vi.fn(), _processServerValidation: vi.fn(),
    clearLocalLicenseSession: vi.fn(),
    _requireActorAuthorityRecovery: vi.fn(async () => true)
  };
  Object.assign(state, createLicenseIntegrityActions({
    set: (partial) => Object.assign(state, partial), get: () => state,
    hasStaffValidationContext: async () => false
  }));
  Object.assign(state, createLicenseBackgroundValidationActions({
    set: (partial) => Object.assign(state, partial), get: () => state,
    clearLocalLicenseSession: state.clearLocalLicenseSession,
    hasStaffValidationContext: async () => false
  }));
  mocks.getLicenseFromStorage.mockResolvedValue(state.licenseDetails);
  return state;
};

describe('license integrity authority recovery admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    grantAdmin();
  });

  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED'])(
    'does not permit a local financial fallback after %s is rejected', async (code) => {
      const state = createStore();
      mocks.revalidateLicense.mockRejectedValue({ code: 'P0001', message: code });
      const allowed = await state.verifySessionIntegrity({ forceRemote: true, transactionMode: true, allowLocalOnly: true });
      expect(allowed).toBe(false);
      expect(state._requireActorAuthorityRecovery).toHaveBeenCalledTimes(1);
      expect(state._processOfflineMode).not.toHaveBeenCalled();
      expect(state.logout).not.toHaveBeenCalled();
      expect(state.lastIntegrityFailure.message).not.toMatch(/DEVICE_TOKEN|P0001/);
    }
  );

  it('preserves the existing hard-cloning logout contract', async () => {
    const state = createStore();
    mocks.revalidateLicense.mockResolvedValue({ valid: false, reason: 'CLONING_DETECTED' });
    expect(await state.verifySessionIntegrity({ forceRemote: true, allowLocalOnly: false })).toBe(false);
    expect(state.logout).toHaveBeenCalledTimes(1);
    expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
  });

  it.each(['DEVICE_NOT_ALLOWED', 'CLONING_DETECTED'])(
    'denies local financial fallback when PostgREST throws %s', async (code) => {
      const state = createStore();
      mocks.revalidateLicense.mockRejectedValue({ code: 'P0001', message: code });
      expect(await state.verifySessionIntegrity({ forceRemote: true, transactionMode: true, allowLocalOnly: true })).toBe(false);
      expect(state.logout).toHaveBeenCalledTimes(1);
      expect(state._processOfflineMode).not.toHaveBeenCalled();
      expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
    }
  );

  it.each(['DEVICE_NOT_ALLOWED', 'CLONING_DETECTED'])(
    'preserves a hard %s rejection wrapped by the license adapter', async (code) => {
      const state = createStore();
      mocks.revalidateLicense.mockResolvedValue({ valid: false, reason: 'server_rejected', details: code });
      expect(await state.verifySessionIntegrity({ forceRemote: true, transactionMode: true, allowLocalOnly: true })).toBe(false);
      expect(state.logout).toHaveBeenCalledTimes(1);
      expect(state._processOfflineMode).not.toHaveBeenCalled();
      expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
    }
  );

  it.each(['response', 'rejection'])(
    'discards an old actor validation %s without requiring another login', async (completion) => {
      const state = createStore();
      let finish;
      mocks.revalidateLicense.mockImplementation(() => new Promise((resolve, reject) => {
        finish = completion === 'response'
          ? () => resolve({ valid: false, reason: 'server_rejected', details: 'DEVICE_TOKEN_INVALID' })
          : () => reject({ code: 'P0001', message: 'DEVICE_TOKEN_INVALID' });
      }));
      const validation = state.verifySessionIntegrity({ forceRemote: true, transactionMode: true, allowLocalOnly: true });
      grantAdmin();
      finish();

      expect(await validation).toBe(false);
      expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
      expect(state.logout).not.toHaveBeenCalled();
      expect(state._processOfflineMode).not.toHaveBeenCalled();
      expect(actorRuntimeController.getState().status).toBe('granted');
      expect(state.lastIntegrityFailure.code).toBe('SESSION_CHANGED');
    }
  );

  it.each(['DEVICE_NOT_ALLOWED', 'CLONING_DETECTED'])(
    'keeps a thrown background %s rejection in the existing hard exit flow', async (code) => {
      const state = createStore();
      mocks.revalidateLicense.mockRejectedValue({ code: 'P0001', message: code });
      await state._validateInBackground(state.licenseDetails.license_key);

      expect(mocks.revalidateLicense).toHaveBeenCalledTimes(1);
      expect(state.clearLocalLicenseSession).toHaveBeenCalledTimes(1);
      expect(state.appStatus).toBe('unauthenticated');
      expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
      expect(state._processServerValidation).not.toHaveBeenCalled();
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
      expect(actorRuntimeController.getState().status).toBe('locked');
    }
  );

  it.each(['DEVICE_NOT_ALLOWED', 'CLONING_DETECTED'])(
    'keeps an adapter-wrapped background %s rejection in the hard exit flow', async (code) => {
      const state = createStore();
      mocks.revalidateLicense.mockResolvedValue({ valid: false, reason: 'server_rejected', details: code });
      await state._validateInBackground(state.licenseDetails.license_key);

      expect(mocks.revalidateLicense).toHaveBeenCalledTimes(1);
      expect(state.clearLocalLicenseSession).toHaveBeenCalledTimes(1);
      expect(state.appStatus).toBe('unauthenticated');
      expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
      expect(state._processServerValidation).not.toHaveBeenCalled();
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
      expect(actorRuntimeController.getState().status).toBe('locked');
    }
  );

  it.each(['response', 'rejection'])(
    'discards an old actor background %s without another login or local writes', async (completion) => {
      const state = createStore();
      let finish;
      mocks.revalidateLicense.mockImplementation(() => new Promise((resolve, reject) => {
        finish = completion === 'response'
          ? () => resolve({ valid: false, reason: 'server_rejected', details: 'DEVICE_TOKEN_INVALID' })
          : () => reject({ code: 'P0001', message: 'DEVICE_TOKEN_INVALID' });
      }));
      const validation = state._validateInBackground(state.licenseDetails.license_key);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      grantAdmin();
      finish();
      await validation;

      expect(state._requireActorAuthorityRecovery).not.toHaveBeenCalled();
      expect(state.clearLocalLicenseSession).not.toHaveBeenCalled();
      expect(state._processServerValidation).not.toHaveBeenCalled();
      expect(state.appStatus).toBe('ready');
      expect(actorRuntimeController.getState().status).toBe('granted');
    }
  );
});
