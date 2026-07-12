import { describe, expect, it } from 'vitest';
import { canStaffAccessEcommerceOperationalAlert } from '../notificationCapabilities';

describe('canStaffAccessEcommerceOperationalAlert', () => {
  it('permite administradores', () => {
    expect(canStaffAccessEcommerceOperationalAlert({}, {
      currentDeviceRole: 'admin',
      currentStaffUser: null
    })).toBe(true);
  });

  it.each([
    [{ notifications: true, settings: true, ecommerce: true }, true],
    [{ notifications: false, settings: true, ecommerce: true }, false],
    [{ notifications: true, settings: false, ecommerce: true }, false],
    [{ notifications: true, settings: true, ecommerce: false }, false]
  ])('aplica notifications + settings + ecommerce para staff %#', (permissions, expected) => {
    expect(canStaffAccessEcommerceOperationalAlert({}, {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-a', permissions }
    })).toBe(expected);
  });
});
