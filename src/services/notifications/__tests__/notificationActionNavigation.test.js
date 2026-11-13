import { describe, expect, it } from 'vitest';
import {
  isPendingSyncConflictNotification,
  resolveNotificationAction
} from '../notificationActionNavigation';

const licenseDetails = {
  license_id: 'test-license',
  features: { ecommerce_order_inbox: true, support_center: true }
};
const permissions = (allowed = {}) => ({
  isAuthorizedActor: true,
  isAdmin: false,
  runtimeSnapshot: {
    status: 'granted', actorType: 'staff', actorId: 'staff-1',
    sessionId: 'session-1', permissions: allowed
  },
  ecommerceSession: {
    currentDeviceRole: 'staff',
    currentStaffUser: { permissions: allowed }
  },
  permissionSession: {
    currentDeviceRole: 'staff',
    currentStaffUser: { permissions: allowed }
  },
  canAccessPermission: (key) => allowed[key] === true
});
const makeContext = (allowed = {}, tabs = []) => ({
  actorAccess: permissions(allowed),
  licenseDetails,
  settingsAccess: { canAccessSection: (key) => tabs.includes(key) }
});
const notif = (type, event, route = '/configuracion') => ({
  type,
  action_route: route,
  action_label: 'Revisar',
  metadata: { event }
});
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

describe('PRO notification action contract', () => {
  it('NOTIF-ACTION-01: opens the authorized License tab', () => {
    expect(resolveNotificationAction(notif('license', 'license_expiry'), makeContext({}, ['license'])))
      .toEqual({ kind: 'navigate', route: '/configuracion?tab=license', label: 'Ver licencia' });
  });

  it('NOTIF-ACTION-02: targets Devices for disabled and limit events', () => {
    for (const event of ['device_disabled', 'device_limit_reached']) {
      expect(resolveNotificationAction(notif('system', event), makeContext({}, ['devices']))?.route)
        .toBe('/configuracion?tab=devices');
    }
  });

  it('NOTIF-ACTION-03: no deep link is invented for the Staff internal panel', () => {
    expect(resolveNotificationAction(notif('system', 'staff_disabled'), makeContext({}, ['license'])))
      .toBeNull();
  });

  it('NOTIF-ACTION-04: sync conflict stays informational, even with the legacy URL', () => {
    const input = notif('sync', 'sync_errors_active');
    expect(isPendingSyncConflictNotification(input)).toBe(true);
    expect(resolveNotificationAction(input, makeContext({}, ['license', 'devices']))).toBeNull();
  });

  it('NOTIF-ACTION-05: refuses arbitrary and invalid routes', () => {
    expect(resolveNotificationAction(notif('system', 'unknown', '/configuracion'), makeContext({}, ['license'])))
      .toBeNull();
    expect(resolveNotificationAction(notif('ecommerce', 'order', '/configuracion'), makeContext({ ecommerce: true })))
      .toBeNull();
    expect(resolveNotificationAction(notif('ecommerce', 'order', '/pedidos-online?order=bad'), makeContext({ ecommerce: true })))
      .toBeNull();
  });

  it('NOTIF-ACTION-06: notification visibility does not confer administrative permissions', () => {
    const actor = makeContext({ notifications: true });
    expect(resolveNotificationAction(notif('license', 'license_expiry'), actor)).toBeNull();
    expect(resolveNotificationAction(notif('system', 'device_disabled'), actor)).toBeNull();
  });

  it('NOTIF-ACTION-07: preserves only a valid and authorized order deep link', () => {
    const input = notif('ecommerce', 'order', `/pedidos-online?order=${ORDER_ID}`);
    expect(resolveNotificationAction(input, makeContext({ ecommerce: true }))?.route)
      .toBe(`/pedidos-online?order=${ORDER_ID}`);
    expect(resolveNotificationAction(input, makeContext({ notifications: true }))).toBeNull();
    expect(resolveNotificationAction({ ...input, action_route: `/pedidos-online?order=${ORDER_ID}&unsafe=1` }, makeContext({ ecommerce: true })))
      .toBeNull();
  });

  it('NOTIF-ACTION-08: inventory retains its report and products permission fallbacks', () => {
    const input = { type: 'inventory', action_route: '/configuracion', metadata: { classification: 'expired' } };
    expect(resolveNotificationAction(input, makeContext({ reports: true }))?.route)
      .toBe('/ventas?tab=expiration');
    expect(resolveNotificationAction(input, makeContext({ products: true }))?.route)
      .toBe('/productos');
    expect(resolveNotificationAction(input, makeContext({ notifications: true }))).toBeNull();
  });

  it('cash alert navigates to Cash only with cash_register permission', () => {
    expect(resolveNotificationAction(notif('cash', 'cash_difference'), makeContext({ cash_register: true }))?.route)
      .toBe('/caja');
    expect(resolveNotificationAction(notif('cash', 'cash_difference'), makeContext({ notifications: true })))
      .toBeNull();
  });

  it('support in-drawer action remains available to authorized actors', () => {
    const input = notif('support', 'support_reply', 'notifications:support');
    expect(resolveNotificationAction(input, makeContext({ support_center: true }))?.kind)
      .toBe('support');
    expect(resolveNotificationAction(input, makeContext({ notifications: true }))).toBeNull();
  });

  it('denies all destinations without a validated actor', () => {
    const access = makeContext({ ecommerce: true }, ['license', 'devices']);
    access.actorAccess.isAuthorizedActor = false;
    expect(resolveNotificationAction(notif('license', 'license_expiry'), access)).toBeNull();
  });
});
