// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const actorListeners = new Set();
  const state = { revalidateLicense: vi.fn(), online: vi.fn(), stored: null, generation: 1, actorListeners };
  state.setGeneration = generation => {
    state.generation = generation;
    const snapshot = { status: 'locked', generation };
    for (const listener of actorListeners) {
      try { listener(snapshot); } catch { /* Match the runtime's observer isolation. */ }
    }
  };
  return state;
});
vi.mock('../../../src/services/supabase', () => ({ revalidateLicense: mocks.revalidateLicense }));
vi.mock('../../../src/services/utils', () => ({ checkInternetConnection: mocks.online, showMessageModal: vi.fn() }));
vi.mock('../../../src/services/licenseStorage', () => ({ getLicenseFromStorage: async () => mocks.stored, saveLicenseToStorage: vi.fn() }));
vi.mock('../../../src/services/auth/actorSessionRuntimeBridge', () => ({ lockActorRuntime: vi.fn() }));
vi.mock('../../../src/services/auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { LOCKED: 'locked', AUTHENTICATING: 'authenticating', HANDOFF_CHECK: 'handoff_check', GRANTED: 'granted' },
  actorRuntimeController: {
  getState: () => ({ status: 'locked', generation: mocks.generation }),
  subscribe: listener => {
    mocks.actorListeners.add(listener);
    return () => mocks.actorListeners.delete(listener);
  }
} }));
import { createLicenseBackgroundValidationActions } from '../../../src/store/slices/license/licenseBackgroundValidationActions';
import { createBootstrapLifecycle, installTraceRecorder } from './trace.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const setup = () => {
  mocks.stored = { license_key: 'synthetic-A', plan_code: 'free_trial', device_role: 'admin' };
  const state = { appStatus: 'ready', licenseDetails: mocks.stored, currentDeviceRole: 'admin', companyProfile: {},
    reportServerStatus: vi.fn(), clearServerStatus: vi.fn(), _loadProfile: vi.fn(async () => {}) };
  Object.assign(state, createLicenseBackgroundValidationActions({ get: () => state, set: patch => Object.assign(state, patch),
    clearLocalLicenseSession: vi.fn(), hasStaffValidationContext: vi.fn() }));
  return state;
};
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.setGeneration(1); localStorage.clear(); sessionStorage.clear(); mocks.online.mockResolvedValue(true); });
afterEach(() => { vi.useRealTimers(); });
it('BG-31 actual background public timeout retains registered validation and transport', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(), pending = deferred();
  mocks.revalidateLicense.mockImplementation((_key, { bootstrapLifecycle }) => bootstrapLifecycle.track(() => pending.promise));
  const task = state._validateInBackground('synthetic-A', { reason: 'force', lifecycle });
  await vi.advanceTimersByTimeAsync(8000); await task;
  expect(lifecycle.getSnapshot().pending).toBe(2); expect(state.reportServerStatus).toHaveBeenCalledTimes(1);
  lifecycle.quiesce(); pending.resolve({ is_fallback: true }); await lifecycle.drain(); expect(lifecycle.getSnapshot().pending).toBe(0);
});
it('BG-32 actual background observes late rejection after public ready', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(), pending = deferred();
  mocks.revalidateLicense.mockImplementation(() => pending.promise);
  const task = state._validateInBackground('synthetic-A', { reason: 'force', lifecycle }); await vi.advanceTimersByTimeAsync(8000); await task;
  pending.reject(new Error('synthetic late reject')); await lifecycle.drain(); expect(lifecycle.getSnapshot().rejected).toBe(1);
});
it('BG-33 stale health probe cannot write into a new generation', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(), pending = deferred(); mocks.online.mockReturnValue(pending.promise);
  mocks.revalidateLicense.mockRejectedValue(new Error('network'));
  const task = state._validateInBackground('synthetic-A', { reason: 'force', lifecycle });
  await vi.advanceTimersByTimeAsync(0); mocks.setGeneration(mocks.generation + 1); pending.resolve(true); await task;
  expect(state.reportServerStatus).not.toHaveBeenCalled(); expect(state.clearServerStatus).not.toHaveBeenCalled();
});
it('BG-34 profile frontier is expressly unknown and cannot claim drain', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(); state.companyProfile = null;
  mocks.revalidateLicense.mockResolvedValue({ valid: true, status: 'active' });
  // TTL path invokes the actual profile frontier without performing remote validation.
  localStorage.setItem('Lanzo_last_license_validation_success', String(Date.now()));
  localStorage.setItem('Lanzo_last_license_validation_success_key', 'synthetic-A');
  await state._validateInBackground('synthetic-A', { reason: 'background', lifecycle });
  expect(state._loadProfile).toHaveBeenCalledTimes(1); expect(lifecycle.getSnapshot().unknown).toContain('background_profile_nested_work');
});
it('BG-35 background admission rejection is observed when callers detach', async () => {
  const state = setup(), lifecycle = createBootstrapLifecycle(); lifecycle.quiesce();
  await expect(state._validateInBackground('synthetic-A', { lifecycle })).rejects.toThrow('QUIESCED'); expect(mocks.revalidateLicense).not.toHaveBeenCalled();
});

installTraceRecorder('background', { readState: () => ({ actorGeneration: mocks.generation }),
  metrics: () => ({ revalidations: mocks.revalidateLicense.mock.calls.length, connectivityChecks: mocks.online.mock.calls.length }) });
