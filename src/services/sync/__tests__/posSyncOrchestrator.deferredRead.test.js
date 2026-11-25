// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  cursor: 0,
  deferredReadPending: false,
  deferredByLicense: new Map(),
  deferredHandlersByLicense: new Map(),
  assertTenant: vi.fn(),
  actor: { status: 'granted', generation: 1, sessionId: 'session-a', actorKey: 'admin:a', permissions: [] },
  actorListeners: new Set(),
  tenantListeners: new Set(),
  realtimeCallbacks: null
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: (...args) => mocks.rpc(...args) },
  getStableDeviceId: async () => 'synthetic-device',
  getDeviceSecurityToken: async () => 'synthetic-security-token',
  getActorSessionToken: async () => 'synthetic-actor-token'
}));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertTenant,
  isLocalTenantAccessError: error => String(error?.code || '').startsWith('LOCAL_TENANT_'),
  runWithLocalTenantSyncLease: async (_source, _options, operation) => operation()
}));
vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { GRANTED: 'granted' },
  actorRuntimeController: {
    getState: () => ({ ...mocks.actor }),
    subscribe: listener => {
      mocks.actorListeners.add(listener);
      return () => mocks.actorListeners.delete(listener);
    },
    capture: () => {
      const capturedSession = mocks.actor.sessionId;
      return {
        actorKey: mocks.actor.actorKey,
        sessionId: capturedSession,
        assertCurrent: () => {
          if (mocks.actor.status !== 'granted' || mocks.actor.sessionId !== capturedSession) {
            throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
          }
          return { ...mocks.actor };
        }
      };
    }
  },
  isActorRuntimeError: error => String(error?.code || '').startsWith('ACTOR_')
}));
vi.mock('../../tenant/localTenantPolicy', () => ({
  LOCAL_TENANT_STATUS: { GRANTED: 'granted' },
  localTenantAccessController: {
    subscribe: listener => {
      mocks.tenantListeners.add(listener);
      return () => mocks.tenantListeners.delete(listener);
    }
  }
}));
vi.mock('../syncMetaService', () => ({
  syncMetaService: {
    getLastChangeSeq: vi.fn(async () => mocks.cursor),
    advanceLastChangeSeq: vi.fn(async value => {
      mocks.cursor = Math.max(mocks.cursor, Number(value));
      return mocks.cursor;
    }),
    getDeferredReadPending: vi.fn(async licenseKey => mocks.deferredByLicense.get(licenseKey) === true),
    setDeferredReadPending: vi.fn(async (value, licenseKey) => {
      mocks.deferredByLicense.set(licenseKey, Boolean(value));
      if (licenseKey === 'TENANT-A') mocks.deferredReadPending = Boolean(value);
      return true;
    }),
    getDeferredHandlerReads: vi.fn(async licenseKey => mocks.deferredHandlersByLicense.get(licenseKey) || []),
    setDeferredHandlerReads: vi.fn(async (entityTypes, licenseKey) => {
      mocks.deferredHandlersByLicense.set(licenseKey, [...entityTypes]);
      return true;
    }),
    setLastPullAt: vi.fn(async () => true),
    setLastPullError: vi.fn(async () => true),
    setRealtimeStatus: vi.fn(async () => true),
    setSyncEnabled: vi.fn(async () => true)
  }
}));
vi.mock('../syncOutboxService', () => ({
  syncOutboxService: {
    resetStuckProcessing: vi.fn(async () => 0),
    getPendingOperations: vi.fn(async () => []),
    observeChanges: () => vi.fn()
  }
}));
vi.mock('../../posRealtime', () => ({
  buildPosRealtimeTopic: vi.fn(() => 'pos:deferred-read-test'),
  startPosRealtimeListener: vi.fn(({ callbacks }) => {
    mocks.realtimeCallbacks = callbacks;
    return { id: 'deferred-read-test-channel' };
  }),
  stopPosRealtimeListener: vi.fn(async () => undefined)
}));
vi.mock('../../Logger', () => ({ default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const details = {
  license_key: 'TENANT-A',
  realtime_topic: 'license:deferred-read-test',
  features: { cloud_pos_sync: true }
};
const flush = async () => { for (let index = 0; index < 60; index += 1) await Promise.resolve(); };
let orchestrator;
let online;

const payload = (fields = {}) => ({
  success: true,
  events: [],
  latest_change_seq: mocks.cursor,
  server_latest_change_seq: mocks.cursor,
  has_more: false,
  ...fields
});

const replyWith = (fields) => mocks.rpc.mockResolvedValueOnce({ data: payload(fields), error: null });

const start = async (licenseDetails = details) => {
  await orchestrator.start({ licenseDetails, reason: 'initial_bootstrap' });
  await flush();
};

const changeActor = (next) => {
  mocks.actor = { ...mocks.actor, ...next };
  for (const listener of [...mocks.actorListeners]) listener({ ...mocks.actor });
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  mocks.cursor = 0;
  mocks.deferredReadPending = false;
  mocks.deferredByLicense.clear();
  mocks.deferredHandlersByLicense.clear();
  mocks.actor = { status: 'granted', generation: 1, sessionId: 'session-a', actorKey: 'admin:a', permissions: [] };
  mocks.actorListeners.clear();
  mocks.tenantListeners.clear();
  mocks.realtimeCallbacks = null;
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  mocks.assertTenant.mockResolvedValue({ status: 'pass' });
  const { posSyncOrchestrator: importedOrchestrator } = await import('../posSyncOrchestrator');
  orchestrator = importedOrchestrator;
});

afterEach(async () => {
  await orchestrator.stop({ preserveStatus: true });
  await flush();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('POS incremental recovery from a deferred safe frontier', () => {
  it('honors retry_after_seconds after a snapshot start is rate limited', async () => {
    replyWith({ latest_change_seq: 0, server_latest_change_seq: 0 });
    const onStart = vi.fn().mockResolvedValue({
      success: false,
      error: Object.assign(new Error('rate limited'), {
        code: 'RPC_RATE_LIMITED', retryable: true, retryAfterSeconds: 60
      })
    });
    const onEvents = vi.fn().mockResolvedValue({ applied: 1 });
    orchestrator.registerEntitySyncHandler('customer', { onStart, onEvents });

    await start();

    expect(onStart).toHaveBeenCalledOnce();
    expect(onEvents).not.toHaveBeenCalled();
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(true);

    await vi.advanceTimersByTimeAsync(59_999);
    await flush();
    expect(onEvents).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(onEvents).toHaveBeenCalledOnce();
    expect(onEvents).toHaveBeenCalledWith([], {
      licenseKey: 'TENANT-A', force: true, reason: 'deferred_handler_retry'
    });
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(false);
  });

  it('keeps cursor 175 and retrieves sequence 177 automatically without another Broadcast', async () => {
    mocks.cursor = 175;
    replyWith({ latest_change_seq: 175, server_latest_change_seq: 177, has_more: true, sync_deferred: true });
    replyWith({
      events: [{ entity_type: 'customer', change_seq: 177, id: 'customer-177' }],
      latest_change_seq: 177,
      server_latest_change_seq: 177
    });
    const applyCustomerEvents = vi.fn();

    await start();
    orchestrator.registerEntitySyncHandler('customer', { onEvents: applyCustomerEvents });
    await orchestrator.pullIncremental('initial_read');

    expect(mocks.cursor).toBe(175);
    expect(mocks.deferredReadPending).toBe(true);
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: true, deferredPullScheduled: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_since_change_seq)).toEqual([175, 175]);
    expect(applyCustomerEvents).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: false, deferredPullScheduled: false });
  });

  it('applies a safe partial page, confirms only its cursor, then recovers the remaining entity', async () => {
    mocks.cursor = 175;
    replyWith({
      events: [{ entity_type: 'product', change_seq: 176, id: 'product-176' }],
      latest_change_seq: 176,
      server_latest_change_seq: 177,
      sync_deferred: true
    });
    replyWith({
      events: [{ entity_type: 'customer', change_seq: 177, id: 'customer-177' }],
      latest_change_seq: 177,
      server_latest_change_seq: 177
    });
    const applyProducts = vi.fn();
    const applyCustomers = vi.fn();

    await start();
    orchestrator.registerEntitySyncHandler('product', { onEvents: applyProducts });
    orchestrator.registerEntitySyncHandler('customer', { onEvents: applyCustomers });
    await orchestrator.pullIncremental('partial_page');

    expect(applyProducts).toHaveBeenCalledWith(
      [{ entity_type: 'product', change_seq: 176, id: 'product-176' }],
      { licenseKey: 'TENANT-A', force: false, reason: 'pos_sync_events' }
    );
    expect(applyCustomers).not.toHaveBeenCalled();
    expect(mocks.cursor).toBe(176);
    expect(mocks.deferredReadPending).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_since_change_seq)).toEqual([175, 176]);
    expect(applyCustomers).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
  });

  it('finishes immediately available pages before clearing the deferred marker', async () => {
    mocks.cursor = 175;
    replyWith({
      events: [{ entity_type: 'product', change_seq: 176 }],
      latest_change_seq: 176,
      server_latest_change_seq: 177,
      has_more: true,
      sync_deferred: true
    });
    replyWith({
      events: [{ entity_type: 'customer', change_seq: 177 }],
      latest_change_seq: 177,
      server_latest_change_seq: 177,
      has_more: false
    });
    const applyProducts = vi.fn();
    const applyCustomers = vi.fn();

    await start();
    orchestrator.registerEntitySyncHandler('product', { onEvents: applyProducts });
    orchestrator.registerEntitySyncHandler('customer', { onEvents: applyCustomers });
    await orchestrator.pullIncremental('safe_pages');

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_since_change_seq)).toEqual([175, 176]);
    expect(applyProducts).toHaveBeenCalledTimes(1);
    expect(applyCustomers).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(false);
  });

  it('does not confirm the general cursor when a handler defers its page', async () => {
    mocks.cursor = 175;
    replyWith({
      events: [{ entity_type: 'customer', change_seq: 177, id: 'customer-177' }],
      latest_change_seq: 177,
      server_latest_change_seq: 177,
      sync_deferred: true
    });
    replyWith({
      events: [{ entity_type: 'customer', change_seq: 177, id: 'customer-177' }],
      latest_change_seq: 177,
      server_latest_change_seq: 177
    });
    const onEvents = vi.fn()
      .mockResolvedValueOnce({ skipped: true, retryable: true, reason: 'local_apply_pending' })
      .mockResolvedValueOnce({ applied: 1 });

    await start();
    orchestrator.registerEntitySyncHandler('customer', { onEvents });
    await orchestrator.pullIncremental('handler_deferred');

    expect(mocks.cursor).toBe(175);
    expect(mocks.deferredReadPending).toBe(true);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(onEvents).toHaveBeenCalledTimes(2);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
  });

  it('continues retrying a prolonged boundary with capped backoff and no attempt cutoff', async () => {
    mocks.cursor = 175;
    mocks.rpc.mockImplementation(async () => ({
      data: payload({ latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true }),
      error: null
    }));
    await start();
    await orchestrator.pullIncremental('long_transaction');

    const delays = [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000];
    for (const [index, delay] of delays.entries()) {
      const priorCalls = index + 1;
      await vi.advanceTimersByTimeAsync(delay - 1);
      await flush();
      expect(mocks.rpc).toHaveBeenCalledTimes(priorCalls);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(mocks.rpc).toHaveBeenCalledTimes(priorCalls + 1);
      expect(orchestrator.getStatus().deferredPullPending).toBe(true);
    }
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(true);
  });

  it('backs off after an explicit recoverable response while deferred work remains', async () => {
    mocks.cursor = 175;
    replyWith({ latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true });
    mocks.rpc.mockResolvedValueOnce({
      data: { success: false, code: 'POS_READ_TEMPORARILY_UNAVAILABLE', retryable: true },
      error: null
    });
    replyWith({ events: [{ entity_type: 'customer', change_seq: 177 }], latest_change_seq: 177 });

    await start();
    await orchestrator.pullIncremental('initial_read');
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.cursor).toBe(175);
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: true, deferredPullScheduled: true });
    await vi.advanceTimersByTimeAsync(3999);
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
  });

  it('stops timed recovery on a definitive permission response without clearing pending work', async () => {
    mocks.cursor = 175;
    replyWith({ latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true });
    mocks.rpc.mockResolvedValueOnce({
      data: { success: false, code: 'ACTOR_PERMISSION_DENIED', retryable: true },
      error: null
    });

    await start();
    await orchestrator.pullIncremental('initial_read');
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.deferredReadPending).toBe(true);
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: true, deferredPullScheduled: false });
  });

  it('rehydrates pending work for the same license after a synchronizer restart', async () => {
    mocks.cursor = 175;
    mocks.deferredByLicense.set('TENANT-A', true);
    mocks.deferredReadPending = true;
    replyWith({ events: [{ entity_type: 'customer', change_seq: 177 }], latest_change_seq: 177 });

    await start();
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: true, deferredPullScheduled: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredByLicense.get('TENANT-A')).toBe(false);
  });

  it('coalesces Broadcast, online and foreground signals while a pull is in flight', async () => {
    mocks.cursor = 175;
    let resolveInFlight;
    mocks.rpc
      .mockImplementationOnce(async () => ({ data: payload({ latest_change_seq: 175, sync_deferred: true }), error: null }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveInFlight = resolve; }))
      .mockResolvedValueOnce({ data: payload({ latest_change_seq: 175 }), error: null });

    await start();
    await orchestrator.pullIncremental('initial_read');
    const activePull = orchestrator.schedulePullIncremental('online');
    await flush();
    expect(resolveInFlight).toEqual(expect.any(Function));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);

    await orchestrator.schedulePullIncremental('realtime');
    await orchestrator.handleForegroundResume('visibilitychange');
    online = true;
    window.dispatchEvent(new Event('online'));
    mocks.realtimeCallbacks.onPosChangeAvailable({ changeSeq: 177, entity: 'customer' });
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(false);
    expect(orchestrator.getStatus().realtimePullScheduled).toBe(false);

    resolveInFlight({ data: payload({ latest_change_seq: 175 }), error: null });
    await activePull;
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_since_change_seq)).toEqual([175, 175, 175]);
    expect(orchestrator.getStatus().pullInProgress).toBe(false);
    expect(orchestrator.getStatus().deferredPullPending).toBe(false);
  });

  it('pauses while offline and resumes on the existing online event', async () => {
    mocks.cursor = 175;
    replyWith({ latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true });
    replyWith({ events: [{ entity_type: 'customer', change_seq: 177 }], latest_change_seq: 177 });
    const onEvents = vi.fn();
    await start();
    orchestrator.registerEntitySyncHandler('customer', { onEvents });
    await orchestrator.pullIncremental('initial_read');

    online = false;
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(orchestrator.getStatus().deferredPullPending).toBe(true);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(false);

    online = true;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
  });

  it('fences a delayed response after actor/session replacement and resumes under the new grant', async () => {
    mocks.cursor = 175;
    let resolveOldSession;
    mocks.rpc
      .mockImplementationOnce(async () => ({ data: payload({ latest_change_seq: 175, sync_deferred: true }), error: null }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldSession = resolve; }))
      .mockResolvedValueOnce({
        data: payload({ events: [{ entity_type: 'customer', change_seq: 177 }], latest_change_seq: 177 }),
        error: null
      });
    const onEvents = vi.fn();
    await start();
    orchestrator.registerEntitySyncHandler('customer', { onEvents });
    await orchestrator.pullIncremental('initial_read');

    vi.advanceTimersByTime(2000);
    await flush();
    expect(resolveOldSession).toEqual(expect.any(Function));
    changeActor({ status: 'locked', generation: 2, sessionId: null, actorKey: null });
    resolveOldSession({ data: payload({ events: [{ entity_type: 'customer', change_seq: 177 }], latest_change_seq: 177 }), error: null });
    await flush();
    await flush();

    expect(onEvents).not.toHaveBeenCalled();
    expect(mocks.cursor).toBe(175);
    expect(mocks.deferredReadPending).toBe(true);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(false);

    changeActor({ status: 'granted', generation: 3, sessionId: 'session-b', actorKey: 'admin:b' });
    await flush();
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(mocks.cursor).toBe(177);
    expect(mocks.deferredReadPending).toBe(false);
  });

  it('cancels the old license timer and does not transfer its pending marker to a new license', async () => {
    mocks.cursor = 175;
    replyWith({ latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true });
    await start();
    await orchestrator.pullIncremental('initial_read');
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(true);

    const nextContext = await orchestrator.start({
      licenseDetails: {
        ...details,
        license_key: 'TENANT-B',
        realtime_topic: 'license:tenant-b'
      },
      reason: 'initial_bootstrap'
    });
    expect(nextContext).toMatchObject({ started: true });
    await flush();
    expect(orchestrator.getStatus()).toMatchObject({ licenseKey: 'TENANT-B', deferredPullPending: false, deferredPullScheduled: false });
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.deferredByLicense.get('TENANT-A')).toBe(true);
    expect(mocks.deferredByLicense.get('TENANT-B')).not.toBe(true);
  });

  it('does not activate recovery for current Production responses without the optional signal', async () => {
    mocks.cursor = 175;
    replyWith({ events: [], latest_change_seq: 175, server_latest_change_seq: 177, has_more: false });
    await start();

    const result = await orchestrator.pullIncremental('legacy_response');
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();

    expect(result).toMatchObject({ success: true, syncDeferred: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.deferredReadPending).toBe(false);
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: false, deferredPullScheduled: false });
  });

  it('keeps FREE/Local outside this Cloud recovery path', async () => {
    await start({ ...details, features: { cloud_pos_sync: false } });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(orchestrator.getStatus()).toMatchObject({ started: false, status: 'disabled' });
  });
});
