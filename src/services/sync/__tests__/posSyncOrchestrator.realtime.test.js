// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncExecutionScope } from '../syncExecutionScope';

const mocks = vi.hoisted(() => ({
  client: { channel: vi.fn(), removeChannel: vi.fn() },
  pull: vi.fn(),
  cursor: 0,
  status: vi.fn(),
  assertTenant: vi.fn()
}));
vi.mock('../../supabase', () => ({ supabaseClient: mocks.client }));
vi.mock('../../Logger', () => ({ default: { log: vi.fn(), warn: vi.fn() } }));
vi.mock('../posSyncClient', () => ({ posSyncClient: { pullSyncEvents: mocks.pull } }));
vi.mock('../syncMetaService', () => ({ syncMetaService: {
  getLastChangeSeq: async () => mocks.cursor,
  setLastChangeSeq: async value => { mocks.cursor = value; },
  setLastPullAt: vi.fn(), setLastPullError: vi.fn(),
  setRealtimeStatus: mocks.status, setSyncEnabled: vi.fn()
} }));
vi.mock('../syncOutboxService', () => ({ syncOutboxService: {
  resetStuckProcessing: vi.fn(), getPendingOperations: async () => []
} }));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertTenant,
  runWithLocalTenantSyncLease: async (_source, _options, operation) => operation(),
  isLocalTenantAccessError: () => false
}));

const details = { license_key: 'SYNTHETIC', realtime_topic: 'license:synthetic', features: { cloud_pos_sync: true } };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
let orchestrator, channels, online, scope, syncMetaService;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  online = true; channels = []; scope = null; mocks.cursor = 0;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  mocks.assertTenant.mockResolvedValue(true);
  mocks.client.removeChannel.mockResolvedValue('ok');
  mocks.client.channel.mockImplementation(() => {
    const channel = {
      on: vi.fn((_type, _filter, callback) => { channel.broadcast = callback; return channel; }),
      subscribe: vi.fn(callback => { channel.status = callback; return channel; })
    };
    channels.push(channel); return channel;
  });
  mocks.pull.mockImplementation(async ({ sinceChangeSeq }) => ({
    success: true, events: [], latestChangeSeq: sinceChangeSeq, hasMore: false
  }));
  ({ posSyncOrchestrator: orchestrator } = await import('../posSyncOrchestrator'));
  ({ syncMetaService } = await import('../syncMetaService'));
});
afterEach(async () => {
  await orchestrator.stop({ preserveStatus: true });
  if (scope) await scope.settleObserved();
  vi.useRealTimers();
});

