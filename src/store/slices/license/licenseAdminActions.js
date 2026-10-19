import { notifyPosCatalogSessionReset } from '../../../services/products/posCatalogSessionEvents';
import {
  activateLicense,
  adminLoginOnDevice,
  adminLogoutSession,
  adminTakeoverFreeDevice,
  clearAdminSessionCache,
  clearStaffSessionCache,
  enrollAdminOwnerOnDevice,
  hasValidOfflineAdminSession,
  verifyAdminSession
} from '../../../services/supabase';
import {
  beginActorRuntimeAuthentication,
  grantAuthenticatedActorRuntime,
  assertAuthenticatedActorSessionCurrent,
  lockActorRuntime
} from '../../../services/auth/actorSessionRuntimeBridge';
import { saveLicenseToStorage } from '../../../services/licenseStorage';
import { ensureLocalDatabaseReady } from '../../../services/db/databaseRuntime';
import {
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  createDatabaseRecoveryError,
  getDatabaseRecoveryState,
  isStructuralDatabaseError,
  setDatabaseRecoveryState
} from '../../../services/db/databaseRecoveryState';
import Logger from '../../../services/Logger';
import { actorRuntimeController, ActorRuntimeError, ACTOR_RUNTIME_ERROR_CODES } from '../../../services/auth/actorRuntimeController';
import { getTenantRuntimeReadiness } from '../../../services/db/tenantRuntimeRouter';
import {
  classifyAdminAccessDiscoveryFailure,
  isSessionVerificationInconclusive,
  isAuthoritativeSessionDenial,
  isSessionVerificationTransportFailure,
  classifySessionVerificationResponse,
  SESSION_VERIFICATION_STATUS
} from '../../../services/auth/sessionVerification';
import {
  assertLocalTenantAccess,
  initializeLocalTenantGuard,
  isLocalTenantAccessError,
  lockLocalTenantAccess
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';
import {
  hasModernAdminIdentityEvidence,
  requiresAdminIdentity
} from './licenseGuards';
import {
  clearPendingAdminSession,
  clearPendingAdminSessionIfLicenseChanged,
  createPendingAdminSession,
  validatePendingAdminSession
} from './pendingAdminSession';

const RECOVERY_MESSAGE = 'Tu sesión se verificó correctamente, pero no pudimos terminar de preparar Lanzo. Puedes reintentar la carga sin volver a registrar tu dispositivo.';
const AUTH_REQUIRED_MESSAGE = 'No pudimos recuperar tu sesión de forma segura. Inicia sesión nuevamente para continuar.';

const traceAuth = (phase, code = null) => Logger.debug('[AdminAuth]', { phase, code });
const createAttempt = (get, licenseKey) => {
  const tenant = getTenantRuntimeReadiness().runtime;
  let actor = actorRuntimeController.getState();
  let handle = null;
  return {
    get handle() { return handle; },
    refreshActor() { actor = actorRuntimeController.getState(); },
    bindActor() { handle = actorRuntimeController.capture(); actor = actorRuntimeController.getState(); },
    assertCurrent() {
      const state = get();
      const currentTenant = getTenantRuntimeReadiness().runtime;
      const currentActor = actorRuntimeController.getState();
      if ((state.adminLoginLicenseKey || state.licenseDetails?.license_key) !== licenseKey
        || (state.licenseDetails?.license_key && state.licenseDetails.license_key !== licenseKey)
        || state.currentDeviceRole === 'staff'
        || currentTenant?.opaqueId !== tenant?.opaqueId
        || currentTenant?.databaseName !== tenant?.databaseName
        || currentTenant?.generation !== tenant?.generation
        || currentActor.generation !== actor.generation || currentActor.status !== actor.status
        || currentActor.actorType !== actor.actorType) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
      }
      handle?.assertCurrent();
    }
  };
};

