/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createDriveSlice, DRIVE_SESSION_KEY } from './createDriveSlice';

describe('createDriveSlice', () => {
  beforeEach(() => {
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
      expiresAt: now + 3_600_000
    });
    expect(localStorage.length).toBe(0);
  });

  it('hidrata una sesion vigente', () => {
    const expiresAt = Date.now() + 60_000;
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken: 'persisted-token',
      expiresAt
    }));

    const store = create(createDriveSlice);

    expect(store.getState().driveAccessToken).toBe('persisted-token');
    expect(store.getState().driveTokenExpiresAt).toBe(expiresAt);
    expect(store.getState().isDriveConnected).toBe(true);
    expect(store.getState().needsDriveReauth).toBe(false);
  });

  it('descarta una sesion expirada y solicita reautorizacion', () => {
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken: 'expired-token',
      expiresAt: Date.now() - 1
    }));

    const store = create(createDriveSlice);

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().driveTokenExpiresAt).toBeNull();
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
    expect(store.getState().isDriveConnected).toBe(false);
    expect(store.getState().needsDriveReauth).toBe(needsDriveReauth);
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
