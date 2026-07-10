import { describe, expect, it } from 'vitest';
import {
  canAccessEcommerceOrders,
  canUseEcommerceOrderRealtime,
  getEcommerceOrderCapabilityReason,
  getEcommerceOrderDeviceRole,
  isEcommerceOrderRoleResolving
} from '../ecommerceOrderCapabilities';

const license = (features = {}) => ({
  features,
  realtime_topic: 'license:fixture'
});

const staff = (permissions = {}) => ({
  currentDeviceRole: 'staff',
  currentStaffUser: { permissions }
});

const inboxLicense = license({ ecommerce_order_inbox: true });

describe('ecommerceOrderCapabilities', () => {
  it('allows an admin when the inbox feature is enabled', () => {
    expect(canAccessEcommerceOrders(
      inboxLicense,
      { currentDeviceRole: 'admin' }
    )).toBe(true);
  });

  it('allows staff with ecommerce even when settings is disabled', () => {
    expect(canAccessEcommerceOrders(
      inboxLicense,
      staff({ ecommerce: true, settings: false, notifications: false })
    )).toBe(true);
  });

  it('blocks staff without ecommerce permission', () => {
    const session = staff({ ecommerce: false, settings: true, notifications: true });

    expect(canAccessEcommerceOrders(inboxLicense, session)).toBe(false);
    expect(getEcommerceOrderCapabilityReason(inboxLicense, session))
      .toBe('ECOMMERCE_STAFF_PERMISSION_DENIED');
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

  it('does not infer admin while the device role is unresolved', () => {
    const unresolved = { currentDeviceRole: null, currentStaffUser: null };

    expect(getEcommerceOrderDeviceRole(unresolved)).toBeNull();
    expect(canAccessEcommerceOrders(inboxLicense, unresolved)).toBe(false);
    expect(getEcommerceOrderCapabilityReason(inboxLicense, unresolved))
      .toBe('ECOMMERCE_ORDERS_ACCESS_DENIED');
  });

  it('recognizes an unresolved role only as loading when bootstrap is active', () => {
    expect(isEcommerceOrderRoleResolving({
      currentDeviceRole: null,
      _isInitializing: true
    })).toBe(true);
    expect(isEcommerceOrderRoleResolving({
      currentDeviceRole: null,
      _isInitializing: false
    })).toBe(false);
  });

  it('blocks unknown roles', () => {
    const unknown = { currentDeviceRole: 'owner' };

    expect(canAccessEcommerceOrders(inboxLicense, unknown)).toBe(false);
    expect(getEcommerceOrderCapabilityReason(inboxLicense, unknown))
      .toBe('ECOMMERCE_ORDERS_ACCESS_DENIED');
  });

  it('keeps the explicit isStaff fallback fail closed', () => {
    expect(getEcommerceOrderDeviceRole({ isStaff: true })).toBe('staff');
    expect(canAccessEcommerceOrders(
      inboxLicense,
      { isStaff: true, permissions: { ecommerce: true } }
    )).toBe(true);
    expect(canAccessEcommerceOrders(inboxLicense, {})).toBe(false);
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

    expect(canUseEcommerceOrderRealtime(
      license({ ecommerce_order_inbox: true, ecommerce_realtime_orders: true }),
      { currentDeviceRole: null }
    )).toBe(false);
  });
});
