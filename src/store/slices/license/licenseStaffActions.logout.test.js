import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: null,
  events: [],
  checkouts: [],
  blockCode: null,
  assertHandoff: vi.fn(),
  lockActorRuntime: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  staffLogoutSession: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  captureLicenseValidationContext: vi.fn(),
  assertLicenseValidationContextCurrent: vi.fn(),
  persistWithinLicenseValidationContext: vi.fn(),
  refreshAuthenticatedStaffSession: vi.fn(),
  delayedStaffRefresh: null
}));

vi.mock('../../../services/products/posCatalogSessionEvents', () => ({
  notifyPosCatalogSessionReset: vi.fn()
}));

vi.mock('../../../services/supabase', () => ({
  clearStaffSessionCache: mocks.clearStaffSessionCache,
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  hasStaffSessionToken: vi.fn(async () => false),
  staffLoginOnDevice: vi.fn(),
  staffLogoutSession: mocks.staffLogoutSession
}));

vi.mock('../../../services/auth/actorSessionRuntimeBridge', () => ({
  beginActorRuntimeAuthentication: vi.fn(),
  grantAuthenticatedActorRuntime: vi.fn(),
  lockActorRuntime: mocks.lockActorRuntime,
  refreshAuthenticatedStaffSession: mocks.refreshAuthenticatedStaffSession
}));

vi.mock('../../../services/deviceModePolicy', () => ({
  resolveStaffAuthRoutingDecision: vi.fn(() => true)
}));

vi.mock('../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage
}));

vi.mock('./licenseGuards', () => ({
  getStaffLoginMessage: (validation) => validation.message || 'Inicia sesión staff para continuar.'
}));

vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
  initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: vi.fn(() => false),
  lockLocalTenantAccess: vi.fn(() => mocks.events.push('tenant_lock'))
}));

vi.mock('./localTenantIsolationState', () => ({ enterLocalTenantIsolationFailure: vi.fn() }));
vi.mock('../../../services/db/databaseRecoveryState', () => ({ isBrowserStorageUnavailableError: vi.fn(() => false) }));
vi.mock('../../../services/auth/actorRuntimeController', () => ({
  actorRuntimeController: { getState: () => mocks.actor }
}));
vi.mock('../../../services/auth/actorOperationalHandoff', () => ({
  ACTOR_HANDOFF_CHECKOUT_OWNED: 'ACTOR_HANDOFF_CHECKOUT_OWNED',
  ACTOR_HANDOFF_PENDING_OPERATIONS: 'ACTOR_HANDOFF_PENDING_OPERATIONS',
  assertActorSessionCanClose: mocks.assertHandoff,
  assertActorOperationalHandoffClear: mocks.assertHandoff,
  getActorCheckoutOwnerships: () => mocks.checkouts
}));
vi.mock('../../../services/auth/sessionVerification', () => ({ isAuthoritativeSessionDenial: vi.fn(() => false) }));
vi.mock('./licenseValidationContext', () => ({
  captureLicenseValidationContext: mocks.captureLicenseValidationContext,
  assertLicenseValidationContextCurrent: mocks.assertLicenseValidationContextCurrent,
  persistWithinLicenseValidationContext: mocks.persistWithinLicenseValidationContext
}));
vi.mock('../../../services/Logger', () => ({ default: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } }));

import { createLicenseStaffActions } from './licenseStaffActions';

const createStore = ({ appStatus = 'ready' } = {}) => {
  const state = {
    appStatus,
    licenseDetails: {
      license_key: 'LIC-STAFF-QA',
      device_mode: 'staff_only',
      device_role: 'staff',
      staff_user: { id: 'staff-qa', username: 'qa-staff' },
      business_profile: { name: 'Farmacia QA' },
      feature_data: { retain: true }
    },
    staffLoginLicenseKey: 'LIC-STAFF-QA',
    currentDeviceRole: 'staff',
    currentStaffUser: { id: 'staff-qa', username: 'qa-staff' },
    licenseSyncActive: true,
    licenseSyncMode: 'hybrid_realtime',
    licenseSyncLicenseKey: 'LIC-STAFF-QA',
    stopLicenseSync: vi.fn(async () => mocks.events.push('stop_sync')),
    _invalidateProfileLoads: vi.fn(),
    resetEcommerceOrdersState: vi.fn(),
    lockDriveSession: vi.fn(),
    _loadProfile: vi.fn(),
    _validateInBackground: vi.fn()
  };
  const set = vi.fn((partial) => Object.assign(state, partial));
  const get = () => state;
  Object.assign(state, createLicenseStaffActions({ set, get }));
  return state;
};

