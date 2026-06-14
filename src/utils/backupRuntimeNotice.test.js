import { describe, expect, it } from 'vitest';
import { getBackupRuntimeNotice } from './backupRuntimeNotice';

function createStatus(overrides = {}) {
  return {
    initialized: true,
    busy: false,
    configured: true,
    supported: true,
    permission: 'granted',
    unlocked: true,
    settings: {
      cronBlocked: false,
      cronPending: false
    },
    ...overrides
  };
}

describe('getBackupRuntimeNotice', () => {
  it('prioriza la reautorizacion de Google Drive', () => {
    const notice = getBackupRuntimeNotice(createStatus({
      configured: false
    }), true);

    expect(notice).toEqual({
      key: 'drive-reauth',
      navbarLabel: 'Reactivar respaldos'
    });
  });

  it('no muestra acciones mientras inicializa o trabaja', () => {
    expect(getBackupRuntimeNotice(createStatus({ initialized: false }), false)).toBeNull();
    expect(getBackupRuntimeNotice(createStatus({ busy: true }), false)).toBeNull();
  });

  it.each([
    [{ configured: false }, 'configure'],
    [{ settings: { cronBlocked: true, cronPending: false } }, 'cron-blocked'],
    [{ unlocked: false }, 'unlock'],
    [{ permission: 'prompt' }, 'permission'],
    [{ settings: { cronBlocked: false, cronPending: true } }, 'cron-pending']
  ])('selecciona el aviso correspondiente para %o', (overrides, expectedKey) => {
    expect(getBackupRuntimeNotice(createStatus(overrides), false)?.key).toBe(expectedKey);
  });

  it('no devuelve aviso cuando los respaldos no requieren atencion', () => {
    expect(getBackupRuntimeNotice(createStatus(), false)).toBeNull();
  });
});
