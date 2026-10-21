/* @vitest-environment jsdom */
// Research counterexample: real modules, synthetic callback, NO commercial write.
import { afterEach, expect, it } from 'vitest';
import { createActorRuntimeController, runWithActorHandle } from '../../../src/services/auth/actorRuntimeController';
import { activateActorScopedStorage, captureActorScopedStorageHandle, invalidateActorScopedStorage,
  prepareActorScopedStorage, resumeActorScopedStorageWrites } from '../../../src/services/auth/actorScopedStorage';

afterEach(() => { invalidateActorScopedStorage('research_cleanup'); window.localStorage.clear(); });
it('counterexample: retiring a storage handle alone does not certify the real runtime guarded callback boundary', async () => {
  window.localStorage.clear();
  const tenant = { opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 };
  const controller = createActorRuntimeController({ getTenantAuthority: () => tenant });
  controller.beginAuthentication({ actorType: 'admin' });
  const granted = controller.grant({ actorType: 'admin', actorId: 'synthetic-A', sessionId: 'synthetic-session',
    deviceRef: 'synthetic-device', authorizationExpiresAt: new Date(Date.now() + 60000).toISOString() });
  await prepareActorScopedStorage({ tenant, actorKey: granted.actorKey, actorGeneration: granted.generation });
  activateActorScopedStorage(granted); resumeActorScopedStorageWrites();
  const storageHandle = captureActorScopedStorageHandle(); const runtimeHandle = controller.capture();
  const key = `lanzo:t:${tenant.opaqueId}:actor-runtime-context:v1`;
  const record = JSON.parse(window.localStorage.getItem(key));
  window.localStorage.setItem(key, JSON.stringify({ ...record, contextToken: 'foreign-synthetic-context' }));
  // Deliberately before the foreign notification. Durable mismatch already exists.
  expect(() => storageHandle.assertCurrent()).toThrow();
  expect(() => runtimeHandle.assertCurrent()).not.toThrow();
  let syntheticEffects = 0;
  await runWithActorHandle(runtimeHandle, async ({ guardedWrite }) => guardedWrite(() => { syntheticEffects += 1; }));
  expect(syntheticEffects).toBe(1);
  // This disproves a storage-only proof, NOT proof of two sales or a server bypass.
});