const completeAdminSession = async (set, get, licenseKey, result, reason, attempt, pending = null) => {
  const confirmedFreeTakeover = reason === 'admin_free_device_takeover'
    && String(result.details?.plan_code || '').trim().toLowerCase() === 'free_trial'
    && Number(result.details?.max_devices) === 1
    && result.details?.expires_at === null;
  const licenseData = {
    ...get().licenseDetails,
    ...result.details,
    ...(confirmedFreeTakeover ? {
      status: 'active',
      lifecycle_state: 'active',
      grace_period_ends: null,
      is_in_grace: false,
      is_entitled: true
    } : {}),
    license_key: result.details?.license_key || licenseKey,
    valid: true,
    device_role: 'admin',
    staff_user: null,
    admin_user: result.admin_user || null
  };

  attempt.assertCurrent();
  const session = pending || createPendingAdminSession({ licenseKey, result });
  try {
    if (licenseData.license_key !== licenseKey) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.TENANT_MISMATCH);
    }
    await assertLocalTenantAccess(licenseData, { reason });
    attempt.assertCurrent();
    set({
      licenseDetails: licenseData,
      ...(confirmedFreeTakeover ? { licenseStatus: 'active', gracePeriodEnds: null } : {}),
      _isLoggingOut: false,
      currentDeviceRole: 'admin',
      currentAdminUser: result.admin_user || null,
      currentStaffUser: null,
      adminLoginLicenseKey: licenseKey,
      adminLoginMessage: null,
      adminLoginError: null,
      adminEnrollmentRequired: false,
      localTenantIsolation: null,
      pendingAdminSessionResult: session
    });

    await saveLicenseToStorage(licenseData);
    attempt.assertCurrent();
    try {
      if (!session.actorHandle) await clearStaffSessionCache();
    } catch (cacheError) {
      if (!isStructuralDatabaseError(cacheError)) throw cacheError;
      Logger.warn('[AdminAuth] Limpieza staff diferida por recuperación local.');
    }

    await ensureLocalDatabaseReady();
    attempt.assertCurrent();
    if (!session.actorHandle) {
      await grantAuthenticatedActorRuntime({
        actorType: 'admin',
        actor: result.admin_user || licenseData.admin_user
      });
      attempt.bindActor();
      session.actorHandle = attempt.handle;
      traceAuth('ACTOR_GRANTED');
    }
    await assertAuthenticatedActorSessionCurrent({
      handle: session.actorHandle, actorType: 'admin', actor: result.admin_user || licenseData.admin_user
    });
    attempt.assertCurrent();
    let preparedStatus = null;
    const profileOptions = {
      forceRemote: true, reason, assertCurrent: () => attempt.assertCurrent(),
      onPrepared: (status) => { preparedStatus = status; }
    };
    if (['new_license_setup', 'existing_license'].includes(get().ownerEnrollmentContext)) {
      profileOptions.allowSetupTransition = true;
    }
    traceAuth('PROFILE_LOAD_PENDING');
    await get()._loadProfile(licenseKey, profileOptions);
    attempt.assertCurrent();
    const outcome = preparedStatus === 'ready' && get().appStatus === 'ready' ? 'READY'
      : preparedStatus === 'setup_required' && get().appStatus === 'setup_required'
        && profileOptions.allowSetupTransition ? 'SETUP_REQUIRED' : null;
    if (!outcome) {
      const error = new Error(RECOVERY_MESSAGE);
      error.code = 'ADMIN_PROFILE_LOAD_PENDING';
      throw error;
    }
    traceAuth('PROFILE_LOAD_COMPLETED');
    if (get().appStatus === 'ready') {
      get()._validateInBackground?.(licenseKey, {
        reason: reason === 'admin_login_resume' ? 'admin_login_resume' : 'admin_login'
      });
    }
    // A ready profile completes the enrollment route. Keep an explicit owner
    // enrollment context when profile hydration routes into Setup.
    set({
      pendingAdminSessionResult: null,
      ...(get().appStatus === 'ready' ? { ownerEnrollmentContext: null } : {})
    });
    return { success: true, remoteAuthenticated: true, outcome };
  } catch (error) {
    try { attempt.assertCurrent(); } catch {
      traceAuth('AUTH_CONTEXT_REJECTED', error?.code);
      return { success: false, code: 'ACTOR_CONTEXT_STALE', outcome: 'AUTHENTICATION_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
    }
    const classification = classifyDatabaseError(error);
    const securityFailure = String(error?.code || '').startsWith('ACTOR_')
      || isLocalTenantAccessError(error) || String(error?.code || '').startsWith('TENANT_');
    // Preserve authority only for preparation failures owned by this exact
    // granted session. Identity/handoff/storage barriers continue to fail closed.
    if (!session.actorHandle || securityFailure || classification.structural) {
      lockActorRuntime('admin_actor_binding_or_bootstrap_failed');
      session.actorHandle = null;
    }
    if (securityFailure) {
      clearPendingAdminSession(set, 'admin_authority_rejected');
      if (isLocalTenantAccessError(error)) enterLocalTenantIsolationFailure(set, error);
      else set({ appStatus: 'admin_login_required', currentAdminUser: null });
      traceAuth('AUTH_CONTEXT_REJECTED', error?.code);
      return { success: false, code: error.code, outcome: 'AUTHENTICATION_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
    }

    if (classification.structural) {
      const currentDiagnostic = error?.diagnostic || getDatabaseRecoveryState();
      setDatabaseRecoveryState({
        ...currentDiagnostic,
        status: currentDiagnostic?.isRetryable === false
          ? DATABASE_RECOVERY_STATUS.FAILED
          : DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
        errorCode: currentDiagnostic?.errorCode || classification.code,
        databaseName: currentDiagnostic?.databaseName || 'LanzoDB1',
        isRetryable: classification.retryable !== false,
        requiresMigration: classification.requiresMigration === true || currentDiagnostic?.requiresMigration === true,
        message: currentDiagnostic?.message || 'La sesión administrativa es válida, pero la base local necesita recuperarse.'
      });
      set({
        appStatus: 'local_database_recovery_required',
        adminLoginError: {
          code: classification.code,
          message: 'La sesión se inició correctamente. Falta recuperar la base local antes de entrar.'
        }
      });
      return {
        success: false,
        remoteAuthenticated: true,
        localRecoveryRequired: true,
        code: classification.code,
        message: 'La sesión se inició correctamente. Lanzo conservará tus datos mientras repara la base local.'
      };
    }

    traceAuth('PROFILE_LOAD_RECOVERABLE_FAILURE', error?.code || 'ADMIN_LOCAL_BOOTSTRAP_FAILED');
    set({
      appStatus: 'admin_login_required',
      adminLoginError: {
        code: error?.code || 'ADMIN_LOCAL_BOOTSTRAP_FAILED',
        message: RECOVERY_MESSAGE
      }
    });
    return {
      success: false,
      remoteAuthenticated: true,
      recoveryRequired: true,
      outcome: 'RECOVERY_REQUIRED',
      code: error?.code || 'ADMIN_LOCAL_BOOTSTRAP_FAILED',
      message: RECOVERY_MESSAGE
    };
  }
};

export const createLicenseAdminActions = ({ set, get }) => {
  let authenticationInFlight = false;
  const serialize = (operation, duringBootstrap = false) => async (...args) => {
    if (authenticationInFlight || (!duringBootstrap && get()._isInitializing)) {
      return { success: false, code: 'ADMIN_AUTH_IN_PROGRESS' };
    }
    authenticationInFlight = true;
    try { return await operation(...args); } finally { authenticationInFlight = false; }
  };
  const actions = {
  pendingAdminSessionResult: null,
  _isAdminAuthenticationInFlight: () => authenticationInFlight,

  _completeRestoredAdminPreparation: async (licenseKey) => {
    const state = get();
    const attempt = createAttempt(get, licenseKey);
    attempt.assertCurrent();
    attempt.bindActor();
    if (attempt.handle.actorType !== 'admin'
      || attempt.handle.actorId !== String(state.currentAdminUser?.id || '')) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);
    }
    const result = { success: true, admin_user: state.currentAdminUser, details: state.licenseDetails };
    const pending = { ...createPendingAdminSession({ licenseKey, result }), actorHandle: attempt.handle };
    return completeAdminSession(set, get, licenseKey, result, 'admin_session_restore', attempt, pending);
  },

  resumeAdminSessionPreparation: async () => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    const pending = get().pendingAdminSessionResult;
    let attempt;
    try {
      if (!validatePendingAdminSession({ pending, licenseKey, currentAdminUser: get().currentAdminUser }).valid) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED);
      }
      if (pending.actorHandle) {
        pending.actorHandle.assertCurrent();
      } else if (!pending.sessionIdentity) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED);
      } else if (actorRuntimeController.getState().status !== 'locked') {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED);
      }
      const pendingAdminActor = () => get().currentAdminUser || pending.result?.admin_user || null;
      attempt = createAttempt(get, licenseKey);
      attempt.assertCurrent();
      if (pending.actorHandle) {
        await assertAuthenticatedActorSessionCurrent({
          handle: pending.actorHandle, actorType: 'admin', actor: pendingAdminActor()
        });
        attempt.assertCurrent();
        attempt.bindActor();
      }
      traceAuth('AUTH_RECOVERY_STARTED');
      // Revalidate an existing session; never register a second device/session.
      // A denied response is authoritative. Offline continuity is only allowed
      // for the already granted actor under the existing offline cache contract.
      let verified = null;
      if (navigator.onLine) {
        verified = await verifyAdminSession(licenseKey, {
          beforeLocalPersistence: async (source) => {
            attempt.assertCurrent();
            if (source.success === true && String(source.admin_user?.id || '') !== String(pending.adminUserId || '')) {
              throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);
            }
            const expectedSessionId = pending.actorHandle?.sessionId || pending.sessionIdentity;
            if (source.success === true && String(source.admin_session_id || '') !== expectedSessionId) {
              throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
            }
            if (pending.actorHandle) {
              await assertAuthenticatedActorSessionCurrent({ handle: pending.actorHandle, actorType: 'admin', actor: pendingAdminActor() });
            }
            await assertLocalTenantAccess(source, { reason: 'admin_login_resume' });
            attempt.assertCurrent();
          }
        });
        attempt.assertCurrent();
      }
      const classifiedVerification = verified?.verificationStatus
        ? verified
        : verified
          ? classifySessionVerificationResponse('admin', { data: verified })
          : null;
      if (classifiedVerification?.valid === true && classifiedVerification?.success === true) {
        if (String(verified.admin_user?.id || '') !== String(pending.adminUserId || '')) {
          throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);
        }
      } else {
        const connectionFailure = classifiedVerification
          ? isSessionVerificationTransportFailure(classifiedVerification)
          : !navigator.onLine;
        if (isAuthoritativeSessionDenial(classifiedVerification)) {
          throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED);
        }

        let offlineSessionRecovered = false;
        if (connectionFailure && pending.actorHandle) {
          if (await hasValidOfflineAdminSession()) {
            await get()._processOfflineMode(get().licenseDetails, { reason: 'admin_login_resume' });
            offlineSessionRecovered = true;
          } else if (!navigator.onLine) {
            // A pending authenticated actor cannot outlive the existing offline
            // session contract when its canonical evidence is no longer valid.
            throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED);
          }
        }

        if (!offlineSessionRecovered
            && (isSessionVerificationInconclusive(classifiedVerification) || !navigator.onLine)) {
          if (!navigator.onLine && !connectionFailure) {
            throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED);
          }
          const verificationStatus = classifiedVerification?.verificationStatus
            || SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE;
          const message = verificationStatus === SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE
            ? 'No pudimos verificar tu sesión por un problema de conexión. Tus datos locales se mantienen protegidos. Puedes volver a intentarlo cuando se restablezca la conexión.'
            : verificationStatus === SESSION_VERIFICATION_STATUS.LOCAL_STORAGE_ERROR
              ? 'No pudimos leer las credenciales guardadas. Tus datos locales se mantienen protegidos. Reintenta cuando el almacenamiento esté disponible.'
              : 'No pudimos confirmar la sesión con el servidor. Tu acceso permanece protegido y la sesión pendiente se conserva para reintentar.';
          set({
            appStatus: 'admin_login_required',
            adminLoginMessage: message,
            adminLoginError: {
              code: 'SESSION_VERIFICATION_INCONCLUSIVE',
              verificationStatus,
              reasonCode: classifiedVerification?.code || null
            }
          });
          traceAuth('AUTH_RECOVERY_VERIFICATION_INCONCLUSIVE', classifiedVerification?.code);
          return {
            success: false,
            recoveryRequired: true,
            code: 'SESSION_VERIFICATION_INCONCLUSIVE',
            verificationStatus,
            message
          };
        } else if (!offlineSessionRecovered) {
          throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED);
        }
      }
      attempt.assertCurrent();
      if (pending.actorHandle) {
        await assertAuthenticatedActorSessionCurrent({ handle: pending.actorHandle, actorType: 'admin', actor: pendingAdminActor() });
        attempt.assertCurrent();
      } else {
        beginActorRuntimeAuthentication('admin');
        attempt.refreshActor();
      }
      const recoveredResult = verified?.success === true && verified?.valid === true
        ? { ...pending.result, ...verified, details: { ...pending.result.details, ...verified.details } }
        : pending.result;
      const recoveredPending = {
        ...createPendingAdminSession({ licenseKey, result: recoveredResult }),
        authenticatedAt: pending.authenticatedAt,
        actorHandle: pending.actorHandle
      };
      const result = await completeAdminSession(set, get, licenseKey, recoveredResult, 'admin_login_resume', attempt, recoveredPending);
      traceAuth(result.success ? 'AUTH_RECOVERY_COMPLETED' : 'AUTH_RECOVERY_FAILED', result.code);
      return result;
    } catch (error) {
      // Stale work may report failure, but cannot lock or republish a newer UI.
      let ownsContext = false;
      try { attempt?.assertCurrent(); ownsContext = Boolean(attempt); } catch { /* superseded */ }
      if (!ownsContext && pending?.actorHandle && get().pendingAdminSessionResult === pending) {
        try {
          pending.actorHandle.assertCurrent();
          ownsContext = pending.licenseKey === licenseKey && get().currentDeviceRole === 'admin';
        } catch { /* The original authority has already been superseded. */ }
      }
      if (ownsContext) {
        lockActorRuntime('admin_recovery_rejected');
        clearPendingAdminSession(set, 'admin_recovery_rejected');
        set({ appStatus: 'admin_login_required', currentAdminUser: null, adminLoginError: { code: error?.code, message: AUTH_REQUIRED_MESSAGE } });
      } else if (get().pendingAdminSessionResult === pending) {
        clearPendingAdminSession(set, 'obsolete_admin_recovery');
      }
      traceAuth('AUTH_RECOVERY_FAILED', error?.code);
      return { success: false, code: error?.code || 'ADMIN_RECOVERY_REJECTED', outcome: 'AUTHENTICATION_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
    }
  },

  chooseLicenseAccess: (accessType) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    if (actorRuntimeController.getState().status === 'granted') {
      return { success: false, code: 'ACTOR_HANDOFF_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
    }
    if (accessType === 'staff') {
      clearPendingAdminSession(set, 'choose_staff_access');
      set({
        appStatus: 'staff_login_required',
        currentDeviceRole: 'staff',
        currentAdminUser: null,
        currentStaffUser: null,
        staffLoginLicenseKey: licenseKey,
        staffLoginMessage: null,
        staffLoginError: null
      });
      return;
    }
    set({
      appStatus: 'admin_login_required',
      currentDeviceRole: 'admin',
      adminLoginMessage: null,
      adminLoginError: null
    });
  },

  returnToLicenseAccessChoice: async () => {
    const state = get();
    const licenseKey = state.adminLoginLicenseKey
      || state.staffLoginLicenseKey
      || state.licenseDetails?.license_key
      || null;
    const hasAuthenticatedAdminSession = Boolean(
      state.pendingAdminSessionResult?.result?.success
      || state.currentAdminUser
    );
    lockActorRuntime('return_to_license_access_choice');
    get()._invalidateProfileLoads?.();

    // An explicit actor logout already cleared the actor credential before the
    // tenant guard was locked. In that state the login modal is intentionally
    // allowed to switch profiles without touching tenant-owned SYNC_CACHE.
    // Persisted cleanup is only required when a remote Admin session is still
    // active/pending (for example after a local bootstrap failure).
    if (hasAuthenticatedAdminSession) {
      try {
        if (licenseKey) {
          try {
            await adminLogoutSession(licenseKey);
          } catch (logoutError) {
            Logger.warn('[AdminAuth] Falló el cierre remoto al cambiar de perfil; limpiando credencial local.', logoutError);
            await clearAdminSessionCache();
          }
        } else {
          await clearAdminSessionCache();
        }

        await clearStaffSessionCache();
      } catch (cleanupError) {
        Logger.error('[AdminAuth] No se pudo limpiar la sesión actor antes de cambiar de perfil:', cleanupError);
        return {
          success: false,
          code: 'ACTOR_SESSION_CLEANUP_FAILED',
          message: 'No se pudo limpiar la sesión actual. Reintenta antes de cambiar de perfil.'
        };
      }
    }

    clearPendingAdminSession(set, 'return_to_access_choice');
    set({
      appStatus: 'license_access_required',
      ownerEnrollmentContext: null,
      currentDeviceRole: null,
      currentAdminUser: null,
      currentStaffUser: null,
      adminLoginLicenseKey: licenseKey,
      staffLoginLicenseKey: licenseKey,
      adminLoginMessage: null,
      adminLoginError: null,
      staffLoginMessage: null,
      staffLoginError: null,
      adminEnrollmentRequired: false,
      _isLoggingOut: false
    });
    return { success: true };
  },

  _requireAdminLogin: async (licenseSource = null, validation = {}) => {
    const source = licenseSource || get().licenseDetails || {};
    const licenseKey = source.license_key || get().adminLoginLicenseKey;
    const preserveSessionCredentials = validation.preserveSessionCredentials === true;
    lockActorRuntime('admin_login_required');
    await get().stopLicenseSync();
    if (!preserveSessionCredentials) {
      await clearAdminSessionCache();
      await clearStaffSessionCache();
      if (source.license_key) await saveLicenseToStorage({ ...source, device_role: 'admin', admin_user: null });
    }
    set({
      appStatus: 'admin_login_required',
      ownerEnrollmentContext: null,
      licenseDetails: source.license_key
        ? { ...source, device_role: 'admin', ...(preserveSessionCredentials ? {} : { admin_user: null }) }
        : get().licenseDetails,
      currentDeviceRole: 'admin',
      currentAdminUser: null,
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: validation.message || 'Inicia sesion como administrador para continuar.',
      adminLoginError: validation.code ? { code: validation.code, message: validation.message || null } : null,
      adminEnrollmentRequired: false,
      pendingAdminSessionResult: null
    });
  },

  discoverAdminAccess: async (licenseKey) => {
    initializeLocalTenantGuard('admin_access_discovery');
    await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'admin_access_discovery' });
    clearPendingAdminSessionIfLicenseChanged(set, get, licenseKey, 'discover_other_license');
    const result = await activateLicense(licenseKey, {
      beforeLocalPersistence: (details = {}) => assertLocalTenantAccess(
        { ...details, license_key: details.license_key || licenseKey },
        { reason: 'admin_access_activation' }
      )
    });
    const currentLicense = get().licenseDetails || {};
    const mergedLicense = {
      ...currentLicense,
      ...(result.details || {}),
      license_key: licenseKey,
      device_role: 'admin',
      staff_user: null
    };
    const modernAdminCutover = Boolean(
      hasModernAdminIdentityEvidence(currentLicense)
      || hasModernAdminIdentityEvidence(mergedLicense)
    );
    const discoveredLicense = modernAdminCutover
      ? { ...mergedLicense, admin_identity_required: true }
      : mergedLicense;

    if (result.admin_enrollment_required) {
      lockActorRuntime('admin_enrollment_required');
      set({
        appStatus: 'admin_enrollment_required',
        licenseDetails: { ...(result.details || {}), license_key: licenseKey, device_role: 'admin' },
        currentDeviceRole: 'admin',
        currentAdminUser: null,
        adminLoginLicenseKey: licenseKey,
        adminLoginMessage: result.message,
        adminEnrollmentRequired: true,
        pendingAdminSessionResult: null
      });
      return { success: false, enrollmentRequired: true };
    }
    if (result.access_choice_required) {
      await get()._requireAdminLogin(discoveredLicense, result);
      return { success: false, adminLoginRequired: true };
    }

    if (result.valid) {
      if (requiresAdminIdentity(discoveredLicense)) {
        await get()._requireAdminLogin(discoveredLicense, {
          ...result,
          code: result.code || 'ADMIN_LOGIN_REQUIRED',
          message: result.message || 'Inicia sesion como administrador para continuar.'
        });
        return { success: false, adminLoginRequired: true };
      }

      // Legacy device validation has no authenticated actor session proof.
      // Preserve compatibility only for a genuinely legacy FREE/local owner;
      // once the client has modern Admin evidence it can never become legacy.
      lockActorRuntime('legacy_admin_without_actor_session');
      Logger.warn('[AdminAuth] Backend legacy detectado; continuando con sesión local hasta aplicar la migración.');
      await saveLicenseToStorage(discoveredLicense);
      set({
        licenseDetails: discoveredLicense,
        _isLoggingOut: false,
        currentDeviceRole: 'admin',
        currentAdminUser: null,
        currentStaffUser: null,
        adminLoginMessage: null,
        adminLoginError: null,
        pendingAdminSessionResult: null
      });
      await get()._processOfflineMode(discoveredLicense, { reason: 'legacy_admin_auth_compatibility' });
      return { success: true, legacyBackendFallback: true };
    }

    const discoveryFailure = classifyAdminAccessDiscoveryFailure(result);
    if (!isAuthoritativeSessionDenial(discoveryFailure)) {
      const verificationStatus = discoveryFailure.verificationStatus;
      const message = verificationStatus === SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE
        ? 'No pudimos verificar el acceso por un problema de conexión. Tus datos locales se mantienen protegidos. Reintenta cuando regrese la conexión.'
        : verificationStatus === SESSION_VERIFICATION_STATUS.SERVER_ERROR
          ? 'El servidor no pudo completar la verificación del acceso. Tus datos locales se mantienen protegidos; reintenta más tarde.'
          : 'El servidor no confirmó el acceso administrativo. Tus credenciales y datos locales se mantienen protegidos; reintenta la verificación.';
      lockActorRuntime('admin_access_discovery_inconclusive');
      set({
        appStatus: 'admin_login_required',
        licenseDetails: discoveredLicense,
        currentDeviceRole: 'admin',
        currentAdminUser: null,
        adminLoginLicenseKey: licenseKey,
        adminLoginMessage: message,
        adminLoginError: {
          code: 'SESSION_VERIFICATION_INCONCLUSIVE',
          verificationStatus,
          reasonCode: discoveryFailure.code || null
        }
      });
      return {
        success: false,
        recoverable: true,
        code: 'SESSION_VERIFICATION_INCONCLUSIVE',
        verificationStatus
      };
    }

    await get()._requireAdminLogin(discoveredLicense, result);
    return { success: false, adminLoginRequired: true };
  },

  handleAdminLogin: async ({ username, password }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    let attempt;
    try {
      const pending = get().pendingAdminSessionResult;
      if (pending) {
        const pendingValidation = validatePendingAdminSession({ pending, licenseKey, currentAdminUser: get().currentAdminUser });
        if (!pendingValidation.valid && actorRuntimeController.getState().status === 'locked') {
          clearPendingAdminSession(set, pendingValidation.reason);
        } else {
        const expectedUsername = pending.result?.admin_user?.username;
        if (!expectedUsername || expectedUsername !== username.trim()) {
          return { success: false, code: 'ACTOR_HANDOFF_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
        }
        return await actions.resumeAdminSessionPreparation();
        }
      }
      if (actorRuntimeController.getState().status === 'granted' && get().appStatus === 'admin_login_required') {
        // A stale view may have lost the preparation marker. The immutable
        // grant is the proof anchor; visual identity alone never authorizes it.
        const handle = actorRuntimeController.capture();
        const state = get();
        const admin = state.currentAdminUser;
        if (handle.actorType !== 'admin' || state.currentDeviceRole !== 'admin'
          || handle.actorId !== String(admin?.id || '')
          || state.licenseDetails?.license_key !== licenseKey
          || !admin?.username || admin.username !== username.trim()) {
          return { success: false, code: 'ACTOR_HANDOFF_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
        }
        const result = { success: true, admin_user: admin, session: { id: handle.sessionId }, details: state.licenseDetails };
        set({ pendingAdminSessionResult: { ...createPendingAdminSession({ licenseKey, result }), actorHandle: handle } });
        return await actions.resumeAdminSessionPreparation();
      }
      initializeLocalTenantGuard('admin_login');
      await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'admin_login' });
      attempt = createAttempt(get, licenseKey);
      attempt.assertCurrent();
      beginActorRuntimeAuthentication('admin');
      attempt.refreshActor();
      traceAuth('ACTOR_AUTHENTICATING');
      traceAuth('AUTH_REMOTE_STARTED');
      const result = await adminLoginOnDevice({
        licenseKey,
        username,
        password,
        beforeLocalPersistence: async (tenantSource) => {
          attempt.assertCurrent();
          await assertLocalTenantAccess(tenantSource, { reason: 'admin_login_before_local_persistence' });
          attempt.assertCurrent();
        }
      });
      attempt.assertCurrent();
      if (!result.success || result.valid === false) {
        if (result.code === 'FREE_DEVICE_TAKEOVER_REQUIRED' || result.takeoverRequired === true) {
          lockActorRuntime('admin_free_device_takeover_required');
          clearPendingAdminSession(set, 'admin_free_device_takeover_required');
          set({ adminLoginError: null });
          return { ...result, success: false, takeoverRequired: true };
        }

        const storageFailure = classifyDatabaseError(result);
        if (storageFailure.structural) {
          throw Object.assign(new Error(result.message || 'No se pudo preparar el almacenamiento local.'), { code: storageFailure.code });
        }
        const connectionFailure = result.code === 'ONLINE_REQUIRED'
          || /network|fetch|timeout|timed out|connection/i.test(result.message || '');
        const failureReason = connectionFailure ? 'admin_connection_failed' : 'admin_credentials_rejected';
        traceAuth(connectionFailure ? 'AUTH_REMOTE_UNAVAILABLE' : 'AUTH_REMOTE_REJECTED', result.code);
        lockActorRuntime(failureReason);
        clearPendingAdminSession(set, failureReason);
        set({ adminLoginError: { code: result.code, message: result.message } });
        return { ...result, success: false };
      }
      traceAuth('AUTH_REMOTE_VALIDATED');
      return await completeAdminSession(set, get, licenseKey, result, 'admin_login', attempt);
    } catch (error) {
      if (attempt) {
        try { attempt.assertCurrent(); } catch {
          traceAuth('AUTH_CONTEXT_REJECTED', 'ACTOR_CONTEXT_STALE');
          return { success: false, code: 'ACTOR_CONTEXT_STALE', message: AUTH_REQUIRED_MESSAGE };
        }
      }
      // A login attempt never owns an actor granted before it began.
      if (actorRuntimeController.getState().status !== 'granted') lockActorRuntime('admin_login_failed');
      if (isLocalTenantAccessError(error)) {
        enterLocalTenantIsolationFailure(set, error);
        return {
          success: false,
          localTenantMismatch: true,
          code: error.code,
          message: error.message
        };
      }

      const classification = classifyDatabaseError(error);
      if (classification.structural) {
        const recoveryError = createDatabaseRecoveryError({
          ...getDatabaseRecoveryState(),
          errorCode: classification.code
        }, error);
        return {
          success: false,
          remoteAuthenticated: validatePendingAdminSession({
            pending: get().pendingAdminSessionResult,
            licenseKey,
            currentAdminUser: get().currentAdminUser
          }).valid,
          localRecoveryRequired: true,
          code: classification.code,
          message: recoveryError.message
        };
      }
      traceAuth('AUTH_CONTEXT_REJECTED', error?.code || 'ADMIN_LOGIN_FAILED');
      return {
        success: false,
        code: error?.code || 'ADMIN_LOGIN_FAILED',
        message: String(error?.code || '').startsWith('ACTOR_') ? AUTH_REQUIRED_MESSAGE
          : 'No pudimos verificar tu acceso por un problema de conexión. Comprueba internet e inténtalo nuevamente.'
      };
    }
  },

  handleFreeDeviceTakeover: async ({ username, password }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    let attempt;
    try {
      initializeLocalTenantGuard('admin_free_device_takeover');
      await assertLocalTenantAccess(
        { license_key: licenseKey },
        { reason: 'admin_free_device_takeover' }
      );
      attempt = createAttempt(get, licenseKey);
      attempt.assertCurrent();
      beginActorRuntimeAuthentication('admin');
      attempt.refreshActor();

      const result = await adminTakeoverFreeDevice({
        licenseKey,
        username,
        password,
        beforeLocalPersistence: async (tenantSource) => {
          attempt.assertCurrent();
          await assertLocalTenantAccess(tenantSource, { reason: 'admin_free_device_takeover_before_local_persistence' });
          attempt.assertCurrent();
        }
      });
      attempt.assertCurrent();

      if (!result.success || result.valid === false) {
        lockActorRuntime('admin_free_device_takeover_rejected');
        clearPendingAdminSession(set, 'admin_free_device_takeover_rejected');
        set({ adminLoginError: { code: result.code, message: result.message } });
        return { ...result, success: false };
      }

      return await completeAdminSession(
        set,
        get,
        licenseKey,
        result,
        'admin_free_device_takeover',
        attempt
      );
    } catch (error) {
      if (attempt) {
        try { attempt.assertCurrent(); } catch {
          return { success: false, code: 'ACTOR_CONTEXT_STALE', message: AUTH_REQUIRED_MESSAGE };
        }
      }
      if (actorRuntimeController.getState().status === 'granted') {
        return { success: false, code: error?.code || 'ACTOR_HANDOFF_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
      }
      lockActorRuntime('admin_free_device_takeover_failed');
      if (isLocalTenantAccessError(error)) {
        enterLocalTenantIsolationFailure(set, error);
        return {
          success: false,
          localTenantMismatch: true,
          code: error.code,
          message: error.message
        };
      }

      const classification = classifyDatabaseError(error);
      if (classification.structural) {
        const recoveryError = createDatabaseRecoveryError({
          ...getDatabaseRecoveryState(),
          errorCode: classification.code
        }, error);
        return {
          success: false,
          remoteAuthenticated: validatePendingAdminSession({
            pending: get().pendingAdminSessionResult,
            licenseKey,
            currentAdminUser: get().currentAdminUser
          }).valid,
          localRecoveryRequired: true,
          code: classification.code,
          message: recoveryError.message
        };
      }

      Logger.error('[AdminAuth] Error durante recuperación de dispositivo Free:', error);
      return {
        success: false,
        code: error?.code || 'FREE_DEVICE_TAKEOVER_FAILED',
        message: error?.message || 'No se pudo recuperar este dispositivo.'
      };
    }
  },

  handleAdminEnrollment: async ({ username, password, displayName }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    let attempt;
    try {
      initializeLocalTenantGuard('admin_enrollment');
      await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'admin_enrollment' });
      attempt = createAttempt(get, licenseKey);
      attempt.assertCurrent();
      beginActorRuntimeAuthentication('admin');
      attempt.refreshActor();
      const result = await enrollAdminOwnerOnDevice({
        licenseKey,
        username,
        password,
        displayName,
        beforeLocalPersistence: async (tenantSource) => {
          attempt.assertCurrent();
          await assertLocalTenantAccess(tenantSource, { reason: 'admin_enrollment_before_local_persistence' });
          attempt.assertCurrent();
        }
      });
      attempt.assertCurrent();
      if (!result.success || result.valid === false) {
        lockActorRuntime('admin_enrollment_rejected');
        clearPendingAdminSession(set, 'admin_credentials_rejected');
        set({ adminLoginError: { code: result.code, message: result.message } });
        return { ...result, success: false };
      }
      return await completeAdminSession(set, get, licenseKey, result, 'admin_enrollment', attempt);
    } catch (error) {
      if (attempt) {
        try { attempt.assertCurrent(); } catch {
          return { success: false, code: 'ACTOR_CONTEXT_STALE', message: AUTH_REQUIRED_MESSAGE };
        }
      }
      if (actorRuntimeController.getState().status === 'granted') {
        return { success: false, code: error?.code || 'ACTOR_HANDOFF_REQUIRED', message: AUTH_REQUIRED_MESSAGE };
      }
      lockActorRuntime('admin_enrollment_failed');
      if (isLocalTenantAccessError(error)) {
        enterLocalTenantIsolationFailure(set, error);
        return {
          success: false,
          localTenantMismatch: true,
          code: error.code,
          message: error.message
        };
      }

      return {
        success: false,
        code: error?.code || 'ADMIN_ENROLLMENT_FAILED',
        message: error?.message || 'No se pudo completar la inscripción.'
      };
    }
  },

  logoutAdmin: async () => {
    const licenseKey = get().licenseDetails?.license_key || get().adminLoginLicenseKey;
    // Invalidate actor-sensitive async work before any remote/local logout I/O.
    // Tenant teardown keeps its existing behavior in this phase.
    lockActorRuntime('admin_actor_logged_out');
    get()._invalidateProfileLoads?.();
    get().resetEcommerceOrdersState?.();
    get().lockDriveSession?.();
    set({
      appStatus: 'admin_login_required',
      _isLoggingOut: true,
      currentAdminUser: null,
      cashOpeningPolicy: 'manual',
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: 'Cerrando sesion administrativa...',
      adminLoginError: null,
      pendingAdminSessionResult: null
    });
    notifyPosCatalogSessionReset();
    try {
      await get().stopLicenseSync();
      await adminLogoutSession(licenseKey);
    } finally {
      lockLocalTenantAccess('admin_actor_logged_out');
      get().lockDriveSession?.();
    }
    set({
      appStatus: 'admin_login_required',
      _isLoggingOut: true,
      currentAdminUser: null,
      cashOpeningPolicy: 'manual',
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: 'Sesion administrativa cerrada.',
      adminLoginError: null,
      pendingAdminSessionResult: null
    });
  }
  };
  return {
    ...actions,
    handleAdminLogin: serialize(actions.handleAdminLogin),
    handleFreeDeviceTakeover: serialize(actions.handleFreeDeviceTakeover),
    handleAdminEnrollment: serialize(actions.handleAdminEnrollment),
    resumeAdminSessionPreparation: serialize(actions.resumeAdminSessionPreparation),
    _completeRestoredAdminPreparation: serialize(actions._completeRestoredAdminPreparation, true)
  };
};
