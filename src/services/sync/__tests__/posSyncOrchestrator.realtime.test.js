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
let orchestrator, channels, online, scope;
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
