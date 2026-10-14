import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidateLicense: vi.fn(),
  getLicenseFromStorage: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(),
  checkInternetConnection: vi.fn(),
  clearLocalLicenseSession: vi.fn(),
  hasStaffValidationContext: vi.fn(),
  getActorRuntimeState: vi.fn(),
  assertActorCurrent: vi.fn(),
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../../services/Logger', () => ({ default: mocks.logger }));
vi.mock('../../../../services/utils', () => ({
  checkInternetConnection: mocks.checkInternetConnection,
  showMessageModal: vi.fn()
}));
vi.mock('../../../../services/supabase', () => ({
  revalidateLicense: mocks.revalidateLicense,
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  hasAdminSessionToken: vi.fn(),
  verifyAdminSession: vi.fn()
}));
vi.mock('../../../../services/licenseStorage', () => ({
  getLicenseFromStorage: mocks.getLicenseFromStorage,
  saveLicenseToStorage: mocks.saveLicenseToStorage
}));
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertLocalTenantSyncAccess,
  isLocalTenantAccessError: () => false
}));
vi.mock('../../../../services/auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    getState: mocks.getActorRuntimeState,
    capture: () => ({ assertCurrent: mocks.assertActorCurrent })
  },
  runWithActorHandle: async (handle, operation) => {
    handle.assertCurrent();
    const result = await operation({
      guardedWrite: (write) => {
        handle.assertCurrent();
        return write();
      }
    });
    handle.assertCurrent();
    return result;
  }
}));
vi.mock('../../../../services/auth/actorSessionRuntimeBridge', () => ({
  beginActorRuntimeAuthentication: vi.fn(),
  grantAuthenticatedActorRuntime: vi.fn(),
  lockActorRuntime: vi.fn()
}));

import { getLicenseStatusPresentation } from '../../../../utils/licenseStatusPresentation';
import {
  LAST_LICENSE_VALIDATION_SUCCESS_KEY
} from '../licenseValidationTimestamps';
import { createLicenseBackgroundValidationActions } from '../licenseBackgroundValidationActions';
import { createLicenseProcessingActions } from '../licenseProcessingActions';

const NOW = new Date('2026-10-14T03:41:32.000Z');
const LICENSE_KEY = 'TEST-PRO-GRACE-RECONCILIATION';
const EXPIRES_AT = '2026-10-09T15:14:09.885Z';
const GRACE_ENDS_AT = '2026-10-16T15:14:09.885Z';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
};

const actorSnapshot = (overrides = {}) => ({
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-1',
  actorKey: 'admin:admin-1',
  sessionId: 'session-1',
  generation: 7,
  tenant: { opaqueId: 'tenant-1', generation: 3, databaseName: 'LanzoDB_t_1' },
  deviceRef: 'device-1',
  ...overrides
});

const staleGraceEvidence = () => ({
  source: 'server_validation',
  status: 'active',
  valid: true,
  is_entitled: true,
  is_in_grace: false,
  expires_at: EXPIRES_AT,
  grace_period_ends: GRACE_ENDS_AT,
  validated_at: '2026-10-08T20:00:00.000Z'
});

const localGraceLicense = (overrides = {}) => ({
  license_key: LICENSE_KEY,
  license_id: 'license-1',
  valid: true,
  status: 'grace_period',
  plan_code: 'pro_monthly',
  plan_name: 'Lanzo Nube',
  product_name: 'Lanzo POS Pro',
  max_devices: 5,
  device_role: 'admin',
  expires_at: EXPIRES_AT,
  grace_period_ends: GRACE_ENDS_AT,
  is_entitled: true,
  is_in_grace: true,
  features: { cloud_pos_sync: true, realtime_license_sync: false },
  effective_lifecycle_validation: staleGraceEvidence(),
  ...overrides
});

const makeValidation = (overrides = {}) => ({
  valid: true,
  status: 'grace_period',
  reason: null,
  license_key: LICENSE_KEY,
  license_id: 'license-1',
  plan_code: 'pro_monthly',
  plan_name: 'Lanzo Nube',
  product_name: 'Lanzo POS Pro',
  max_devices: 5,
  device_role: 'admin',
  expires_at: EXPIRES_AT,
  grace_period_ends: GRACE_ENDS_AT,
  is_entitled: true,
  is_in_grace: true,
  features: { cloud_pos_sync: true, realtime_license_sync: false },
  ...overrides
});

