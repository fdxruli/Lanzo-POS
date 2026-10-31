// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  stored: null, online: true, session: 'session-A', device: 'device-A',
  prepareLocalDatabase: vi.fn(), verifyAdminSession: vi.fn(), verifyStaffSession: vi.fn(),
  revalidateLicense: vi.fn(), getAdminOfflineAuthorization: vi.fn(),
  refresh: vi.fn(), restore: vi.fn(), begin: vi.fn(), lock: vi.fn(), proof: vi.fn(),
  tenant: { opaqueId: 'tenant-A', databaseName: 'LanzoDB_t_A', generation: 1 }
}));
vi.mock('../../../src/services/db/databaseRuntime', () => ({ prepareLocalDatabase: mocks.prepareLocalDatabase }));
vi.mock('../../../src/services/db/tenantRuntimeRouter', () => ({ getTenantRuntimeReadiness: () => ({ ready: true, runtime: mocks.tenant }) }));
vi.mock('../../../src/services/licenseStorage', () => ({
  getLicenseFromStorage: async () => structuredClone(mocks.stored),
  saveLicenseToStorage: async license => { mocks.stored = structuredClone(license); }
}));
vi.mock('../../../src/services/supabase', () => ({
  verifyAdminSession: mocks.verifyAdminSession, verifyStaffSession: mocks.verifyStaffSession,
  getAdminOfflineAuthorization: mocks.getAdminOfflineAuthorization,
  hasStaffSessionToken: async () => false, revalidateLicense: mocks.revalidateLicense
}));
vi.mock('../../../src/services/auth/actorSessionRuntimeBridge', () => ({
  lockActorRuntime: mocks.lock, beginActorRuntimeAuthentication: mocks.begin,
  restoreActorRuntimeFromCurrentSessionCache: mocks.restore,
  assertAuthenticatedActorSessionCurrent: mocks.proof,
  refreshAuthenticatedAdminSessionAuthorization: mocks.refresh
}));
vi.mock('../../../src/services/tenant/localTenantGuard', () => ({
  initializeLocalTenantGuard: vi.fn(), assertLocalTenantAccess: vi.fn(async () => {}),
  lockLocalTenantAccess: vi.fn(), isLocalTenantAccessError: () => false,
  runWithLocalTenantSyncLease: async (_source, _options, task) => task()
}));
import { createLicenseBootstrapActions } from '../../../src/store/slices/license/licenseBootstrapActions';
import { actorRuntimeController as actor } from '../../../src/services/auth/actorRuntimeController';
import { createBootstrapLifecycle, installTraceRecorder } from './trace.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const license = role => ({ license_key: 'synthetic-A', license_id: 'license-A', device_id: 'device-A',
  device_role: role, plan_code: 'free_trial', valid: true, status: 'active',
  ...(role === 'admin' ? { admin_identity_required: true, admin_user: { id: 'owner-A' } } : { staff_user: { id: 'staff-A' } }) });
let activeState = null;
const setup = (role = 'admin') => {
  mocks.stored = license(role);
  const state = { appStatus: 'loading',
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; }),
    _processOfflineMode: vi.fn(async () => { state.appStatus = 'ready'; }),
    _validateInBackground: vi.fn(async () => {}),
    _requireAdminLogin: vi.fn(async () => { actor.lock('denied'); state.appStatus = 'admin_login_required'; }),
    _requireStaffLogin: vi.fn(async () => { actor.lock('denied'); state.appStatus = 'staff_login_required'; })
  };
  Object.assign(state, createLicenseBootstrapActions({ get: () => state, set: patch => Object.assign(state, patch) }));
  activeState = state;
  return state;
};
beforeEach(() => {
  vi.clearAllMocks(); activeState = null;
  mocks.tenant = { opaqueId: 'tenant-A', databaseName: 'LanzoDB_t_A', generation: 1 };
  mocks.session = 'session-A'; mocks.device = 'device-A';
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  actor.lock('test_reset');
  mocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
  mocks.begin.mockImplementation(type => actor.beginAuthentication({ actorType: type }));
  mocks.lock.mockImplementation(reason => actor.lock(reason));
  mocks.restore.mockImplementation(async ({ actorType, actor: user }) => actor.grant({ actorType,
    actorId: user.id, sessionId: mocks.session, deviceRef: mocks.device,
    authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString() }));
  mocks.refresh.mockImplementation(async ({ handle }) => actor.refreshAdminAuthorization({ captured: handle,
    authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString() }));
  mocks.proof.mockImplementation(async ({ handle, actor: user }) => {
    handle.assertCurrent();
    if (handle.actorId !== user?.id || handle.sessionId !== mocks.session || handle.deviceRef !== mocks.device) throw new Error('SESSION_CHANGED');
  });
  mocks.verifyAdminSession.mockImplementation(async () => ({ valid: true, admin_user: mocks.stored.admin_user }));
  mocks.verifyStaffSession.mockImplementation(async () => ({ valid: true, staff_user: mocks.stored.staff_user }));
  mocks.getAdminOfflineAuthorization.mockResolvedValue({ eligible: true });
});
afterEach(() => { vi.useRealTimers(); });

