import { describe, expect, it } from 'vitest';
import { getLocalBackupAttention } from './backupRuntimeNotice';

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

describe('getLocalBackupAttention', () => {
  it('prioriza la reautorizacion de Google Drive', () => {
    const notice = getLocalBackupAttention(createStatus({
      configured: false
    }), true);

    expect(notice).toMatchObject({ key: 'drive-reauth', active: true, route: '/configuracion?tab=backup' });
  });

  it('no muestra acciones mientras inicializa o trabaja', () => {
    expect(getLocalBackupAttention(createStatus({ initialized: false }), false)).toBeNull();
    expect(getLocalBackupAttention(createStatus({ busy: true }), false)).toBeNull();
  });

  it.each([
    [{ configured: false }, 'configure'],
    [{ settings: { cronBlocked: true, cronPending: false } }, 'error'],
    [{ unlocked: false }, 'unlock'],
    [{ permission: 'prompt' }, 'permission'],
    [{ settings: { cronBlocked: false, cronPending: true } }, 'pending']
  ])('selecciona el aviso correspondiente para %o', (overrides, expectedKey) => {
    expect(getLocalBackupAttention(createStatus(overrides), false)?.key).toBe(expectedKey);
  });

  it('devuelve un estado sin incidencia cuando los respaldos no requieren atencion', () => {
    expect(getLocalBackupAttention(createStatus(), false)).toMatchObject({ key: 'ready', active: false });
  });
});
