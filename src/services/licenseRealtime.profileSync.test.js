import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  broadcastHandler: null,
  subscribeHandler: null,
  removeChannel: vi.fn(async () => undefined),
  channel: vi.fn()
}));

vi.mock('./supabase', () => ({
  supabaseClient: {
    channel: mocks.channel,
    removeChannel: mocks.removeChannel
  }
}));

import {
  cleanupAllChannels,
  startLicenseListener
} from './licenseRealtime';

const createChannel = () => {
  const channel = {
    on: vi.fn((_type, _filter, handler) => {
      mocks.broadcastHandler = handler;
      return channel;
    }),
    subscribe: vi.fn((handler) => {
      mocks.subscribeHandler = handler;
      return channel;
    })
  };
  mocks.channel.mockReturnValue(channel);
  return channel;
};

describe('licenseRealtime business profile events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.broadcastHandler = null;
    mocks.subscribeHandler = null;
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(async () => {
    await cleanupAllChannels();
  });

  it('forwards BUSINESS_PROFILE_UPDATED with revision metadata', async () => {
    createChannel();
    const onLicenseChanged = vi.fn();

    startLicenseListener(
      'LANZO-PRO',
      'device-fingerprint',
      'license:topic',
      { onLicenseChanged }
    );

    await mocks.broadcastHandler({
      payload: {
        event_type: 'BUSINESS_PROFILE_UPDATED',
        triggered_at: '2026-08-06T06:15:00Z',
        metadata: {
          profile_revision: 1785996900000,
          business_type: ['hardware']
        }
      }
    });

    expect(onLicenseChanged).toHaveBeenCalledWith({
      source: 'realtime_event',
      type: 'BUSINESS_PROFILE_UPDATED',
      triggeredAt: '2026-08-06T06:15:00Z',
      metadata: {
        profile_revision: 1785996900000,
        business_type: ['hardware']
      }
    });
  });
});
