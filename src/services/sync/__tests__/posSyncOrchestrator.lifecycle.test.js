import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTenant: vi.fn(),
  runWithLease: vi.fn(async (_source, _options, operation) => operation()),
  startRealtime: vi.fn(() => ({ id: 'synthetic-channel' })),
  stopRealtime: vi.fn(async () => undefined),
  pullSyncEvents: vi.fn(),
  resetStuckProcessing: vi.fn(async () => 0),
  getPendingOperations: vi.fn(async () => []),
  claimPendingOperation: vi.fn(async row => row),
  markSynced: vi.fn(async () => true),
  markConflict: vi.fn(async () => true),
  markFailed: vi.fn(async () => null),
  pauseForUpdateRequiredFamily: vi.fn(async () => true),
  getCloudSyncProtocolFamilyForEntity: vi.fn(() => 'customer'),
  deferredReadPending: false,
  setRealtimeStatus: vi.fn(async () => true),
  setSyncEnabled: vi.fn(async () => true)
}));

vi.mock('../../posRealtime', () => ({
  buildPosRealtimeTopic: vi.fn(() => 'pos:synthetic-topic'),
  startPosRealtimeListener: mocks.startRealtime,
  stopPosRealtimeListener: mocks.stopRealtime
}));

vi.mock('../posSyncClient', () => ({
  posSyncClient: {
    pullSyncEvents: mocks.pullSyncEvents
  }
}));

vi.mock('../syncMetaService', () => ({
  syncMetaService: {
    getLastChangeSeq: vi.fn(async () => 0),
    advanceLastChangeSeq: vi.fn(async value => value),
    setLastChangeSeq: vi.fn(async () => true),
    getDeferredReadPending: vi.fn(async () => mocks.deferredReadPending),
    setDeferredReadPending: vi.fn(async () => true),
    getDeferredHandlerReads: vi.fn(async () => []),
    setDeferredHandlerReads: vi.fn(async () => true),
    setLastPullAt: vi.fn(async () => true),
    setLastPullError: vi.fn(async () => true),
    setRealtimeStatus: mocks.setRealtimeStatus,
    setSyncEnabled: mocks.setSyncEnabled
  }
}));

vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    capture: () => ({ assertCurrent: vi.fn() }),
    getState: () => ({ status: 'granted', permissions: [] }),
    subscribe: () => vi.fn()
  },
  ACTOR_RUNTIME_STATUS: { GRANTED: 'granted' },
  isActorRuntimeError: () => false
}));

vi.mock('../syncOutboxService', () => ({
  getCloudSyncProtocolFamilyForEntity: mocks.getCloudSyncProtocolFamilyForEntity,
  syncOutboxService: {
    resetStuckProcessing: mocks.resetStuckProcessing,
    getPendingOperations: mocks.getPendingOperations,
    claimPendingOperation: mocks.claimPendingOperation,
    markSynced: mocks.markSynced,
    markConflict: mocks.markConflict,
    markFailed: mocks.markFailed,
    pauseForUpdateRequiredFamily: mocks.pauseForUpdateRequiredFamily,
    observeChanges: () => vi.fn()
  }
}));

vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertTenant,
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_'),
  runWithLocalTenantSyncLease: mocks.runWithLease
}));