describe('Staff logout lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: true });
    mocks.actor = {
      status: 'granted',
      actorType: 'staff',
      actorKey: 'staff:staff-qa',
      sessionId: 'session-staff-qa',
      generation: 10,
      tenant: { opaqueId: 'tenant-qa', generation: 3 }
    };
    mocks.events = [];
    mocks.checkouts = [];
    mocks.blockCode = null;
    mocks.delayedStaffRefresh = null;
    mocks.assertHandoff.mockImplementation(({ tenant, actorKey }) => {
      if (mocks.blockCode) throw Object.assign(new Error('operation in flight'), { code: mocks.blockCode });
      if (mocks.checkouts.some((checkout) => checkout.tenantOpaqueId === tenant?.opaqueId
        && (!checkout.actorKey || checkout.actorKey === actorKey))) {
        throw Object.assign(new Error('active checkout'), { code: 'ACTOR_HANDOFF_CHECKOUT_OWNED' });
      }
      return true;
    });
    mocks.lockActorRuntime.mockImplementation(() => {
      mocks.events.push('actor_lock');
      mocks.actor = { ...mocks.actor, status: 'locked', generation: mocks.actor.generation + 1 };
    });
    mocks.clearStaffSessionCache.mockResolvedValue(undefined);
    mocks.clearAdminSessionCache.mockResolvedValue(undefined);
    mocks.staffLogoutSession.mockImplementation(async () => {
      mocks.events.push('remote_and_local_staff_logout');
      return {
        success: true,
        localCredentialsCleared: true,
        remoteRevocationStatus: 'confirmed'
      };
    });
    mocks.saveLicenseToStorage.mockImplementation(async () => mocks.events.push('license_save'));
    mocks.captureLicenseValidationContext.mockImplementation(() => ({
      licenseKey: 'LIC-STAFF-QA',
      actorBinding: { generation: mocks.actor.generation },
      actorHandle: { assertCurrent: vi.fn() }
    }));
    mocks.assertLicenseValidationContextCurrent.mockImplementation((context) => {
      if (context.actorBinding.generation !== mocks.actor.generation || mocks.actor.status !== 'granted') {
        throw Object.assign(new Error('STAFF_REFRESH_CONTEXT_STALE'), { code: 'STAFF_REFRESH_CONTEXT_STALE' });
      }
    });
    mocks.persistWithinLicenseValidationContext.mockImplementation((_context, _get, operation) => operation());
  });

  it('invalidates Staff authority before draining sync and keeps the linked business data', async () => {
    const state = createStore();

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'confirmed'
    });
    expect(state.staffLoginMessage).toContain('revocada por el servidor');

    expect(mocks.events).toEqual([
      'actor_lock',
      'stop_sync',
      'remote_and_local_staff_logout',
      'license_save',
      'tenant_lock'
    ]);
    expect(state.appStatus).toBe('staff_login_required');
    expect(state._isLoggingOut).toBe(false);
    expect(state.currentStaffUser).toBeNull();
    expect(state).toMatchObject({ licenseSyncActive: false, licenseSyncMode: 'idle', licenseSyncLicenseKey: null });
    expect(state.licenseDetails).toMatchObject({
      license_key: 'LIC-STAFF-QA',
      device_mode: 'staff_only',
      device_role: 'staff',
      staff_user: null,
      business_profile: { name: 'Farmacia QA' },
      feature_data: { retain: true }
    });
  });

  it('does not hold the closed session open while realtime teardown is still pending', async () => {
    const state = createStore();
    state.stopLicenseSync = vi.fn(() => {
      mocks.events.push('stop_sync_started');
      return new Promise(() => {});
    });

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'confirmed'
    });

    expect(mocks.events).toContain('stop_sync_started');
    expect(mocks.staffLogoutSession).toHaveBeenCalledWith('LIC-STAFF-QA');
    expect(state._isLoggingOut).toBe(false);
    expect(state.appStatus).toBe('staff_login_required');
    expect(state).toMatchObject({ licenseSyncActive: false, licenseSyncMode: 'idle', licenseSyncLicenseKey: null });
  });

  it('refuses logout while an actor-owned financial operation is in flight', async () => {
    const state = createStore();
    mocks.blockCode = 'ACTOR_HANDOFF_PENDING_OPERATIONS';

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: false,
      code: 'ACTOR_HANDOFF_PENDING_OPERATIONS',
      message: expect.stringContaining('operación de caja o guardado')
    });
    expect(mocks.lockActorRuntime).not.toHaveBeenCalled();
    expect(mocks.staffLogoutSession).not.toHaveBeenCalled();
  });

  it('reports local invalidation separately when the remote reply was lost', async () => {
    const state = createStore();
    mocks.staffLogoutSession.mockResolvedValueOnce({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_confirmed'
    });

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_confirmed'
    });
    expect(state.staffLoginMessage).toContain('no confirmó su revocación');
  });

  it('reports when the server revocation request was not attempted', async () => {
    const state = createStore();
    mocks.staffLogoutSession.mockResolvedValueOnce({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_attempted'
    });

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_attempted'
    });
    expect(state.staffLoginMessage).toContain('No se envió una solicitud de revocación');
  });

  it('refuses logout during a backup or restore and explains the block', async () => {
    const state = createStore();
    state.isBackupLoading = true;

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: false,
      code: 'BACKUP_OPERATION_ACTIVE',
      message: expect.stringContaining('respaldo o la restauración')
    });
    expect(mocks.lockActorRuntime).not.toHaveBeenCalled();
    expect(mocks.staffLogoutSession).not.toHaveBeenCalled();
  });

  it('refuses logout while this Staff session owns an active checkout', async () => {
    const state = createStore();
    mocks.checkouts = [{
      tenantOpaqueId: 'tenant-qa',
      actorKey: 'staff:staff-qa',
      orderId: 'sale-in-progress'
    }];

    await expect(state.logoutStaff()).resolves.toMatchObject({
      success: false,
      code: 'ACTOR_HANDOFF_CHECKOUT_OWNED',
      message: expect.stringContaining('cobro o cierre de venta')
    });
    expect(mocks.lockActorRuntime).not.toHaveBeenCalled();
    expect(mocks.staffLogoutSession).not.toHaveBeenCalled();
  });

  it('discards a permission response that arrives under the previous actor generation', async () => {
    const state = createStore();
    let resolveRefresh;
    mocks.delayedStaffRefresh = new Promise((resolve) => { resolveRefresh = resolve; });
    mocks.refreshAuthenticatedStaffSession.mockImplementation(async () => {
      await mocks.delayedStaffRefresh;
      return { verificationStatus: 'verified', valid: true, staff_user: { id: 'staff-late' } };
    });

    const refresh = state.refreshStaffSessionPermissions('manual');
    await Promise.resolve();
    expect(mocks.refreshAuthenticatedStaffSession).toHaveBeenCalledOnce();

    await state.logoutStaff();
    resolveRefresh();

    await expect(refresh).resolves.toBe(false);
    expect(state.currentStaffUser).toBeNull();
    expect(state.licenseDetails.staff_user).toBeNull();
  });

  it('routes a server-confirmed Solo Staff mode change to Staff login without unlinking the license', async () => {
    const state = createStore();
    state.licenseDetails.device_mode = 'admin_only';
    state.licenseDetails.device_role = 'admin';
    state.licenseDetails.admin_user = { id: 'owner-1' };

    await expect(state.requireStaffLoginAfterDeviceModeChange('staff_only')).resolves.toEqual({ success: true });

    expect(state.appStatus).toBe('staff_login_required');
    expect(state).toMatchObject({ licenseSyncActive: false, licenseSyncMode: 'idle', licenseSyncLicenseKey: null });
    expect(state.licenseDetails).toMatchObject({
      license_key: 'LIC-STAFF-QA',
      device_mode: 'staff_only',
      device_role: 'staff',
      admin_user: null,
      staff_user: null
    });
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
      license_key: 'LIC-STAFF-QA', device_mode: 'staff_only', device_role: 'staff', staff_user: null
    }));
    expect(state.clearLocalLicenseSession).toBeUndefined();
  });

  it('does not block the Solo Staff login route on realtime teardown', async () => {
    const state = createStore();
    state.licenseDetails.device_mode = 'admin_only';
    state.stopLicenseSync = vi.fn(() => {
      mocks.events.push('stop_sync_started');
      return new Promise(() => {});
    });

    await expect(state.requireStaffLoginAfterDeviceModeChange('staff_only')).resolves.toEqual({ success: true });

    expect(mocks.events).toContain('stop_sync_started');
    expect(state.appStatus).toBe('staff_login_required');
    expect(mocks.clearAdminSessionCache).toHaveBeenCalledOnce();
    expect(mocks.clearStaffSessionCache).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ licenseSyncActive: false, licenseSyncMode: 'idle', licenseSyncLicenseKey: null });
  });
});
