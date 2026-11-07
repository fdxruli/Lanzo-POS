// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  permissions: {},
  isAdmin: false,
  getPreparationStations: vi.fn(async () => ({ success: true, stations: [] })),
  upsertPreparationStation: vi.fn(async () => ({ success: true, stations: [] })),
  togglePreparationStation: vi.fn(async () => ({ success: true, stations: [] }))
}));

const granularKeys = ['settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup'];
const hasPermission = (permission) => {
  if (state.isAdmin) return true;
  if (permission === 'settings_controls') {
    const hasGranularPermission = granularKeys.some((key) => (
      Object.prototype.hasOwnProperty.call(state.permissions, key)
    ));
    return hasGranularPermission
      ? state.permissions.settings_controls === true
      : state.permissions.settings === true;
  }
  return state.permissions[permission] === true;
};

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    licenseDetails: {
      valid: true,
      license_key: 'LANZO-PRO',
      features: { preparation_stations: true }
    }
  })
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    isAdmin: state.isAdmin,
    canAccessPermission: hasPermission
  }),
  useSettingsActionGuard: () => (permission) => {
    if (!hasPermission(permission)) throw new Error('ACTOR_PERMISSION_DENIED');
    return {
      assertCurrent: vi.fn(() => {
        if (!hasPermission(permission)) throw new Error('ACTOR_CONTEXT_STALE');
      })
    };
  }
}));

vi.mock('../../../services/restaurant/preparationStationsRepository', () => ({
  preparationStationsRepository: {
    getFallbackPreparationStations: () => [],
    getPreparationStations: state.getPreparationStations,
    upsertPreparationStation: state.upsertPreparationStation,
    togglePreparationStation: state.togglePreparationStation
  }
}));

import { usePreparationStations } from '../usePreparationStations';

describe('preparation station controls follow verified Settings permissions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.permissions = {};
    state.isAdmin = false;
  });

  it('does not let legacy settings grant station controls when Controles is explicitly off', async () => {
    state.permissions = {
      settings: true,
      settings_data: true,
      settings_controls: false,
      settings_maintenance: false,
      settings_backup: false
    };
    const hook = renderHook(() => usePreparationStations({ autoLoad: false }));

    expect(hook.result.current.canManageStations).toBe(false);
    await expect(hook.result.current.createStation({ name: 'Cocina caliente' }))
      .rejects.toThrow('no permiten gestionar');
    expect(state.upsertPreparationStation).not.toHaveBeenCalled();
  });

  it('rechecks Controles after an async station update', async () => {
    state.permissions = { settings_controls: true };
    state.upsertPreparationStation.mockImplementationOnce(async () => {
      state.permissions.settings_controls = false;
      return { success: true, stations: [] };
    });
    const hook = renderHook(() => usePreparationStations({ autoLoad: false }));

    expect(hook.result.current.canManageStations).toBe(true);
    await act(async () => {
      await expect(hook.result.current.createStation({ name: 'Cocina fria' }))
        .rejects.toThrow('ACTOR_CONTEXT_STALE');
    });
    expect(state.upsertPreparationStation).toHaveBeenCalledOnce();
    expect(state.getPreparationStations).not.toHaveBeenCalled();
  });
});
