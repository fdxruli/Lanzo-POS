/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createDriveSlice, DRIVE_SESSION_KEY } from './createDriveSlice';
import { localTenantAccessController } from '../../services/tenant/localTenantPolicy';

const tenantContext = vi.hoisted(() => ({ current: null }));

vi.mock('../../services/tenant/tenantWorkerContext', () => ({
  captureActiveTenantWorkerContext: () => {
    if (!tenantContext.current) throw new Error('tenant context missing');
    return tenantContext.current;
  }
}));

const grantTenant = (name) => {
  localTenantAccessController.enable('test');
  localTenantAccessController.grant({ aliases: [`license-id:${name}`] }, 'test');
  tenantContext.current = {
    databaseName: `LanzoDB_t_${name}`,
    generation: 1,
    tenantAliases: [`license-id:${name}`]
  };
};

describe('createDriveSlice', () => {
  beforeEach(() => {
    localTenantAccessController.reset();
    tenantContext.current = null;
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('persiste token y expiracion solo durante la sesion', () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const store = create(createDriveSlice);

    store.getState().connectDrive({
      accessToken: 'temporary-token',
      expiresIn: 3600
    });

    expect(store.getState().driveAccessToken).toBe('temporary-token');
    expect(store.getState().driveTokenExpiresAt).toBe(now + 3_600_000);
    expect(store.getState().needsDriveReauth).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(DRIVE_SESSION_KEY))).toEqual({
      accessToken: 'temporary-token',
      expiresAt: now + 3_600_000,
      tenantBinding: 'unscoped-development-session'
    });
    expect(localStorage.length).toBe(0);
  });

  it('hidrata una sesion vigente', () => {
    grantTenant('business-a');
    const expiresAt = Date.now() + 60_000;
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken: 'persisted-token',
      expiresAt,
      tenantBinding: 'LanzoDB_t_business-a'
    }));

    const store = create(createDriveSlice);

    expect(store.getState().driveAccessToken).toBe('persisted-token');
    expect(store.getState().driveTokenExpiresAt).toBe(expiresAt);
    expect(store.getState().driveTenantBinding).toBe('LanzoDB_t_business-a');
    expect(store.getState().isDriveConnected).toBe(true);
    expect(store.getState().needsDriveReauth).toBe(false);
  });

  it('descarta una sesion expirada y solicita reautorizacion', () => {
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken: 'expired-token',
      expiresAt: Date.now() - 1,
      tenantBinding: 'unscoped-development-session'
    }));

    const store = create(createDriveSlice);

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().driveTokenExpiresAt).toBeNull();
    expect(store.getState().driveTenantBinding).toBeNull();
    expect(store.getState().isDriveConnected).toBe(false);
    expect(store.getState().needsDriveReauth).toBe(true);
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it.each([
    ['clearDriveSession', false],
    ['disconnectDrive', false],
    ['markDriveNeedsReauth', true]
  ])('limpia la sesion al ejecutar %s', (action, needsDriveReauth) => {
    const store = create(createDriveSlice);
    store.getState().connectDrive({
      accessToken: 'temporary-token',
      expiresIn: 3600
    });

    store.getState()[action]();

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().driveTokenExpiresAt).toBeNull();
    expect(store.getState().driveTenantBinding).toBeNull();
    expect(store.getState().isDriveConnected).toBe(false);
    expect(store.getState().needsDriveReauth).toBe(needsDriveReauth);
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it('locks the in-memory session without deleting its tenant-bound token', () => {
    grantTenant('business-a');
    const store = create(createDriveSlice);
    store.getState().connectDrive({ accessToken: 'tenant-a-token', expiresIn: 3600 });
    const persisted = sessionStorage.getItem(DRIVE_SESSION_KEY);

    store.getState().lockDriveSession();

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().isDriveConnected).toBe(false);
    expect(store.getState().driveTenantBinding).toBeNull();
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBe(persisted);
  });

  it('does not rehydrate a Drive token after the active tenant changes', () => {
    grantTenant('business-a');
    const store = create(createDriveSlice);
    store.getState().connectDrive({ accessToken: 'tenant-a-token', expiresIn: 3600 });
    store.getState().lockDriveSession();

    grantTenant('business-b');
    store.getState().refreshDriveSession();

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().isDriveConnected).toBe(false);
    expect(store.getState().driveTenantBinding).toBeNull();
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it('clears a persisted session from before tenant binding was added', () => {
    grantTenant('business-a');
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken: 'unbound-token',
      expiresAt: Date.now() + 60_000
    }));

    const store = create(createDriveSlice);

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().isDriveConnected).toBe(false);
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it('rejects an OAuth callback while tenant access is locked', () => {
    localTenantAccessController.enable('logout');
    const store = create(createDriveSlice);

    expect(store.getState().connectDrive({
      accessToken: 'late-token-a',
      expiresIn: 3600
    })).toBe(false);
    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().driveTenantBinding).toBeNull();
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it('mantiene el flujo en memoria si sessionStorage esta bloqueado', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    const store = create(createDriveSlice);
    store.getState().connectDrive({
      accessToken: 'memory-only-token',
      expiresIn: 3600
    });

    expect(store.getState().driveAccessToken).toBe('memory-only-token');
    expect(store.getState().isDriveConnected).toBe(true);
  });
});
