import { describe, expect, it, vi } from 'vitest';
import {
  canManageEcommercePortal,
  resolveAllowedSettingsTab
} from '../settingsPageAccess';

const buildCanAccess = (permissions) => vi.fn(
  (permission) => permissions[permission] === true
);

describe('settingsPageAccess', () => {
  it('allows an admin device with settings permission', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true }),
      currentDeviceRole: 'admin'
    })).toBe(true);
  });

  it('allows staff only when settings and ecommerce are both enabled', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true, ecommerce: true }),
      currentDeviceRole: 'staff'
    })).toBe(true);
  });

  it('blocks staff without ecommerce', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true, ecommerce: false }),
      currentDeviceRole: 'staff'
    })).toBe(false);
  });

  it('blocks staff without settings', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: false, ecommerce: true }),
      currentDeviceRole: 'staff'
    })).toBe(false);
  });

  it('falls back instead of honoring a direct unauthorized portal tab', () => {
    expect(resolveAllowedSettingsTab({
      requestedTab: 'portal-online',
      visibleTabs: [{ key: 'general', allowed: true }]
    })).toBe('general');
  });
});
