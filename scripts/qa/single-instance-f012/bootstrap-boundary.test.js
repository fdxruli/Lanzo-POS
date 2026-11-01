// @vitest-environment jsdom
// Executes the real license bootstrap; authentication, tenant, storage and
// profile providers below are synthetic. This is not an authentication QA.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ generation: 0, restores: 0, backgroundActive: 0 }));
vi.mock('../../../src/services/db/databaseRuntime', () => ({ prepareLocalDatabase: async () => ({ ready: true }) }));
vi.mock('../../../src/services/licenseStorage', () => ({
  getLicenseFromStorage: async () => ({ license_key: 'f012-bootstrap', device_role: 'staff', staff_user: { id: 'staff-a' } }),
  saveLicenseToStorage: async () => {},
}));
vi.mock('../../../src/services/supabase', () => ({
  revalidateLicense: vi.fn(), hasStaffSessionToken: async () => true,
  verifyStaffSession: async () => ({ valid: true, staff_user: { id: 'staff-a' } }),
  getAdminOfflineAuthorization: vi.fn(), verifyAdminSession: vi.fn(),
}));
vi.mock('../../../src/services/auth/actorRuntimeController', () => ({ actorRuntimeController: { getState: () => ({ generation: fixture.generation }) } }));
vi.mock('../../../src/services/auth/actorSessionRuntimeBridge', () => ({
  lockActorRuntime: () => { fixture.generation++; },
  beginActorRuntimeAuthentication: () => { fixture.generation++; },
  restoreActorRuntimeFromCurrentSessionCache: async () => { fixture.restores++; return { generation: fixture.generation }; },
}));
vi.mock('../../../src/services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: async () => {}, initializeLocalTenantGuard: () => {},
  isLocalTenantAccessError: () => false, lockLocalTenantAccess: () => {},
  runWithLocalTenantSyncLease: async (_source, _options, operation) => operation(),
}));
import { createLicenseBootstrapActions } from '../../../src/store/slices/license/licenseBootstrapActions';

it('CE-BOOT-01: completed initializeApp can restore again and does not drain its detached background validation', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  let finishBackground;
  const background = new Promise(done => { finishBackground = done; });
  const state = {
    appStatus: 'loading',
    _loadProfile: async () => { state.appStatus = 'ready'; },
    _validateInBackground: async () => { fixture.backgroundActive++; try { await background; } finally { fixture.backgroundActive--; } },
  };
  Object.assign(state, createLicenseBootstrapActions({ set: patch => Object.assign(state, patch), get: () => state }));
  const initial = state.initializeApp();
  expect(state.initializeApp()).toBe(initial);
  await expect(initial).resolves.toEqual({ status: 'ready' });
  expect(fixture.restores).toBe(1); expect(fixture.backgroundActive).toBe(1);
  await state.initializeApp();
  expect(fixture.restores).toBe(2); expect(fixture.backgroundActive).toBe(2);
  const out = 'scripts/qa/single-instance-f012/evidence'; mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/bootstrap-trace.json`, JSON.stringify({ id: 'CE-BOOT-01', result: 'COUNTEREXAMPLE', guarantee: 'sequential restricted bootstrap then unchanged App initialize is one restoration with no background work', restores: fixture.restores, backgroundActiveAfterPublicCompletion: fixture.backgroundActive, authentication: 'synthetic; no policy claim' }, null, 2));
  finishBackground(); await background;
});
