import { describe, expect, it } from 'vitest';
import { getLocalBackupAttention, LOCAL_BACKUP_ROUTE } from './backupRuntimeNotice';
const status = (patch = {}) => ({ initialized: true, busy: false, configured: true, supported: true, permission: 'granted', unlocked: true, settings: {}, ...patch });
describe('local backup condition projection', () => {
  it.each([
    [{ configured: false }, 'configure'],
    [{ unlocked: false }, 'unlock'],
    [{ permission: 'denied', unlocked: false }, 'permission'],
    [{ settings: { cronPending: true } }, 'pending'],
    [{ settings: { cronBlocked: true }, unlocked: false }, 'error'],
    [{ settings: { lastResult: 'error', lastError: 'private path' } }, 'error']
  ])('projects real condition %o', (patch, key) => {
    const condition = getLocalBackupAttention(status(patch));
    expect(condition).toMatchObject({ key, active: true, route: LOCAL_BACKUP_ROUTE });
    expect(JSON.stringify(condition)).not.toContain('private path');
  });
  it('does not infer a success during initialization, work or before the first backup', () => {
    expect(getLocalBackupAttention(status({ initialized: false }))).toBeNull();
    expect(getLocalBackupAttention(status({ busy: true }))).toBeNull();
    expect(getLocalBackupAttention(status()).title).toBe('Listo para respaldar');
    expect(getLocalBackupAttention(status({ settings: { lastResult: 'success', lastBackupAt: '2026-10-17T12:00:00Z' } })).title).toBe('Protección local activa');
  });
  it('distinguishes manual download support from automatic folder protection', () => {
    const result = getLocalBackupAttention(status({ supported: false, permission: 'unsupported', settings: { lastResult: 'success', lastBackupAt: '2026-10-17' } }));
    expect(result.title).toBe('Última copia local realizada');
    expect(result.detail).toContain('manualmente');
    expect(getLocalBackupAttention(status({ supported: false, settings: { cronPending: true } })).key).toBe('pending');
  });
  it('keeps Drive reauthorization distinct', () => {
    expect(getLocalBackupAttention(status({ configured: false }), true).key).toBe('drive-reauth');
  });
});
