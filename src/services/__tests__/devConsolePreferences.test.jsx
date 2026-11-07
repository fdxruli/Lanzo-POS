// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import {
  activateActorScopedStorage, invalidateActorScopedStorage,
  prepareActorScopedStorage, resumeActorScopedStorageWrites
} from '../auth/actorScopedStorage';
import {
  getDevConsolePreference, installDevConsolePreferences, setDevConsoleVisible
} from '../devConsolePreferences';
import DevConsole from '../../components/debug/DevConsole';
import OperationalSettings from '../../components/settings/OperationalSettings';
import { clearDevConsoleEntries, getDevConsoleEntries, installDevConsoleCapture } from '../devConsoleCapture';

const mocks = vi.hoisted(() => ({
  tenant: { opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', databaseName: 'LanzoDB_t_test', generation: 1 },
  storeAuthorized: true,
  appState: {
    licenseDetails: { features: {} }, cashOpeningPolicy: 'manual',
    showTicker: false, showAssistantBot: false, enableMultipleOrders: false
  }
}));
vi.mock('../db/tenantRuntimeRouter', () => ({ getTenantRuntimeReadiness: () => ({ ready: true, runtime: mocks.tenant }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: selector => selector(mocks.appState) }));
vi.mock('../../hooks/pos/useActiveOrders', () => ({ useActiveOrders: selector => selector({ activeOrders: new Map() }) }));
vi.mock('../../hooks/useFeatureConfig', () => ({ useFeatureConfig: () => ({ hasTables: false }) }));
vi.mock('../diagnostics/incidentEventCenter', () => ({ captureAsyncIncidentNotice: vi.fn() }));

// This suite exercises diagnostic preference persistence, not Settings routing.
// The real actor-scoped storage and diagnostic authority remain in use.
vi.mock('../auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ canAccessSection: (section) => section === 'controls' }),
  useSettingsActionGuard: () => () => ({ assertCurrent: () => true })
}));

const mountActor = async (id = 'a', permissions = ['settings']) => {
  invalidateActorScopedStorage();
  actorRuntimeController.lock();
  actorRuntimeController.beginAuthentication({ actorType: 'staff' });
  const actor = actorRuntimeController.grant({ actorType: 'staff', actorId: id, sessionId: 'synthetic', permissions });
  await prepareActorScopedStorage({ tenant: mocks.tenant, actorKey: actor.actorKey, actorGeneration: actor.generation });
  activateActorScopedStorage(actor);
  resumeActorScopedStorageWrites();
};

beforeEach(async () => {
  localStorage.clear();
  mocks.storeAuthorized = true;
  mocks.tenant = { ...mocks.tenant, opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 };
  installDevConsolePreferences({
    canAccessSettings: (actor) => mocks.storeAuthorized && actor.permissions.some((permission) => (
      permission === 'settings_controls' || permission === 'settings'
    ))
  });
  await mountActor();
});
afterEach(() => {
  cleanup();
  invalidateActorScopedStorage();
  actorRuntimeController.lock();
  clearDevConsoleEntries();
  vi.restoreAllMocks();
});

describe('diagnostic preference with real actor storage and authority', () => {
  it('defaults off, toggles through Controls, closes an open panel and restores after restart-style actor remount', async () => {
    render(<><OperationalSettings /><DevConsole /></>);
    const toggle = screen.getByRole('checkbox', { name: 'Activar consola de diagnóstico' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Abrir consola de diagnóstico' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
    expect(screen.getByRole('region', { name: 'Consola de diagnóstico' })).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Consola de diagnóstico' })).toBeNull();
    await act(async () => { await mountActor(); });
    expect(getDevConsolePreference().enabled).toBe(false);
    fireEvent.click(toggle);
    await act(async () => { await mountActor(); });
    expect(getDevConsolePreference().enabled).toBe(true);
    // New actor context remounts the launcher, never the previously open panel.
    expect(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' })).toBeVisible();
  });

  it('isolates preference and clears the sanitized buffer on actor and tenant transitions', async () => {
    installDevConsoleCapture();
    const consoleState = window.__LANZO_DEV_CONSOLE_STATE__;
    try {
      setDevConsoleVisible(true);
      consoleState.originals.info = vi.fn();
      console.info({ diagnosticOperation: 'sync.status', diagnosticState: 'online' });
      expect(getDevConsoleEntries()).toHaveLength(1);
      await mountActor('b');
      expect(getDevConsolePreference().enabled).toBe(false);
      expect(getDevConsoleEntries()).toEqual([]);
      await mountActor('a');
      expect(getDevConsolePreference().enabled).toBe(true);
      mocks.tenant = { ...mocks.tenant, opaqueId: 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', generation: 2 };
      await mountActor('a');
      expect(getDevConsolePreference().enabled).toBe(false);
    } finally { clearDevConsoleEntries(); }
  });

  it('fails closed for missing settings permission, mismatched store authority and foreign-tab fences', async () => {
    await mountActor('limited', ['sales']);
    setDevConsoleVisible(true);
    expect(getDevConsolePreference()).toMatchObject({ authorized: false, enabled: false });
    await mountActor();
    mocks.storeAuthorized = false;
    setDevConsoleVisible(true);
    expect(getDevConsolePreference().enabled).toBe(false);
    mocks.storeAuthorized = true;
    await mountActor();
    setDevConsoleVisible(true);
    const contextKey = `lanzo:t:${mocks.tenant.opaqueId}:actor-runtime-context:v1`;
    localStorage.removeItem(contextKey);
    window.dispatchEvent(new StorageEvent('storage', { key: contextKey }));
    expect(getDevConsolePreference()).toMatchObject({ authorized: false, enabled: false });
  });

  it('hides immediately and reports a persistence failure when local storage cannot be written', () => {
    setDevConsoleVisible(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    setDevConsoleVisible(false);
    expect(getDevConsolePreference()).toMatchObject({ enabled: false, persistenceError: true });
  });

  it('installs preference subscriptions and the storage listener once', () => {
    const add = vi.spyOn(window, 'addEventListener');
    installDevConsolePreferences(); installDevConsolePreferences();
    expect(add).not.toHaveBeenCalled();
  });
});
