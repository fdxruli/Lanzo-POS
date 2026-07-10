import { describe, expect, it } from 'vitest';
import {
  canAccessEcommerceOrders,
  canUseEcommerceOrderRealtime,
  getEcommerceOrderCapabilityReason
} from '../ecommerceOrderCapabilities';

const license = (features = {}) => ({
  features,
  realtime_topic: 'license:fixture'
});

const staff = (permissions = {}) => ({
  currentDeviceRole: 'staff',
  currentStaffUser: { permissions }
});

describe('ecommerceOrderCapabilities', () => {
  it('allows an admin when the inbox feature is enabled', () => {
    expect(canAccessEcommerceOrders(
      license({ ecommerce_order_inbox: true }),
      { currentDeviceRole: 'admin' }
    )).toBe(true);
  });

  it('allows staff with ecommerce even when settings is disabled', () => {
    expect(canAccessEcommerceOrders(
      license({ ecommerce_order_inbox: true }),
      staff({ ecommerce: true, settings: false, notifications: false })
    )).toBe(true);
  });

  it('blocks staff without ecommerce permission', () => {
    const session = staff({ ecommerce: false, settings: true, notifications: true });

    expect(canAccessEcommerceOrders(
      license({ ecommerce_order_inbox: true }),
      session
    )).toBe(false);
    expect(getEcommerceOrderCapabilityReason(
      license({ ecommerce_order_inbox: true }),
      session
    )).toBe('ECOMMERCE_STAFF_PERMISSION_DENIED');
  });

  it('blocks every actor when the inbox feature is disabled', () => {
    expect(canAccessEcommerceOrders(
      license({ ecommerce_order_inbox: false }),
      { currentDeviceRole: 'admin' }
    )).toBe(false);
    expect(getEcommerceOrderCapabilityReason(
      license({ ecommerce_order_inbox: false }),
      { currentDeviceRole: 'admin' }
    )).toBe('ECOMMERCE_ORDER_INBOX_DISABLED');
  });

  it('enables realtime only with effective realtime feature, access and topic', () => {
    expect(canUseEcommerceOrderRealtime(
      license({ ecommerce_order_inbox: true, ecommerce_realtime_orders: true }),
      staff({ ecommerce: true, notifications: false })
    )).toBe(true);

    expect(canUseEcommerceOrderRealtime(
      license({ ecommerce_order_inbox: true, ecommerce_realtime_orders: false }),
      staff({ ecommerce: true })
    )).toBe(false);

    expect(canUseEcommerceOrderRealtime(
      { features: { ecommerce_order_inbox: true, ecommerce_realtime_orders: true } },
      { currentDeviceRole: 'admin' }
    )).toBe(false);
  });
});
