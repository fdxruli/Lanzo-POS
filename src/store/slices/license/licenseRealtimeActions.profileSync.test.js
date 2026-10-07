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
    clearServerStatus: vi.¶»§q«^