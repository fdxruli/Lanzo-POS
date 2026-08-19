import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACTOR_RUNTIME_ERROR_CODES,
  ACTOR_RUNTIME_STATUS,
  actorRuntimeController
} from '../actorRuntimeController';
import {
  runTrackedActorOperationIfGranted,
  runTrackedActorOperationWithHandle
} from '../actorOperationalHandoff';

const TENANT = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 10
});

const createGenerationHandle = ({
  actorKey = 'admin:admin-a',
  generation = 5,
  currentGeneration
} = {}) => {
  const [actorType, actorId] = actorKey.split(':');
  return Object.freeze({
    actorKey,
    actorType,
    actorId,
    generation,
    tenant: TENANT,
    assertCurrent() {
      if (currentGeneration.value !== generation) {
        const error = new Error(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
        error.code = ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE;
        throw error;
      }
      return Object.freeze({ actorKey, actorType, actorId, generation, tenant: TENANT });
    }
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('actor operational authority', () => {
  it.each([
    ACTOR_RUNTIME_STATUS.LOCKED,
    ACTOR_RUNTIME_STATUS.AUTHENTICATING,
    ACTOR_RUNTIME_STATUS.HANDOFF_CHECK
  ])('rejects actor-sensitive work while ActorRuntime is %s without executing the callback', async (status) => {
    const operation = vi.fn();
    const capture = vi.spyOn(actorRuntimeController, 'capture');
    vi.spyOn(actorRuntimeController, 'getState').mockReturnValue({ status });

    await expect(runTrackedActorOperationIfGranted('authority.required', operation)).rejects.toMatchObject({
      code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED,
      details: expect.objectContaining({ status })
    });

    expect(operation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('executes actor-sensitive work only after GRANTED and passes the captured handle', async () => {
    const currentGeneration = { value: 5 };
    const handle = createGenerationHandle({ currentGeneration });
    vi.spyOn(actorRuntimeController, 'getState').mockReturnValue({ status: ACTOR_RUNTIME_STATUS.GRANTED });
    vi.spyOn(actorRuntimeController, 'capture').mockReturnValue(handle);
    const write = vi.fn(() => 'written');
    const operation = vi.fn(async ({ handle: captured, guardedWrite }) => {
      expect(captured).toBe(handle);
      return guardedWrite(write);
    });

    await expect(runTrackedActorOperationIfGranted('authority.granted', operation)).resolves.toBe('written');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale async completion after Admin logout / later generation and never performs the guarded write', async () => {
    const currentGeneration = { value: 5 };
    const handle = createGenerationHandle({ currentGeneration });
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const write = vi.fn();

    const pending = runTrackedActorOperationWithHandle(
      handle,
      'authority.stale-async',
      async ({ guardedWrite }) => {
        await wait;
        return guardedWrite(write);
      }
    );

    currentGeneration.value = 6;
    release();

    await expect(pending).rejects.toMatchObject({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps an old same-actor generation stale while a new generation is valid', async () => {
    const currentGeneration = { value: 5 };
    const oldHandle = createGenerationHandle({ currentGeneration, generation: 5 });

    currentGeneration.value = 7;
    const newHandle = createGenerationHandle({ currentGeneration, generation: 7 });
    const oldWrite = vi.fn();
    const newWrite = vi.fn(() => 'new-generation-write');

    await expect(runTrackedActorOperationWithHandle(
      oldHandle,
      'authority.same-actor-old-generation',
      async ({ guardedWrite }) => guardedWrite(oldWrite)
    )).rejects.toMatchObject({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE });

    await expect(runTrackedActorOperationWithHandle(
      newHandle,
      'authority.same-actor-new-generation',
      async ({ guardedWrite }) => guardedWrite(newWrite)
    )).resolves.toBe('new-generation-write');

    expect(oldWrite).not.toHaveBeenCalled();
    expect(newWrite).toHaveBeenCalledTimes(1);
  });
});