const createHarness = (license = localGraceLicense()) => {
  const state = {
    appStatus: 'ready',
    licenseStatus: license.status,
    gracePeriodEnds: license.grace_period_ends,
    licenseDetails: license,
    currentDeviceRole: license.device_role,
    currentAdminUser: { id: 'admin-1' },
    currentStaffUser: null,
    companyProfile: { license_key: LICENSE_KEY },
    licenseSyncMode: 'hybrid_polling',
    _loadProfile: vi.fn().mockResolvedValue(undefined),
    refreshLicenseSyncMode: vi.fn().mockResolvedValue(undefined),
    _requireLicenseChange: vi.fn().mockResolvedValue(undefined),
    _requireStaffLogin: vi.fn().mockResolvedValue(undefined),
    reportServerStatus: vi.fn(),
    clearServerStatus: vi.fn()
  };
  const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  const get = () => state;
  Object.assign(state, createLicenseProcessingActions({
    set,
    get,
    clearLocalLicenseSession: mocks.clearLocalLicenseSession,
    hasStaffValidationContext: mocks.hasStaffValidationContext
  }));
  Object.assign(state, createLicenseBackgroundValidationActions({
    set,
    get,
    clearLocalLicenseSession: mocks.clearLocalLicenseSession,
    hasStaffValidationContext: mocks.hasStaffValidationContext
  }));
  return state;
};

describe('background validation reconciles effective lifecycle evidence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('navigator', { onLine: true });
    vi.clearAllMocks();
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.assertLocalTenantSyncAccess.mockResolvedValue({ status: 'pass' });
    mocks.getLicenseFromStorage.mockImplementation(async () => localGraceLicense());
    mocks.saveLicenseToStorage.mockResolvedValue(undefined);
    mocks.hasStaffValidationContext.mockResolvedValue(true);
    mocks.getActorRuntimeState.mockReturnValue(actorSnapshot());
    mocks.assertActorCurrent.mockImplementation(() => undefined);
    mocks.revalidateLicense.mockResolvedValue(makeValidation());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('replaces expired Active evidence after a fresh server confirmation of Grace', async () => {
    const state = createHarness();

    await state._validateInBackground(LICENSE_KEY, { reason: 'background' });

    expect(mocks.revalidateLicense).toHaveBeenCalledTimes(1);
    expect(state.licenseDetails.effective_lifecycle_validation).toMatchObject({
      source: 'server_validation',
      status: 'grace_period',
      valid: true,
      is_entitled: true,
      is_in_grace: true,
      expires_at: EXPIRES_AT,
      grace_period_ends: GRACE_ENDS_AT,
      validated_at: NOW.toISOString()
    });
    expect(getLicenseStatusPresentation(state.licenseDetails, NOW, {
      licenseStatus: state.licenseStatus
    })).toMatchObject({ status: 'grace_period', label: 'Período de gracia' });
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
      effective_lifecycle_validation: expect.objectContaining({ status: 'grace_period' })
    }));
  });

  it('does not treat an offline fallback as fresh lifecycle evidence or a successful remote check', async () => {
    const state = createHarness();
    mocks.revalidateLicense.mockResolvedValue(makeValidation({
      is_fallback: true,
      reason: 'offline_grace'
    }));

    await state._validateInBackground(LICENSE_KEY, { reason: 'background' });

    expect(state.licenseDetails.effective_lifecycle_validation).toEqual(staleGraceEvidence());
    expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_LICENSE_VALIDATION_SUCCESS_KEY)).toBeNull();
  });

  it('discards a response if the active license changes while the request is pending', async () => {
    const state = createHarness();
    const otherLicense = localGraceLicense({ license_key: 'OTHER-LICENSE' });
    mocks.revalidateLicense.mockImplementation(async () => {
      state.licenseDetails = otherLicense;
      return makeValidation();
    });

    await state._validateInBackground(LICENSE_KEY, { reason: 'background' });

    expect(state.licenseDetails).toBe(otherLicense);
    expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_LICENSE_VALIDATION_SUCCESS_KEY)).toBeNull();
  });

  it('discards a response after the ActorRuntime generation changes', async () => {
    const state = createHarness();
    mocks.revalidateLicense.mockImplementation(async () => {
      mocks.getActorRuntimeState.mockReturnValue(actorSnapshot({ generation: 8 }));
      return makeValidation();
    });

    await state._validateInBackground(LICENSE_KEY, { reason: 'background' });

    expect(state.licenseDetails.effective_lifecycle_validation).toEqual(staleGraceEvidence());
    expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_LICENSE_VALIDATION_SUCCESS_KEY)).toBeNull();
  });

  it('persists and presents a canonical administrative block despite an unexpired grace boundary', async () => {
    const state = createHarness();
    mocks.revalidateLicense.mockResolvedValue(makeValidation({
      valid: false,
      status: 'administratively_blocked',
      lifecycle_state: 'administratively_blocked',
      reason: 'LICENSE_NOT_ACTIVE',
      is_entitled: false,
      is_in_grace: false
    }));

    await state._validateInBackground(LICENSE_KEY, { reason: 'background' });

    expect(state.licenseDetails).toMatchObject({
      valid: false,
      status: 'administratively_blocked',
      effective_lifecycle_validation: expect.objectContaining({
        status: 'administratively_blocked',
        is_entitled: false,
        is_in_grace: false
      })
    });
    expect(getLicenseStatusPresentation(state.licenseDetails, NOW, {
      licenseStatus: state.licenseStatus
    })).toMatchObject({
      status: 'administratively_blocked',
      label: 'Bloqueada por administración'
    });
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'administratively_blocked',
      valid: false
    }));
  });
});
