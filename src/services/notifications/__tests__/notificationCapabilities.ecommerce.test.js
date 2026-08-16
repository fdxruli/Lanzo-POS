import { describe, expect, it } from 'vitest';
import {
  canStaffAccessEcommerceOperationalAlert,
  canStaffAccessNotificationCategory
} from '../notificationCapabilities';

describe('notification category permissions', () => {
  it('permite administradores', () => {
    expect(canStaffAccessEcommerceOperationalAlert({}, {
      currentDeviceRole: 'admin',
      currentStaffUser: null
    })).toBe(true);

    expect(canStaffAccessNotificationCategory({}, {
      currentDeviceRole: 'admin',
      currentStaffUser: null
    }, 'license')).toBe(true);
  });

  it('mantiene compatibilidad para staff previo sin claves granulares', () => {
    const staffSession = {
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-legacy',
        permissions: { notifications: true }
      }
    };

    expect(canStaffAccessNotificationCategory({}, staffSession, 'ecommerce')).toBe(true);
    expect(canStaffAccessNotificationCategory({}, staffSession, 'support')).toBe(true);
    expect(canStaffAccessNotificationCategory({}, staffSession, 'license')).toBe(true);
    expect(canStaffAccessNotificationCategory({}, staffSession, 'operations')).toBe(true);
    expect(canStaffAccessNotificationCategory({}, staffSession, 'system')).toBe(true);
  });

  it.each([
    ['ecommerce', 'notifications_ecommerce'],
    ['support', 'notifications_support'],
    ['license', 'notifications_license'],
    ['operations', 'notifications_operations'],
    ['system', 'notifications_system']
  ])('respeta el permiso granular %s', (category, permissionKey) => {
    const base = {
      notifications: true,
      notifications_ecommerce: true,
      notifications_support: true,
      notifications_license: true,
      notifications_operations: true,
      notifications_system: true
    };
    const staffSession = {
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-a',
        permissions: { ...base, [permissionKey]: false }
      }
    };

    expect(canStaffAccessNotificationCategory({}, staffSession, category)).toBe(false);
  });

  it('el interruptor maestro bloquea todas las categorias', () => {
    expect(canStaffAccessNotificationCategory({}, {
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-a',
        permissions: {
          notifications: false,
          notifications_ecommerce: true
        }
      }
    }, 'ecommerce')).toBe(false);
  });
});

describe('canStaffAccessEcommerceOperationalAlert', () => {
  it.each([
    [{ notifications: true, settings: true, ecommerce: true }, true],
    [{ notifications: false, settings: true, ecommerce: true }, false],
    [{ notifications: true, notifications_ecommerce: false, settings: true, ecommerce: true }, false],
    [{ notifications: true, notifications_ecommerce: true, settings: false, ecommerce: true }, false],
    [{ notifications: true, notifications_ecommerce: true, settings: true, ecommerce: false }, false]
  ])('aplica categoria + settings + ecommerce para staff %#', (permissions, expected) => {
    expect(canStaffAccessEcommerceOperationalAlert({}, {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-a', permissions }
    })).toBe(expected);
  });
});
