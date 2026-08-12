import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLicenseSyncIntervalMs: vi.fn(() => 60_000),
  getLicenseSyncMode: vi.fn(() => 'hybrid_realtime'),
  isCriticalLicenseValidationReason: vi.fn(() => false),
  markLastLicenseValidationAttempt: vi.fn(),
  shouldSkipRemoteValidationAfterFailure: vi.fn(() => false),
  shouldSkipRemoteValidationForPlan: vi.fn(() => true)
}));

vi.mock('./licenseGuards', () => ({
  getLicenseSyncIntervalMs: mocks.getLicenseSyncIntervalMs,
  getLicenseSyncMode: mocks.getLicenseSyncMode,
  isCriticalLicenseValidationReason: mocks.isCriticalLicenseValidationReason
}));

vi.mock('./licenseValidationTimestamps', () => ({
  markLastLicenseValidationAttempt: mocks.markLastLicenseValidationAttempt,
  shouldSkipRemoteValidationAfterFailure: mocks.shouldSkipRemoteValidationAfterFailure,
  shouldSkipRemoteValidationForPlan: mocks.shouldSkipRemoteValidationForPlan
}));

vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  isLocalTenantAccessError: vi.fn(() => false)
}));

import { createLicenseSyncActions } from './licenseSyncActions';

const createState = ({ mode = 'hybrid_realtime' } = {}) => {
  const state = {
    appStatus: 'ready',
    _isInitializing: false,
    licenseDetails: { license_key: 'LANZO-PRO', valid: true },
    licenseSyncMode: mode,
    _loadProfile: vi.fn(async () => undefined),
    verifySessionIntegrity: vi.fn(async () => true),
    refreshLicenseSyncMode: vi.fn(async () => undefined),
    clearServerStatus: vi.fn()
  };
  const set = vi.fn((partial) => Object.assign(state, partial));
  const get = () => state;

  Object.assign(state, createLicenseSyncActions({ set, get }));
  return state;
};

describe('license profile synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('refreshes the business profile before a plan TTL skips license validation', async () => {
    const state = createState();

    await expect(state.runLicenseSyncCheck('start')).resolves.toBe(true);

    expect(state._loadProfile).toHaveBeenCalledWith('LANZO-PRO', {
      forceRemote: true,
      refreshProfile: true,
      reason: 'license_sync_start'
    });
    expect(mocks.shouldSkipRemoteValidationForPlan).toHaveBeenCalled();
    expect(state.verifySessionIntegrity).not.toHaveBeenCalled();
  });

  it('forces profile refresh while polling fallback is active', async () => {
    const state = createState({ mode: 'hybrid_polling' });

    await state.runLicenseSyncCheck('interval');

    expect(state._loadProfile).toHaveBeenCalledWith('LANZO-PRO', {
      forceRemote: true,
      refreshProfile: true,
      reason: 'license_sync_interval'
    });
  });

  it('uses the profile TTL for non-critical realtime probes', async () => {
    const state = createState({ mode: 'hybrid_realtime' });

    await state.runLicenseSyncCheck('realtime_probe_visibility');

    expect(state._loadProfile).toHaveBeenCalledWith('LANZO-PRO', {
      forceRemote: false,
      refreshProfile: false,
      reason: 'license_sync_realtime_probe_visibility'
    });
  });
});
