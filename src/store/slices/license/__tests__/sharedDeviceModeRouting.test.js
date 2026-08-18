import { describe, expect, it } from 'vitest';
import { resolveStaffAuthRoutingDecision } from '../../../../services/deviceModePolicy';

describe('shared device staff routing', () => {
  it('uses admin_only capability before legacy staff metadata', () => {
    expect(resolveStaffAuthRoutingDecision({}, {
      device_mode: 'admin_only',
      device_role: 'staff'
    })).toBe(false);
  });

  it('uses staff_only capability before legacy admin metadata', () => {
    expect(resolveStaffAuthRoutingDecision({}, {
      device_mode: 'staff_only',
      device_role: 'admin'
    })).toBe(true);
  });

  it('allows an explicit Staff choice on shared legacy-admin metadata', () => {
    expect(resolveStaffAuthRoutingDecision({
      currentDeviceRole: 'staff',
      appStatus: 'staff_login_required'
    }, {
      device_mode: 'shared',
      device_role: 'admin'
    })).toBe(true);
  });

  it('does not infer a shared actor from legacy admin metadata', () => {
    expect(resolveStaffAuthRoutingDecision({}, {
      device_mode: 'shared',
      device_role: 'admin'
    })).toBeNull();
  });
});
