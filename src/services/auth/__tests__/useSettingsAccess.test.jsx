// @vitest-environment jsdom
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

import { useSettingsAccess } from '../useSettingsAccess';

const runtimeFor = (actorType, actorId, permissions, generation) => ({
  status: 'granted',
  actorType,
  actorId,
  actorKey: `${actorType}:${actorId}`,
  sessionId: `${actorId}-session`,
  permissions,
  generation
});

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
