// @vitest-environment jsdom
import { grantTestActor } from './actorAccessTestHarness';
import { actorRuntimeController } from '../actorRuntimeController';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  app: null,
  runtime: null
}));

vi.mock('../../../store/useAppStore', () => {
  const useAppStore = vi.fn((selector) => selector(state.app));
  useAppStore.getState = () => state.app;
  return { useAppStore };
});

vi.mock('../useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => state.runtime
}));

import { useSettingsAccess, useSettingsActionGuard } from '../useSettingsAccess';

const runtimeFor = (actorType, actorId, permissions) => (
  grantTestActor({ actorType, actorId, permissions })
);

describe('useSettingsAccess actor transitions', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.app = {
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' },
      currentStaffUser: null
    };
    state.runtime = runtimeFor('admin', 'admin-a', ['*'], 1);
  });

  it('recomputes Admin to Staff without inheriting Admin sections', () => {
    const hook = renderHook(() => useSettingsAccess());
    expect(hook.result.current.isAdmin).toBe(true);
    expect(hook.result.current.canAccessSection('general')).toBe(true);

    state.app = {
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { license: true } }
    };
    state.runtime = runtimeFor('staff', 'staff-a', ['license'], 3);
    hook.rerender();

    expect(hook.result.current.isStaff).toBe(true);
    expect(hook.result.current.visibleTabs.map((tab) => tab.key)).toContain('license');
    expect(hook.result.current.visibleTabs.map((tab) => tab.key)).not.toContain('general');
    expect(hook.result.current.canAccessSection('general')).toBe(false);
  });

  it('recomputes Staff A to Staff B without inheriting Staff A permissions', () => {
    state.app = {
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { devices: true } }
    };
    state.runtime = runtimeFor('staff', 'staff-a', ['devices'], 2);
    const hook = renderHook(() => useSettingsAccess());
    expect(hook.result.current.canAccessSection('devices')).toBe(true);

    state.app.currentStaffUser = { id: 'staff-b', permissions: {} };
    state.runtime = runtimeFor('staff', 'staff-b', [], 4);
    hook.rerender();

    expect(hook.result.current.canEnterSettings).toBe(false);
    expect(hook.result.current.visibleTabs).toEqual([]);
  });

  it('reflects refreshed granular permissions for the same Staff session', () => {
    state.app = {
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: {
        id: 'staff-a',
        permissions: {
          settings_data: true,
          settings_controls: false,
          settings_maintenance: false,
          settings_backup: false
        }
      }
    };
    state.runtime = runtimeFor('staff', 'staff-a', ['settings_data']);
    const hook = renderHook(() => useSettingsAccess());
    const generation = hook.result.current.generation;
    expect(hook.result.current.canAccessSection('general')).toBe(true);
    expect(hook.result.current.canAccessSection('controls')).toBe(false);

    state.app.currentStaffUser = {
      id: 'staff-a',
      permissions: {
        settings_data: false,
        settings_controls: true,
        settings_maintenance: false,
        settings_backup: false
      }
    };
    state.runtime = actorRuntimeController.refreshStaffPermissions({
      captured: actorRuntimeController.getState(),
      actorId: 'staff-a',
      permissions: ['settings_controls']
    });
    hook.rerender();

    expect(hook.result.current.generation).toBe(generation);
    expect(hook.result.current.canAccessSection('general')).toBe(false);
    expect(hook.result.current.canAccessSection('controls')).toBe(true);
  });

  it('keeps legacy action capture working only when no granular key exists', () => {
    state.app = {
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { settings: true } }
    };
    state.runtime = runtimeFor('staff', 'staff-a', ['settings']);
    const hook = renderHook(() => useSettingsActionGuard());

    expect(hook.result.current).toBeTypeOf('function');
    expect(hook.result.current('settings_data')).toBeDefined();
    expect(hook.result.current('settings_controls')).toBeDefined();
  });

  it('recomputes Staff to Admin only after the Admin identity is current', () => {
    state.app = {
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { inventory: true } }
    };
    state.runtime = runtimeFor('staff', 'staff-a', ['inventory'], 2);
    const hook = renderHook(() => useSettingsAccess());
    expect(hook.result.current.isStaff).toBe(true);
    expect(hook.result.current.canAccessSection('general')).toBe(false);

    state.runtime = { status: 'locked', generation: 3, permissions: [] };
    hook.rerender();
    expect(hook.result.current.canEnterSettings).toBe(false);

    state.app = {
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-b' },
      currentStaffUser: null
    };
    state.runtime = runtimeFor('admin', 'admin-b', ['*'], 4);
    hook.rerender();

    expect(hook.result.current.isAdmin).toBe(true);
    expect(hook.result.current.canAccessSection('general')).toBe(true);
    expect(hook.result.current.canAccessSection('devices')).toBe(true);
  });

  it('fails closed on runtime lock even while the app store still says Admin', () => {
    const hook = renderHook(() => useSettingsAccess());
    expect(hook.result.current.canEnterSettings).toBe(true);

    state.runtime = { status: 'locked', generation: 2, permissions: [] };
    hook.rerender();

    expect(hook.result.current.canEnterSettings).toBe(false);
    expect(hook.result.current.isAuthorizedActor).toBe(false);
  });
});


describe('Settings action boundary', () => {
  afterEach(cleanup);

  it('rejects an already captured Admin callback after another actor signs in', () => {
    state.app = { currentDeviceRole: 'admin', currentAdminUser: { id: 'admin-a' } };
    state.runtime = runtimeFor('admin', 'admin-a', ['*']);
    const hook = renderHook(() => useSettingsActionGuard());
    const handle = hook.result.current('devices');
    state.app = { currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions: { pos: true } } };
    state.runtime = runtimeFor('staff', 'staff-a', ['pos']);
    expect(() => handle.assertCurrent()).toThrow('ACTOR_CONTEXT_STALE');
    hook.rerender();
    expect(() => hook.result.current('devices')).toThrow('ACTOR_PERMISSION_DENIED');
  });

  it('rejects a captured Staff action after the store revokes its permission', () => {
    state.app = { currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions: { devices: true } } };
    state.runtime = runtimeFor('staff', 'staff-a', ['devices']);
    const hook = renderHook(() => useSettingsActionGuard());
    const handle = hook.result.current('devices');
    state.app.currentStaffUser = { id: 'staff-a', permissions: { devices: false } };
    expect(() => handle.assertCurrent()).toThrow('ACTOR_CONTEXT_STALE');
  });
});