describe('F01-2B current-authority reuse (no cached authorization)', () => {
  it('BG-01 concurrent callers share one flight', async () => {
    const state = setup(); const a = state.initializeApp(), b = state.initializeApp();
    expect(a).toBe(b); await a; expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('BG-02 sequential calls prove and verify current Admin without second restore', async () => {
    vi.useFakeTimers(); const state = setup(); await state.initializeApp(); const generation = actor.getState().generation;
    const deadline = actor.getState().authorizationExpiresAt; vi.advanceTimersByTime(30_000);
    await state.initializeApp(); expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.verifyAdminSession).toHaveBeenCalledTimes(2); expect(actor.getState().generation).toBe(generation);
    expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(actor.getState().authorizationExpiresAt).toBeGreaterThan(deadline);
  });
  it('BG-03 force uses normal restoration', async () => {
    const state = setup(); await state.initializeApp(); await state.initializeApp({ force: true }); expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
  it('BG-04 preparation error permits retry', async () => {
    const state = setup(); mocks.prepareLocalDatabase.mockRejectedValueOnce(new Error('synthetic preparation failure'));
    expect((await state.initializeApp()).status).toBe('failed'); await state.initializeApp(); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('BG-05 logout invalidates existing authority', async () => {
    const state = setup(); await state.initializeApp(); actor.lock('logout'); state.appStatus = 'admin_login_required';
    await state.initializeApp(); expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
  it('BG-06 legitimate reauthentication restores after logout', async () => {
    const state = setup(); await state.initializeApp(); actor.lock('logout'); mocks.session = 'session-B';
    await state.initializeApp(); expect(actor.getState().sessionId).toBe('session-B'); expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
  it('BG-07 actor identity changes are reevaluated', async () => {
    const state = setup(); await state.initializeApp(); mocks.stored.admin_user = { id: 'owner-B' };
    await state.initializeApp(); expect(actor.getState().actorId).toBe('owner-B'); expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
  it('BG-08 license changes are reevaluated', async () => {
    const state = setup(); await state.initializeApp(); mocks.stored.license_key = 'synthetic-B';
    await state.initializeApp(); expect(state.licenseDetails.license_key).toBe('synthetic-B'); expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
  it('BG-09 plan change does not reuse previous result', async () => {
    const state = setup(); await state.initializeApp(); mocks.stored.plan_code = 'pro_monthly';
    await state.initializeApp(); expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
  it('BG-10 store factories never share another stores flight', async () => {
    const a = setup(), b = setup(); const pa = a.initializeApp(), pb = b.initializeApp(); expect(pa).not.toBe(pb); await Promise.all([pa,pb]);
  });
  it('BG-11 Staff still verifies online on sequential calls', async () => {
    const state = setup('staff'); await state.initializeApp(); await state.initializeApp();
    expect(mocks.restore).toHaveBeenCalledTimes(1); expect(mocks.verifyStaffSession).toHaveBeenCalledTimes(2);
  });
  it('BG-12 Staff offline denies reuse', async () => {
    const state = setup('staff'); await state.initializeApp(); Object.defineProperty(navigator, 'onLine', { value: false });
    await state.initializeApp(); expect(state.appStatus).toBe('staff_login_required'); expect(actor.getState().status).toBe('locked');
  });
  it('BG-13 Admin offline still calls current authorization proof', async () => {
    const state = setup(); await state.initializeApp(); Object.defineProperty(navigator, 'onLine', { value: false });
    await state.initializeApp(); expect(mocks.proof).toHaveBeenCalledTimes(2); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('BG-14 expired Admin authority is never a reused success', async () => {
    vi.useFakeTimers(); const state = setup(); await state.initializeApp(); vi.advanceTimersByTime(60_001);
    mocks.getAdminOfflineAuthorization.mockResolvedValue({ eligible: false, reason: 'expired' });
    Object.defineProperty(navigator, 'onLine', { value: false });
    await state.initializeApp(); expect(state.appStatus).toBe('admin_login_required'); expect(actor.getState().status).toBe('locked');
  });
  it('BG-15 a changed session requires normal reevaluation', async () => {
    const state = setup(); await state.initializeApp(); mocks.session = 'session-B'; await state.initializeApp();
    expect(mocks.restore).toHaveBeenCalledTimes(2); expect(actor.getState().sessionId).toBe('session-B');
  });
  it('BG-16 a changed device requires normal reevaluation', async () => {
    const state = setup(); await state.initializeApp(); mocks.device = 'device-B'; await state.initializeApp();
    expect(mocks.restore).toHaveBeenCalledTimes(2); expect(actor.getState().deviceRef).toBe('device-B');
  });
  it('BG-17 stale verification cannot overwrite a new actor generation', async () => {
    const state = setup(); await state.initializeApp(); const pending = deferred(); mocks.verifyAdminSession.mockReturnValueOnce(pending.promise);
    const run = state.initializeApp(); await vi.waitFor(() => expect(mocks.verifyAdminSession).toHaveBeenCalledTimes(2));
    actor.lock('logout_during_verification'); const generation = actor.getState().generation; state.appStatus = 'admin_login_required';
    pending.resolve({ valid: true }); expect((await run).code).toBe('BOOTSTRAP_CONTEXT_STALE');
    expect(actor.getState().generation).toBe(generation); expect(state.appStatus).toBe('admin_login_required');
  });
  it('BG-18 tenant generation change cannot reuse actor', async () => {
    const state = setup(); await state.initializeApp(); mocks.tenant = { ...mocks.tenant, generation: 2 };
    await state.initializeApp(); expect(mocks.restore).toHaveBeenCalledTimes(2); expect(actor.getState().tenant.generation).toBe(2);
  });
  it('BG-19 remote denial follows existing login-required policy', async () => {
    const state = setup(); await state.initializeApp(); mocks.verifyAdminSession.mockResolvedValue({ valid: false, verificationStatus: 'authoritative_denial' });
    await state.initializeApp(); expect(state.appStatus).toBe('admin_login_required'); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('BG-20 StrictMode repeated invocation shares flight and later proves authority', async () => {
    const state = setup(); await Promise.all([state.initializeApp(), state.initializeApp()]); await state.initializeApp();
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
});

describe('registered lifecycle: synthetic exit and local settlement', () => {
  it('BG-21 registers before a factory starts', async () => {
    const lifecycle = createBootstrapLifecycle(); let starts = 0;
    const task = lifecycle.track(() => { starts++; }); expect(starts).toBe(0); expect(lifecycle.getSnapshot().pending).toBe(1); await task;
  });
  it('BG-22 public ready differs from background settled', async () => {
    const lifecycle = createBootstrapLifecycle(), pending = deferred(); const task = lifecycle.track(() => pending.promise);
    await Promise.resolve(); let drained = false; const drain = lifecycle.drain().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false); pending.resolve(); await task; await drain; expect(drained).toBe(true);
  });
  it('BG-23 quiesce denies new registration', () => {
    const lifecycle = createBootstrapLifecycle(); lifecycle.quiesce(); expect(() => lifecycle.track(() => {})).toThrow('QUIESCED');
  });
  it('BG-24 invalidation before start blocks factory', async () => {
    let current = true; const lifecycle = createBootstrapLifecycle({ isContextCurrent: () => current }); const start = vi.fn();
    const task = lifecycle.track(start); current = false; await expect(task).rejects.toThrow('CONTEXT_STALE'); expect(start).not.toHaveBeenCalled();
  });
  it('BG-25 guards reject stale continuations after await', async () => {
    let current = true; const lifecycle = createBootstrapLifecycle({ isContextCurrent: () => current }), pending = deferred(); const write = vi.fn();
    const task = lifecycle.track(async () => { await pending.promise; lifecycle.assertCurrent(); write(); }); await Promise.resolve(); current = false;
    pending.resolve(); await expect(task).rejects.toThrow('CONTEXT_STALE'); expect(write).not.toHaveBeenCalled();
  });
  it('BG-26 late rejection is observed and removed', async () => {
    const lifecycle = createBootstrapLifecycle(), pending = deferred(); const task = lifecycle.track(() => pending.promise);
    const rejected = expect(task).rejects.toThrow('late'); await Promise.resolve(); pending.reject(new Error('late')); await rejected;
    await lifecycle.drain(); expect(lifecycle.getSnapshot()).toMatchObject({ pending: 0, rejected: 1 });
  });
  it('BG-27 factory throws synchronously without leaking registry', async () => {
    const lifecycle = createBootstrapLifecycle(); await expect(lifecycle.track(() => { throw new Error('factory'); })).rejects.toThrow('factory');
    await lifecycle.drain(); expect(lifecycle.getSnapshot().pending).toBe(0);
  });
  it('BG-28 unknown work never resolves drain by time', async () => {
    vi.useFakeTimers(); const lifecycle = createBootstrapLifecycle(); lifecycle.markUnobservable('synthetic unknown'); lifecycle.quiesce();
    let drained = false; void lifecycle.drain().then(() => { drained = true; }); await vi.advanceTimersByTimeAsync(86_400_000);
    expect(drained).toBe(false); expect(lifecycle.getSnapshot().unknown).toEqual(['synthetic unknown']);
  });
  it('BG-29 quiesce waits for already started work', async () => {
    const lifecycle = createBootstrapLifecycle(), pending = deferred(); const task = lifecycle.track(() => pending.promise); await Promise.resolve(); lifecycle.quiesce();
    expect(lifecycle.getSnapshot().pending).toBe(1); pending.resolve(); await task; await lifecycle.drain(); expect(lifecycle.getSnapshot().pending).toBe(0);
  });
  it('BG-30 lifecycle rejects post-quiesce bootstrap without locking authority', async () => {
    const state = setup(), lifecycle = createBootstrapLifecycle(); lifecycle.quiesce(); const generation = actor.getState().generation;
    await expect(state.initializeApp({ lifecycle })).rejects.toThrow('QUIESCED'); expect(state._isInitializing).toBe(false); expect(actor.getState().generation).toBe(generation);
  });
});

it('BG-43 lifecycle observation cannot grant authority without a stored license', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(); mocks.stored = null;
  const result = await state.initializeApp({ lifecycle }); expect(result.status).toBe('unauthenticated');
  expect(actor.getState().status).toBe('locked'); expect(mocks.restore).not.toHaveBeenCalled(); await lifecycle.drain();
});
it('BG-44 equivalent object key order does not duplicate restoration', async () => {
  const state = setup(); await state.initializeApp(); mocks.stored = Object.fromEntries(Object.entries(mocks.stored).reverse());
  await state.initializeApp(); expect(mocks.restore).toHaveBeenCalledTimes(1);
});
it('BG-45 quiesce between registration and start clears flight for legitimate retry', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(); const first = state.initializeApp({ lifecycle }); lifecycle.quiesce();
  await expect(first).rejects.toThrow('QUIESCED'); expect(state._isInitializing).toBe(false);
  await state.initializeApp(); expect(state.appStatus).toBe('ready'); expect(mocks.restore).toHaveBeenCalledTimes(1);
});

installTraceRecorder('bootstrap', { readState: () => ({ ...actor.getState(), appStatus: activeState?.appStatus || null }),
  metrics: () => ({ restorations: mocks.restore.mock.calls.length, adminVerifications: mocks.verifyAdminSession.mock.calls.length,
    staffVerifications: mocks.verifyStaffSession.mock.calls.length, backgroundStarts: activeState?._validateInBackground.mock.calls.length || 0 }) });
