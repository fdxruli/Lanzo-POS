import { describe, expect, it, vi } from 'vitest';
import {
  ACTOR_HANDOFF_PENDING_OPERATIONS,
  assertActorOperationalHandoffClear,
  getPendingActorOperations,
  runTrackedActorOperationWithHandle
} from '../actorOperationalHandoff';

const TENANT = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 10
});

const createHandle = () => {
  let stale = false;
  return {
    actorKey: 'admin:admin-a',
    actorType: 'admin',
    actorId: 'admin-a',
    generation: 5,
    tenant: TENANT,
    makeStale() { stale = true; },
    assertCurrent() {
      if (stale) {
        const error = new Error('ACTOR_CONTEXT_STALE');
        error.code = 'ACTOR_CONTEXT_STALE';
        throw error;
      }
      return { actorKey: 'admin:admin-a', generation: 5, tenant: TENANT };
    }
  };
};

describe('actor operational handoff barrier', () => {
  it('blocks a new actor while an actor-sensitive async operation is pending', async () => {
    const handle = createHandle();
    let release;
    const wait = new Promise((resolve) => { release = resolve; });

    const pending = runTrackedActorOperationWithHandle(
      handle,
      'activeOrders.pauseOrder',
      async () => {
        await wait;
        return 'done';
      }
    );

    expect(getPendingActorOperations()).toEqual([
      expect.objectContaining({
        label: 'activeOrders.pauseOrder',
        actorKey: 'admin:admin-a',
        actorGeneration: 5,
        tenantOpaqueId: TENANT.opaqueId
      })
    ]);
    expect(() => assertActorOperationalHandoffClear({ tenant: TENANT })).toThrowError(
      expect.objectContaining({ code: ACTOR_HANDOFF_PENDING_OPERATIONS })
    );

    release();
    await expect(pending).resolves.toBe('done');
    expect(getPendingActorOperations()).toHaveLength(0);
    expect(assertActorOperationalHandoffClear({ tenant: TENANT })).toBe(true);
  });

  it('never runs a guarded write after the captured actor becomes stale', async () => {
    const handle = createHandle();
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const write = vi.fn();

    const pending = runTrackedActorOperationWithHandle(
      handle,
      'orderStore.addSmartItem.batchResolution',
      async ({ guardedWrite }) => {
        await wait;
        return guardedWrite(write);
      }
    );

    handle.makeStale();
    release();

    await expect(pending).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(write).not.toHaveBeenCalled();
    expect(getPendingActorOperations()).toHaveLength(0);
  });
});
