import { describe, expect, it } from 'vitest';
import { hasStaffValidationContext } from '../licenseStaffActions';

describe('shared device staff routing', () => {
  it('uses admin_only capability before legacy staff metadata', async () => {
    await expect(hasStaffValidationContext({}, {
      device_mode: 'admin_only',
      device_role: 'staff'
    })).resolves.toBe(false);
  });

  it('uses staff_only capability before legacy admin metadata', async () => {
    await expect(hasStaffValidationContext({}, {
      device_mode: 'staff_only',
      device_role: 'admin'
    })).resolves.toBe(true);
  });

  it('allows an explicit Staff choice on shared legacy-admin metadata', async () => {
    await expect(hasStaffValidationContext({
      currentDeviceRole: 'staff',
      appStatus: 'staff_login_required'
    }, {
      device_mode: 'shared',
      device_role: 'admin'
    })).resolves.toBe(true);
  });
});
