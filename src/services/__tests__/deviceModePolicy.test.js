import { describe, expect, it } from 'vitest';
import {
  DEVICE_MODES,
  deviceModeAllowsActor,
  getDeviceModeLabel,
  resolveDeviceMode
} from '../deviceModePolicy';

describe('deviceModePolicy', () => {
  it('maps legacy devices conservatively without inventing shared mode', () => {
    expect(resolveDeviceMode({ device_role: 'admin' })).toBe(DEVICE_MODES.ADMIN_ONLY);
    expect(resolveDeviceMode({ device_role: 'staff' })).toBe(DEVICE_MODES.STAFF_ONLY);
    expect(resolveDeviceMode({ device_role: 'unknown' })).toBeNull();
  });

  it('keeps explicit shared mode independent from legacy role', () => {
    const device = { device_mode: 'shared', device_role: 'admin' };

    expect(resolveDeviceMode(device)).toBe(DEVICE_MODES.SHARED);
    expect(deviceModeAllowsActor(device, 'admin')).toBe(true);
    expect(deviceModeAllowsActor(device, 'staff')).toBe(true);
    expect(getDeviceModeLabel(device)).toBe('Compartido');
  });

  it('enforces actor capability for admin_only and staff_only', () => {
    expect(deviceModeAllowsActor('admin_only', 'admin')).toBe(true);
    expect(deviceModeAllowsActor('admin_only', 'staff')).toBe(false);
    expect(deviceModeAllowsActor('staff_only', 'staff')).toBe(true);
    expect(deviceModeAllowsActor('staff_only', 'admin')).toBe(false);
  });
});
