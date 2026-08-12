import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTenant: vi.fn(),
  runWithLease: vi.fn(async (_source, _options, operation) => operation()),
  startRealtime: vi.fn(() => ({ id: 'synthetic-channel' })),
  stopRealtime: vi.fn(async () => undefined),
  pullSyncEvents: vi.fn(),
  resetStuckProcessing: vi.fn(async () => 0),
  getPendingOperations: vi.fn(async () => []),
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
    setLastChangeSeq: vi.fn(async () => true),
    setLastPullAt: vi.fn(async () => true),
    setLastPullError: vi.fn(async () => true),
    setRealtimeStatus: mocks.setRealtimeStatus,
    setSyncEnabled: mocks.setSyncEnabled
  }
}));

vi.mock('../syncOutboxService', () => ({
  syncOutboxService: {
    resetStuckProcessing: mocks.resetStuckProcessing,
    getPendingOperations: mocks.getPendingOperations
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
