import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStableDeviceId: vi.fn(async () => 'device-fingerprint'),
  startLicenseListener: vi.fn(),
  stopLicenseListener: vi.fn(async () => undefined),
  getConnectionStatus: vi.fn(() => ({
    isActive: false,
    isConnecting: false,
    isReconnecting: false
  })),
  isRealtimeEnabledForLicense: vi.fn(() => true)
}));

vi.mock('../../../services/supabase', () => ({
  getStableDeviceId: mocks.getStableDeviceId
}));

vi.mock('../../../services/licenseRealtime', () => ({
  startLicenseListener: mocks.startLicenseListener,
  stopLicenseListener: mocks.stopLicenseListener,
  getConnectionStatus: mocks.getConnectionStatus
}));

vi.mock('./licenseGuards', () => ({
  isRealtimeEnabledForLicense: mocks.isRealtimeEnabledForLicense
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: vi.fn()
}));

import { createLicenseRealtimeActions } from './licenseRealtimeActions';

const createState = () => {
  const state = {
    licenseDetails: {
      license_key: 'LANZO-PRO',
      realtime_topic: 'license:topic',
      features: { realtime_license_sync: true }
    },
    realtimeSubscription: null,
    _isInitializingSecurity: false,
    _isRecoveringRealtime: false,
    _securityCleanupScheduled: false,
    _loadProfile: vi.fn(async () => undefined),
    runLicenseSyncCheck: vi.fn(async () => true),
    stopRealtimeSecurity: vi.fn(async () => undefined),
    clearServerStatus: vi.fn(),
    reportServerFailure: vi.fn(),
    switchLicenseSyncToPollingFallback: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined)
  };
  const set = vi.fn((partial) => Object.assign(state, partial));
  const get = () => state;

  Object.assign(state, createLicenseRealtimeActions({
    set,
    get,
    hasStaffValidationContext: vi.fn(async () => false)
  }));

  return state;
};

describe('business profile realtime refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('forces the authoritative profile read for BUSINESS_PROFILE_UPDATED', async () => {
    const channel = { id: 'channel' };
    let callbacks;
    mocks.startLicenseListener.mockImplementation((_license, _device, _topic, nextCallbacks) => {
      callbacks = nextCallbacks;
      return channel;
    });
    const state = createState();

    await state.startRealtimeSecurity();
    await callbacks.onLicenseChanged({
      type: 'BUSINESS_PROFILE_UPDATED',
      metadata: { profile_revision: 1785980000000 }
    });

    expect(state._loadProfile).toHaveBeenCalledWith('LANZO-PRO', {
      forceRemote: true,
      refreshProfile: true,
      reason: 'realtime_business_profile_updated'
    });
    expect(state.runLicenseSyncCheck).not.toHaveBeenCalled();
  });

  it('keeps license events on the license validation path', async () => {
    let callbacks;
    mocks.startLicenseListener.mockImplementation((_license, _device, _topic, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { id: 'channel' };
    });
    const state = createState();

    await state.startRealtimeSecurity();
    await callbacks.onLicenseChanged({ type: 'PLAN_CHANGED' });

    expect(state.runLicenseSyncCheck).toHaveBeenCalledWith('realtime_event');
    expect(state._loadProfile).not.toHaveBeenCalled();
  });
});
