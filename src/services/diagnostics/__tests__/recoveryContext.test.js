import { describe, expect, it, vi } from 'vitest';
import { createRecoveryContextGuard } from '../recoveryContext';

describe('recovery context guard', () => {
  it('allows a retry only while actor, session, and tenant generations stay the same', () => {
    let snapshot = {
      actorStatus: 'granted',
      actorKey: 'admin:owner',
      sessionId: 'session-a',
      actorGeneration: 4,
      tenantReady: true,
      tenantOpaqueId: 'tenant-a',
      tenantDatabaseName: 'LanzoDB_t_a',
      tenantGeneration: 3
    };
    const guard = createRecoveryContextGuard({ capture: () => snapshot });

    expect(guard()).toBe(true);
    snapshot = { ...snapshot, sessionId: 'session-b', actorGeneration: 5 };
    expect(guard()).toBe(false);
  });

  it('rejects a retry when the tenant changes or context cannot be read', () => {
    let snapshot = { tenantOpaqueId: 'tenant-a', tenantGeneration: 1 };
    const guard = createRecoveryContextGuard({ capture: () => snapshot });
    snapshot = { tenantOpaqueId: 'tenant-b', tenantGeneration: 1 };
    expect(guard()).toBe(false);

    const failed = createRecoveryContextGuard({ capture: () => { throw new Error('restricted'); } });
    expect(failed()).toBe(false);
  });

  it('does not expose a captured context from the guard result', () => {
    const capture = vi.fn(() => ({ sessionId: 'sensitive-session' }));
    const guard = createRecoveryContextGuard({
      capture,
      compare: (left, right) => left.sessionId === right.sessionId
    });
    expect(guard).toBeInstanceOf(Function);
    expect(guard()).toBe(true);
    expect(JSON.stringify(guard())).not.toContain('sensitive-session');
  });
});