describe.each(['legacy', 'scoped'])('existing %s POS Realtime recovery', mode => {
  const start = async (licenseDetails = details) => {
    if (mode === 'scoped') scope = createSyncExecutionScope();
    const result = await orchestrator.start({ licenseDetails, reason: 'initial_bootstrap', executionScope: scope });
    await flush(); return result;
  };

  it('creates the private channel after an offline start and consumes later customer notices', async () => {
    online = false;
    await start();
    expect(orchestrator.getStatus().status).toBe('offline');
    expect(channels).toHaveLength(0);
    online = true;
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(channels).toHaveLength(1);
    expect(mocks.client.channel).toHaveBeenCalledWith('pos:synthetic', { config: { private: true } });
    expect(orchestrator.getStatus().status).toBe('degraded');
    channels[0].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    const onEvents = vi.fn();
    orchestrator.registerEntitySyncHandler('customer', { onEvents });
    mocks.pull.mockResolvedValueOnce({ success: true, events: [{ entity_type: 'customer', change_seq: 1 }], latestChangeSeq: 1, hasMore: false });
    channels[0].broadcast({ payload: { entity_type: 'customer', change_seq: 1 } });
    await flush(); await vi.advanceTimersByTimeAsync(1000);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(1);
  });

  it('keeps successful pulls degraded until subscribed, including after channel failure', async () => {
    await start();
    expect(orchestrator.getStatus().status).toBe('degraded');
    await orchestrator.pullIncremental('manual');
    expect(orchestrator.getStatus().status).toBe('degraded');
    channels[0].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(orchestrator.getStatus().status).toBe('online');
    channels[0].status('CHANNEL_ERROR'); await flush();
    expect(orchestrator.getStatus().status).toBe('degraded');
    await orchestrator.pullIncremental('manual');
    expect(orchestrator.getStatus().status).toBe('degraded');
    await vi.advanceTimersByTimeAsync(3000);
    expect(channels).toHaveLength(2);
    const calls = mocks.pull.mock.calls.length;
    channels[1].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.pull).toHaveBeenCalledTimes(calls + 1);
    expect(orchestrator.getStatus().status).toBe('online');
  });

  it('keeps a failed page pending, lets other entity cursors progress, and recovers on the next notice', async () => {
    await start();
    const failure = new Error('CUSTOMER_APPLY_FAILED');
    const customer = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ applied: 1 });
    let productCursor = 0;
    let productApplications = 0;
    const product = vi.fn(async () => {
      if (productCursor < 2) { productApplications += 1; productCursor = 2; }
    });
    orchestrator.registerEntitySyncHandler('customer', { onEvents: customer });
    orchestrator.registerEntitySyncHandler('product', { onEvents: product });
    const events = [{ entity_type: 'customer', change_seq: 1 }, { entity_type: 'product', change_seq: 2 }];
    mocks.pull.mockImplementation(async ({ sinceChangeSeq }) => ({
      success: true, events: sinceChangeSeq < 2 ? events : [], latestChangeSeq: 2, hasMore: false
    }));
    syncMetaService.setLastPullAt.mockClear();
    await orchestrator.pullIncremental('first_notice');
    expect(mocks.cursor).toBe(0);
    expect(syncMetaService.setLastPullAt).not.toHaveBeenCalled();
    expect(syncMetaService.setLastPullError).toHaveBeenLastCalledWith(failure, details.license_key);
    expect(orchestrator.getStatus()).toMatchObject({ pullInProgress: false, status: 'degraded' });
    expect(productCursor).toBe(2);

    channels[0].broadcast({ payload: { entity_type: 'customer', change_seq: 1 } });
    await flush(); await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.pull).toHaveBeenLastCalledWith(expect.objectContaining({ sinceChangeSeq: 0 }));
    expect(customer).toHaveBeenCalledTimes(2);
    expect(customer).toHaveBeenLastCalledWith([events[0]], { licenseKey: details.license_key });
    expect(productApplications).toBe(1);
    expect(mocks.cursor).toBe(2);
    expect(syncMetaService.setLastPullError).toHaveBeenLastCalledWith(null, details.license_key);
    expect(orchestrator.getStatus().pullInProgress).toBe(false);
  });

  it('coalesces duplicate notices and fences callbacks after stop', async () => {
    await start(); channels[0].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(1000); mocks.pull.mockClear();
    channels[0].broadcast({ payload: { change_seq: 1 } });
    channels[0].broadcast({ payload: { change_seq: 1 } });
    await flush(); await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.pull).toHaveBeenCalledTimes(1);
    await orchestrator.stop({ preserveStatus: true });
    mocks.pull.mockClear();
    channels[0].broadcast({ payload: { change_seq: 2 } });
    channels[0].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(channels).toHaveLength(1);
  });

  it('retains earlier committed POS pages when a later handler fails', async () => {
    await start();
    const onEvents = vi.fn().mockResolvedValueOnce({ applied: 1 }).mockRejectedValueOnce(new Error('SECOND_PAGE_FAILED'))
      .mockResolvedValue({ applied: 1 });
    orchestrator.registerEntitySyncHandler('customer', { onEvents });
    mocks.pull.mockImplementation(async ({ sinceChangeSeq }) => ({
      success: true,
      events: [{ entity_type: 'customer', change_seq: sinceChangeSeq + 1 }],
      latestChangeSeq: sinceChangeSeq + 1,
      hasMore: sinceChangeSeq === 0
    }));
    await orchestrator.pullIncremental('two_pages');
    expect(mocks.cursor).toBe(1);
    expect(onEvents).toHaveBeenCalledTimes(2);
    await orchestrator.pullIncremental('retry_second_page');
    expect(mocks.pull).toHaveBeenLastCalledWith(expect.objectContaining({ sinceChangeSeq: 1 }));
    expect(onEvents).toHaveBeenCalledTimes(3);
    expect(mocks.cursor).toBe(2);
  });

  it('runs an already-pending pull after a handler failure without locking or acknowledging the failed attempt', async () => {
    await start();
    let rejectFirstApply;
    const onEvents = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirstApply = reject; }))
      .mockImplementationOnce(async () => {
        expect(mocks.cursor).toBe(0);
        return { applied: 1 };
      });
    orchestrator.registerEntitySyncHandler('customer', { onEvents });
    mocks.pull.mockResolvedValue({ success: true, events: [{ entity_type: 'customer', change_seq: 1 }], latestChangeSeq: 1, hasMore: false });
    const firstPull = orchestrator.pullIncremental('first_notice');
    await flush();
    expect(rejectFirstApply).toEqual(expect.any(Function));
    await expect(orchestrator.pullIncremental('notice_during_apply')).resolves.toMatchObject({ reason: 'pull_in_progress_pending' });
    rejectFirstApply(new Error('LOCAL_APPLY_FAILED'));
    await firstPull;
    expect(onEvents).toHaveBeenCalledTimes(2);
    expect(mocks.cursor).toBe(1);
    expect(orchestrator.getStatus()).toMatchObject({ pullInProgress: false, pendingPull: false });
  });

  it('does not suppress foreground recovery using a disconnected channel handle', async () => {
    await start(); channels[0].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await orchestrator.handleForegroundResume();
    await expect(orchestrator.handleForegroundResume()).resolves.toMatchObject({ reason: 'focus_cooldown' });
    channels[0].status('CHANNEL_ERROR'); await flush();
    mocks.pull.mockClear();
    await orchestrator.handleForegroundResume();
    expect(mocks.pull).toHaveBeenCalledTimes(1);
  });

  it('does not install a channel after stopping an offline startup', async () => {
    online = false; await start();
    const onOnline = orchestrator.getStatus().onlineListener;
    await orchestrator.stop({ preserveStatus: true });
    online = true;
    await onOnline(); window.dispatchEvent(new Event('online')); await flush();
    expect(channels).toHaveLength(0);
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  if (mode === 'scoped') it('reports channel failure while transport cleanup is still pending', async () => {
    await start(); channels[0].status('SUBSCRIBED'); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    let finishRemoval;
    mocks.client.removeChannel.mockReturnValueOnce(new Promise(resolve => { finishRemoval = resolve; }));
    channels[0].status('CHANNEL_ERROR'); await flush();
    try {
      expect(orchestrator.getStatus().status).toBe('degraded');
      await orchestrator.pullIncremental('manual');
      expect(orchestrator.getStatus().status).toBe('degraded');
      expect(channels).toHaveLength(1);
    } finally {
      finishRemoval('ok'); await flush();
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(channels).toHaveLength(2);
  });

  it('does not create a channel for FREE/Local', async () => {
    await start({ ...details, features: { cloud_pos_sync: false } });
    window.dispatchEvent(new Event('online')); await flush();
    expect(channels).toHaveLength(0);
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(orchestrator.getStatus().status).toBe('disabled');
  });
});
