import { describe, expect, it } from 'vitest';
import {
  evaluateSettingsAccess,
  resolveAllowedSettingsTab
} from '../settingsAccessPolicy';

const runtime = ({
  actorType = 'staff',
  actorId = 'staff-a',
  permissions = []
} = {}) => ({
  status: 'granted',
  actorType,
  actorId,
  actorKey: `${actorType}:${actorId}`,
  sessionId: `${actorId}-session`,
  generation: 7,
  permissions: actorType === 'admin' ? ['*'] : permissions
});

const staffAccess = (permissions = {}) => evaluateSettingsAccess({
  runtimeSnapshot: runtime({ permissions: Object.keys(permissions).filter((key) => permissions[key]) }),
  currentDeviceRole: 'staff',
  currentStaffUser: { id: 'staff-a', permissions },
  currentAdminUser: null,
  isDev: false
});

const tabKeys = (access) => access.visibleTabs.map((tab) => tab.key);

describe('Settings actor access matrix A-G', () => {
  it('A: products alone never grants the Settings shell', () => {
    const access = staffAccess({ products: true });

    expect(access.canEnterSettings).toBe(false);
    expect(tabKeys(access)).toEqual([]);
  });

  it('B: settings grants General and Controls only', () => {
    const access = staffAccess({ settings: true });

    expect(access.canEnterSettings).toBe(true);
    expect(tabKeys(access)).toEqual(['general', 'controls']);
  });

  it('C: license grants its section without General', () => {
    const access = staffAccess({ license: true });

    expect(tabKeys(access)).toEqual(['license']);
    expect(access.canAccessSection('general')).toBe(false);
  });

  it('D: devices grants a distinct device section without License', () => {
    const access = staffAccess({ devices: true });

    expect(tabKeys(access)).toEqual(['devices']);
    expect(access.canAccessSection('license')).toBe(false);
  });

  it('E: sync grants Maintenance and Backup without General', () => {
    const access = staffAccess({ sync: true });

    expect(tabKeys(access)).toEqual(['maintenance', 'backup']);
    expect(access.canAccessPermission('inventory')).toBe(false);
  });

  it('F: inventory grants Maintenance without sync-only Backup', () => {
    const access = staffAccess({ inventory: true });

    expect(tabKeys(access)).toEqual(['maintenance']);
    expect(access.canAccessSection('backup')).toBe(false);
  });

  it('G: zero Settings permissions fails closed with no tab fallback', () => {
    const access = staffAccess({});

    expect(access.canEnterSettings).toBe(false);
    expect(resolveAllowedSettingsTab({ requestedTab: 'general', visibleTabs: access.visibleTabs }))
      .toBeNull();
  });
});

describe('Settings actor evidence', () => {
  it('allows a confirmed Admin actor', () => {
    const access = evaluateSettingsAccess({
      runtimeSnapshot: runtime({ actorType: 'admin', actorId: 'admin-a' }),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' }
    });

    expect(access.canEnterSettings).toBe(true);
    expect(tabKeys(access)).toEqual([
      'general', 'controls', 'license', 'devices', 'maintenance', 'backup'
    ]);
  });

  it.each([
    ['locked runtime', { status: 'locked', generation: 8 }, 'admin', { id: 'admin-a' }, null],
    ['missing Admin identity', runtime({ actorType: 'admin', actorId: 'admin-a' }), 'admin', null, null],
    ['mismatched Staff identity', runtime(), 'staff', null, { id: 'staff-b', permissions: { settings: true } }],
    ['lagging device role', runtime({ actorType: 'staff' }), 'admin', { id: 'admin-a' }, null]
  ])('fails closed for %s', (_label, runtimeSnapshot, currentDeviceRole, currentAdminUser, currentStaffUser) => {
    const access = evaluateSettingsAccess({
      runtimeSnapshot,
      currentDeviceRole,
      currentAdminUser,
      currentStaffUser
    });

    expect(access.canEnterSettings).toBe(false);
    expect(access.visibleTabs).toEqual([]);
  });

  it('intersects runtime and Staff-store permissions to deny stale grants', () => {
    const access = evaluateSettingsAccess({
      runtimeSnapshot: runtime({ permissions: ['settings', 'license'] }),
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-a',
        permissions: { settings: false, license: true }
      }
    });

    expect(access.canAccessPermission('settings')).toBe(false);
    expect(tabKeys(access)).toEqual(['license']);
  });
});
