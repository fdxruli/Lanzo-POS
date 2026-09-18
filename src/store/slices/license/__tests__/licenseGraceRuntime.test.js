import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidateLicense: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../../../services/Logger', () => ({ default: mocks.logger }));
vi.mock('../../../../services/supabase', () => ({ revalidateLicense: mocks.revalidateLicense }));
vi.mock('../../../../services/licenseStorage', () => ({ saveLicenseToStorage: mocks.saveLicenseToStorage }));
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  isLocalTenantAccessError: () => false
}));

import {
  assertLocalTransactionAllowed,
  deriveLocalGracePeriodEnd
} from '../licenseGuards';
import { createLicenseIntegrityActions } from '../licenseIntegrityActions';

const NOW = new Date('2026-09-18T06:00:00.000Z');
const ACTIVE_EXPIRY = '2026-09-19T06:00:00.000Z';
const GRACE_EXPIRY = '2026-09-17T06:00:00.000Z';
const GRACE_END = '2026-09-24T06:00:00.000Z';
const ENDED_EXPIRY = '2026-09-01T06:00:00.000Z';
const ENDED_GRACE = '2026-09-08T06:00:00.000Z';

const makeLicense = (overrides = {}) => ({
  license_key: 'TEST-LICENSE-GRACE',
  valid: true,
  status: 'active',
  plan_code: 'pro_monthly',
  device_role: 'admin',
  features: { cloud_pos_sync: true, realtime_license_sync: true },
  localExpiry: '2026-10-18T06:00:00.000Z',
  expires_at: ACTIVE_EXPIRY,
  ...overrides
});

const createStore = (licenseDetails = makeLicense()) => {
  const state = {
    appStatus: 'ready',
    licenseStatus: licenseDetails.status,
    gracePeriodEnds: licenseDetails.grace_period_ends || null,
    licenseDetails,
    currentDeviceRole: licenseDetails.device_role,
    currentStaffUser: null,
    companyProfile: { license_key: licenseDetails.license_key },
    logout: vi.fn().mockResolvedValue(undefined),
    _requireLicenseChange: vi.fn().mockResolvedValue(undefined),
    _requireStaffLogin: vi.fn().mockResolvedValue(undefined),
    _loadProfile: vi.fn().mockResolvedValue(undefined),
    refreshLicenseSyncMode: vi.fn().mockResolvedValue(undefined),
    _processOfflineMode: vi.fn(async (localLicense) => {
      const gracePeriodEnds = deriveLocalGracePeriodEnd(localLicense);
      Object.assign(state, {
        licenseStatus: 'grace_period',
        gracePeriodEnds,
        licenseDetails: {
          ...localLicense,
          status: 'grace_period',
          grace_period_ends: gracePeriodEnds
        }
      });
    })
  };
  const set = (partial) => Object.assign(state, partial);
  const get = () => state;

  Object.assign(state, createLicenseIntegrityActions({
    set,
    get,
    hasStaffValidationContext: vi.fn().mockResolvedValue(true)
  }));

  return state;
};

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
};

describe('license runtime Active → Grace → Free admission', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: createMemoryStorage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: createMemoryStorage() });
    mocks.saveLicenseToStorage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows active PRO before expires_at', () => {
    expect(assertLocalTransactionAllowed(makeLicense(), {})).toEqual({ ok: true });
  });

  it('allows PRO with a known future grace boundary', () => {
    expect(assertLocalTransactionAllowed(makeLicense({
      status: 'grace_period',
      expires_at: GRACE_EXPIRY,
      grace_period_ends: GRACE_END
    }), {})).toMatchObject({ ok: true, lifecycleState: 'grace_period' });
  });

  it('revalidates stale local lifecycle, persists canonical grace and allows checkout', async () => {
    const state = createStore(makeLicense({ expires_at: GRACE_EXPIRY }));
    mocks.revalidateLicense.mockResolvedValue({
      valid: true,
      status: 'grace_period',
      is_entitled: true,
      is_in_grace: true,
      expires_at: GRACE_EXPIRY,
      grace_period_ends: GRACE_END,
      plan_code: 'pro_monthly',
      features: { cloud_pos_sync: true, realtime_license_sync: true }
    });

    const allowed = await state.verifySessionIntegrity({
      reason: 'sale_checkout',
      transactionMode: true,
      allowLocalOnly: true
    });

    expect(allowed).toBe(true);
    expect(mocks.revalidateLicense).toHaveBeenCalledTimes(1);
    expect(state.licenseStatus).toBe('grace_period');
    expect(state.gracePeriodEnds).toBe(GRACE_END);
    expect(state.licenseDetails).toMatchObject({
      status: 'grace_period',
      valid: true,
      grace_period_ends: GRACE_END
    });
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'grace_period',
      grace_period_ends: GRACE_END
    }));
  });

  it('allows offline operation inside a derived grace period and stores the boundary', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const state = createStore(makeLicense({ expires_at: GRACE_EXPIRY }));

    const allowed = await state.verifySessionIntegrity({
      reason: 'sale_checkout',
      transactionMode: true,
      allowLocalOnly: true
    });

    expect(allowed).toBe(true);
    expect(mocks.revalidateLicense).not.toHaveBeenCalled();
    expect(state._processOfflineMode).toHaveBeenCalledTimes(1);
    expect(state.licenseDetails).toMatchObject({
      status: 'grace_period',
      grace_period_ends: GRACE_END
    });
  });

  it('does not consider PRO entitled after the grace boundary', () => {
    expect(assertLocalTransactionAllowed(makeLicense({
      expires_at: ENDED_EXPIRY,
      grace_period_ends: ENDED_GRACE
    }), {})).toMatchObject({
      ok: false,
      code: 'LICENSE_EXPIRED',
      requiresRemoteResolution: true
    });
  });

  it.each(['revoked', 'suspended', 'banned', 'CLONING_DETECTED'])(
    'blocks fatal administrative/security status %s even inside grace',
    (status) => {
      expect(assertLocalTransactionAllowed(makeLicense({
        status,
        expires_at: GRACE_EXPIRY,
        grace_period_ends: GRACE_END
      }), {})).toMatchObject({ ok: false });
    }
  );

  it('blocks missing Staff authentication with a Staff-specific reason', () => {
    expect(assertLocalTransactionAllowed(makeLicense({
      device_role: 'staff',
      expires_at: GRACE_EXPIRY,
      grace_period_ends: GRACE_END
    }), { currentDeviceRole: 'staff', currentStaffUser: null })).toMatchObject({
      ok: false,
      code: 'STAFF_LOGIN_REQUIRED'
    });
  });

  it('does not label a network failure as LICENSE_EXPIRED while local grace is valid', async () => {
    const state = createStore(makeLicense({ expires_at: GRACE_EXPIRY }));
    mocks.revalidateLicense.mockRejectedValue(new Error('NETWORK_ERROR'));

    const allowed = await state.verifySessionIntegrity({
      reason: 'sale_checkout',
      transactionMode: true,
      allowLocalOnly: true
    });

    expect(allowed).toBe(true);
    expect(state.lastIntegrityFailure).toBeNull();
    expect(state._processOfflineMode).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('LICENSE_EXPIRED'),
      expect.anything()
    );
  });
});
