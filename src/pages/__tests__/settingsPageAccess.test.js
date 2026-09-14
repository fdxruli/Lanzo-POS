import { describe, expect, it, vi } from 'vitest';
import {
  canManageEcommercePortal,
  resolveAllowedSettingsTab
} from '../settingsPageAccess';

const buildCanAccess = (permissions) => vi.fn(
  (permission) => permissions[permission] === true
);

const FREE_LICENSE = {
  features: { ecommerce_portal_enabled: true }
};

describe('settingsPageAccess', () => {
  it('allows an admin device with settings permission', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true }),
      currentDeviceRole: 'admin',
      licenseDetails: FREE_LICENSE
    })).toBe(true);
  });

  it('allows staff only when settings and ecommerce are both enabled', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true, ecommerce: true }),
      currentDeviceRole: 'staff',
      licenseDetails: FREE_LICENSE
    })).toBe(true);
  });

  it('blocks staff without ecommerce', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true, ecommerce: false }),
      currentDeviceRole: 'staff',
      licenseDetails: FREE_LICENSE
    })).toBe(false);
  });

  it('blocks staff without settings', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: false, ecommerce: true }),
      currentDeviceRole: 'staff',
      licenseDetails: FREE_LICENSE
    })).toBe(false);
  });

  it('blocks an admin when the effective plan/license feature disables the portal', () => {
    expect(canManageEcommercePortal({
      canAccess: buildCanAccess({ settings: true }),
      currentDeviceRole: 'admin',
      licenseDetails: { features: { ecommerce_portal_enabled: false } }
  })).toBe(false);
  });

  it('falls back instead of honoring a direct unauthorized portal tab', () => {
    expect(resolveAllowedSettingsTab({
      requestedTab: 'portal-online',
      visibleTabs: [{ key: 'general', allowed: true }]
    })).toBe('general');
  });

  it('returns no tab instead of falling back to General when access is empty', () => {
    expect(resolveAllowedSettingsTab({
      requestedTab: 'general',
      visibleTabs: []
    })).toBeNull();
  });
});
