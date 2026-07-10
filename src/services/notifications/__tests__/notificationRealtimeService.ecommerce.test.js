// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realtimeMocks = vi.hoisted(() => ({
  channelFactory: vi.fn(),
  removeChannel: vi.fn(),
  subscribe: vi.fn(),
  broadcastHandler: null,
  channel: null
}));

vi.mock('../../supabase', () => ({
  supabaseClient: {
    channel: realtimeMocks.channelFactory,
    removeChannel: realtimeMocks.removeChannel
  }
}));

import {
  canUseNotificationRealtime,
  startNotificationRealtime,
  stopNotificationRealtime
} from '../notificationRealtimeService';

const ORDER_EVENT = 'lanzo:ecommerce-orders-changed';
const registeredListeners = [];

const addOrderListener = (listener) => {
  window.addEventListener(ORDER_EVENT, listener);
  registeredListeners.push(listener);
};

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
  realtimeMocks.broadcastHandler = null;

  const channel = {};
  channel.on = vi.fn((_kind, _filter, callback) => {
    realtimeMocks.broadcastHandler = callback;
    return channel;
  });
  channel.subscribe = realtimeMocks.subscribe;

  realtimeMocks.channel = channel;
  realtimeMocks.subscribe.mockImplementation((callback) => {
    callback('SUBSCRIBED');
    return channel;
  });
  realtimeMocks.channelFactory.mockReturnValue(channel);
  realtimeMocks.removeChannel.mockResolvedValue(undefined);
});

afterEach(async () => {
  registeredListeners.splice(0).forEach((listener) => {
    window.removeEventListener(ORDER_EVENT, listener);
  });
  await stopNotificationRealtime();
  realtimeMocks.broadcastHandler = null;
  vi.useRealTimers();
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
    expect(realtimeMocks.channelFactory).not.toHaveBeenCalled();
  });

  it('reuses the private notification channel for PRO', () => {
    const first = startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: vi.fn()
    });
    const second = startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: vi.fn()
    });

    expect(first).toBe(realtimeMocks.channel);
    expect(second).toBe(realtimeMocks.channel);
    expect(realtimeMocks.channelFactory).toHaveBeenCalledTimes(1);
    expect(realtimeMocks.channelFactory).toHaveBeenCalledWith('license:pro-fixture', {
      config: { private: true }
    });
  });

  it('dispatches ecommerce_orders_changed to invalidate the inbox', () => {
    const listener = vi.fn();
    addOrderListener(listener);

    startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: vi.fn()
    });

    realtimeMocks.broadcastHandler({
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
  });

  it('dispatches notifications_changed when its category is ecommerce', () => {
    const listener = vi.fn();
    const notificationHandler = vi.fn();
    addOrderListener(listener);

    startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: notificationHandler
    });

    realtimeMocks.broadcastHandler({
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
  });

  it('does not invalidate orders for unrelated notification events', () => {
    const listener = vi.fn();
    const notificationHandler = vi.fn();
    addOrderListener(listener);

    startNotificationRealtime({
      licenseDetails: proOrders,
      staffSession: admin,
      onNotificationEvent: notificationHandler
    });

    realtimeMocks.broadcastHandler({
      payload: {
        event: 'notifications_changed',
        reason: 'sync_changed',
        metadata: {
          source: 'sync',
          category: 'sync'
        }
      }
    });

    expect(listener).not.toHaveBeenCalled();
    expect(notificationHandler).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate browser listeners when start is called twice', () => {
    const listener = vi.fn();
    addOrderListener(listener);

    startNotificationRealtime({ licenseDetails: proOrders, staffSession: admin });
    startNotificationRealtime({ licenseDetails: proOrders, staffSession: admin });

    realtimeMocks.broadcastHandler({
      payload: {
        event: 'ecommerce_orders_changed',
        reason: 'order_seen',
        metadata: { source: 'ecommerce', category: 'ecommerce', status: 'seen' }
      }
    });

    expect(realtimeMocks.channelFactory).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