vi.mock('../../Logger', () => ({
  default: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import { posSyncOrchestrator } from '../posSyncOrchestrator';
import { POS_SYNC_HTTP_RECONCILE_INTERVAL_MS } from '../syncConstants';

const licenseDetails = {
  license_key: 'TENANT-A',
  realtime_topic: 'license:synthetic-topic',
  features: { cloud_pos_sync: true }
};

const startDeferredBootstrap = () => posSyncOrchestrator.start({
  licenseDetails,
  reason: 'initial_bootstrap'
});

describe('posSyncOrchestrator lifecycle fencing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.assertTenant.mockResolvedValue({ status: 'pass' });
    mocks.deferredReadPending = false;
    mocks.pullSyncEvents.mockResolvedValue({
      success: true,
      events: [],
      latestChangeSeq: 0,
      hasMore: false
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout,
      clearTimeout
    });
    await posSyncOrchestrator.stop({ preserveStatus: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await posSyncOrchestrator.stop({ preserveStatus: true });
    vi.unstubAllGlobals();
  });

  it('does not resurrect sync when stop invalidates a start waiting on tenant access', async () => {
    let releaseTenantAssertion;
    mocks.assertTenant.mockImplementationOnce(() => new Promise((resolve) => {
      releaseTenantAssertion = resolve;
    }));

    const startPromise = posSyncOrchestrator.start({
      licenseDetails,
      reason: 'manual'
    });

    await vi.waitFor(() => expect(releaseTenantAssertion).toEqual(expect.any(Function)));
    await posSyncOrchestrator.stop({ preserveStatus: true });
    releaseTenantAssertion({ status: 'pass' });

    await expect(startPromise).resolves.toMatchObject({
      started: false,
      stale: true
    });

    expect(posSyncOrchestrator.getStatus()).toMatchObject({
      started: false,
      startInProgress: false
    });
    expect(window.addEventListener).not.toHaveBeenCalled();
    expect(mocks.resetStuckProcessing).not.toHaveBeenCalled();
    expect(mocks.pullSyncEvents).not.toHaveBeenCalled();
    expect(mocks.getPendingOperations).not.toHaveBeenCalled();
    expect(mocks.startRealtime).not.toHaveBeenCalled();
    expect(mocks.setRealtimeStatus).not.toHaveBeenCalled();
    expect(mocks.setSyncEnabled).not.toHaveBeenCalled();
  });

  it('does not block update while an Outbox storage read is pending', async () => {
    await startDeferredBootstrap();
    let finishOutboxRead;
    mocks.getPendingOperations.mockImplementationOnce(() => new Promise((resolve) => {
      finishOutboxRead = resolve;
    }));
    const listener = vi.fn();
    const unsubscribe = posSyncOrchestrator.subscribeUpdateActivity(listener);

    const operation = posSyncOrchestrator.processOutbox('restart-safety-test');
    await vi.waitFor(() => expect(posSyncOrchestrator.getStatus().outboxInProgress).toBe(true));
    expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);
    expect(listener).toHaveBeenCalled();

    await vi.waitFor(() => expect(finishOutboxRead).toBeTypeOf('function'));
    finishOutboxRead([]);
    await expect(operation).resolves.toMatchObject({ processed: 0 });
    expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
    unsubscribe();
  });

  it('keeps update blocked while an Outbox send awaits durable confirmation', async () => {
    await startDeferredBootstrap();
    let finishPush;
    const pushOperation = vi.fn(() => new Promise(resolve => { finishPush = resolve; }));
    const unregister = posSyncOrchestrator.registerEntitySyncHandler('customer', { pushOperation });
    mocks.getPendingOperations.mockResolvedValueOnce([{
      id: 'financial-op', entityType: 'customer', operation: 'upsert', idempotencyKey: 'financial-op-key'
    }]);

    const operation = posSyncOrchestrator.processOutbox('update-safety-test');
    await vi.waitFor(() => expect(pushOperation).toHaveBeenCalledOnce());
    expect(posSyncOrchestrator.getUpdateActivity()).toBe(true);
    expect(posSyncOrchestrator.getStatus().outboxOperationInProgress).toBe(true);

    finishPush({ success: true, receipt: 'confirmed' });
    await expect(operation).resolves.toMatchObject({ processed: 1 });
    expect(mocks.markSynced).toHaveBeenCalledWith('financial-op', { success: true, receipt: 'confirmed' }, expect.anything());
    expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);
    unregister();
  });

  it('does not block update on an unresolved periodic reconciliation read', async () => {
    vi.useFakeTimers();
    try {
      await startDeferredBootstrap();
      expect(posSyncOrchestrator.getStatus()).toMatchObject({ reconciliationPullScheduled: true });
      expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);

      let finishPull;
      mocks.pullSyncEvents.mockImplementationOnce(() => new Promise(resolve => { finishPull = resolve; }));
      await vi.advanceTimersByTimeAsync(POS_SYNC_HTTP_RECONCILE_INTERVAL_MS);
      await vi.waitFor(() => expect(mocks.pullSyncEvents).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(finishPull).toEqual(expect.any(Function)));

      // A read can be abandoned; the durable cursor will resume it next start.
      expect(posSyncOrchestrator.getStatus()).toMatchObject({ pullInProgress: true });
      expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);

      finishPull({ success: true, events: [], latestChangeSeq: 0, hasMore: false });
      await posSyncOrchestrator.stop({ preserveStatus: true });
      expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not block update for a durably deferred read and its scheduled retry', async () => {
    vi.useFakeTimers();
    try {
      mocks.deferredReadPending = true;
      await startDeferredBootstrap();
      expect(posSyncOrchestrator.getStatus()).toMatchObject({
        deferredPullPending: true,
        deferredPullScheduled: true
      });
      expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps update blocked while an entity start migration hook is active', async () => {
    let finishMigration;
    const unregister = posSyncOrchestrator.registerEntitySyncHandler('migration-fixture', {
      onStart: () => new Promise(resolve => { finishMigration = resolve; })
    });
    const starting = posSyncOrchestrator.start({ licenseDetails, reason: 'manual' });
    await vi.waitFor(() => expect(finishMigration).toEqual(expect.any(Function)));
    expect(posSyncOrchestrator.getUpdateActivity()).toBe(true);
    finishMigration({ success: true });
    await starting;
    expect(posSyncOrchestrator.getUpdateActivity()).toBe(false);
    unregister();
  });

  it('does not leave pull locked when stop invalidates its tenant assertion', async () => {
    await startDeferredBootstrap();
    vi.clearAllMocks();

    let releaseTenantAssertion;
    mocks.assertTenant.mockImplementationOnce(() => new Promise((resolve) => {
      releaseTenantAssertion = resolve;
    }));

    const pullPromise = posSyncOrchestrator.pullIncremental('deferred-test');
    await vi.waitFor(() => expect(releaseTenantAssertion).toEqual(expect.any(Function)));
    await posSyncOrchestrator.stop({ preserveStatus: true });
    releaseTenantAssertion({ status: 'pass' });

    await expect(pullPromise).resolves.toBeNull();
    expect(posSyncOrchestrator.getStatus()).toMatchObject({
      started: false,
      pullInProgress: false,
      pendingPull: false
    });
    expect(mocks.pullSyncEvents).not.toHaveBeenCalled();
  });

  it('does not leave outbox locked when stop invalidates its tenant assertion', async () => {
    await startDeferredBootstrap();
    vi.clearAllMocks();

    let releaseTenantAssertion;
    mocks.assertTenant.mockImplementationOnce(() => new Promise((resolve) => {
      releaseTenantAssertion = resolve;
    }));

    const outboxPromise = posSyncOrchestrator.processOutbox('deferred-test');
    await vi.waitFor(() => expect(releaseTenantAssertion).toEqual(expect.any(Function)));
    await posSyncOrchestrator.stop({ preserveStatus: true });
    releaseTenantAssertion({ status: 'pass' });

    await expect(outboxPromise).resolves.toMatchObject({
      processed: 0,
      skipped: true,
      reason: 'runtime_changed'
    });
    expect(posSyncOrchestrator.getStatus()).toMatchObject({
      started: false,
      outboxInProgress: false
    });
    expect(mocks.getPendingOperations).not.toHaveBeenCalled();
  });
});
