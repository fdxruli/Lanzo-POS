// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let broadcastHandler;
const subscribe = vi.fn((callback) => {
  callback('SUBSCRIBED');
  return channel;
});
const channel = {
  on: vi.fn((_kind, _filter, callback) => {
    broadcastHandler = callback;
    return channel;
  }),
  subscribe
};
const channelFactory = vi.fn(() => channel);
const removeChannel = vi.fn().mockResolvedValue(undefined);

vi.mock('../../supabase', () => ({
  supabaseClient: {
    channel: channelFactory,
    removeChannel
  }
}));

import {
  canUseNotificationRealtime,
  startNotificationRealtime,
  stopNotificationRealtime
} from '../notificationRealtimeService';

const admin = { currentDeviceRole: 'admin' };
const proOrders = {
  realtime_topic: 'license:pro-fixture',
  features: {
    ecommerce_order_inbox: true,
    ecommerce_realtime_orders: true,
    notification_center: false,
    cloud_notifications: false
  }
};

beforeEach(async () => {
  await stopNotificationRealtime();
  vi.clearAllMocks();
  broadcastHandler = null;
});

describe('notificationRealtimeService ecommerce', () => {
  it('does not start ecommerce realtime for FREE', () => {
    const free = {
      realtime_topic: 'license:free-fixture',
      features: {
        ecommerce_order_inbox: true,
        ecommerce_realtime_orders: false,
        notification_center: false,
        cloud_notifications: false
      }
    };

    expect(canUseNotificationRealtime(free, admin)).toBe(false);
    expect(startNotificationRealtime({ licenseDetails: free, staffSession: admin })).toBeNull();
    expect(channelFactory).not.toHaveBeenCalled();
  });

  it('reuses the private notification channel for PRO order events', () => {
    const listener = vi.fn();
    window.addEventListener('lanzo:ecommerce-orders-changed', listener);

    const result = startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: vi.fn()
    });

    expect(result).toBe(channel);
    expect(channelFactory).toHaveBeenCalledWith('license:pro-fixture', {
      config: { private: true }
    });

    broadcastHandler({
      payload: {
        event: 'ecommerce_orders_changed',
        reason: 'order_accepted',
        metadata: {
          source: 'ecommerce',
          category: 'ecommerce',
          order_id: '11111111-1111-4111-8111-111111111111',
          status: 'accepted'
        }
      }
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual(expect.objectContaining({
      event: 'ecommerce_orders_changed',
      reason: 'order_accepted',
      metadata: expect.objectContaining({
        source: 'ecommerce',
        category: 'ecommerce',
        status: 'accepted'
      })
    }));

    window.removeEventListener('lanzo:ecommerce-orders-changed', listener);
  });

  it('invalidates orders when a normal notification event is ecommerce', () => {
    const listener = vi.fn();
    const notificationHandler = vi.fn();
    window.addEventListener('lanzo:ecommerce-orders-changed', listener);

    startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: notificationHandler
    });

    broadcastHandler({
      payload: {
        event: 'notifications_changed',
        reason: 'ecommerce_order_created',
        notification_id: 'notification-id',
        metadata: {
          source: 'ecommerce',
          category: 'ecommerce',
          order_id: '11111111-1111-4111-8111-111111111111'
        }
      }
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(notificationHandler).toHaveBeenCalledTimes(1);
    window.removeEventListener('lanzo:ecommerce-orders-changed', listener);
  });
});
