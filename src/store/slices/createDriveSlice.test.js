/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createDriveSlice, DRIVE_CONNECTED_KEY } from './createDriveSlice';

describe('createDriveSlice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persiste solo el flag de conexion', () => {
    const store = create(createDriveSlice);

    store.getState().connectDrive({
      accessToken: 'temporary-token',
      expiresIn: 3600
    });

    expect(store.getState().driveAccessToken).toBe('temporary-token');
    expect(localStorage.getItem(DRIVE_CONNECTED_KEY)).toBe('true');
    expect(JSON.stringify(localStorage)).not.toContain('temporary-token');
  });

  it('limpia token, expiracion y flag al desconectar', () => {
    const store = create(createDriveSlice);
    store.getState().connectDrive({
      accessToken: 'temporary-token',
      expiresIn: 3600
    });

    store.getState().disconnectDrive();

    expect(store.getState().driveAccessToken).toBeNull();
    expect(store.getState().driveTokenExpiresAt).toBeNull();
    expect(store.getState().isDriveConnected).toBe(false);
    expect(localStorage.getItem(DRIVE_CONNECTED_KEY)).toBeNull();
  });
});
