import { loadBootstrapProfile } from '../../../services/bootstrap/bootstrapLifecycle';
// src/store/slices/license/licenseBootstrapActions.js

import Logger from '../../../services/Logger';
import { prepareLocalDatabase } from '../../../services/db/databaseRuntime';
import {
    DATABASE_RECOVERY_STATUS,
    classifyDatabaseError,
    getDatabaseRecoveryState,
    setDatabaseRecoveryState
} from '../../../services/db/databaseRecoveryState';
import {
    beginActorRuntimeAuthentication,
    restoreActorRuntimeFromCurrentSessionCache,
    lockActorRuntime,
    assertAuthenticatedActorSessionCurrent,
    refreshAuthenticatedAdminSessionAuthorization
} from '../../../services/auth/actorSessionRuntimeBridge';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import {
    isAuthoritativeSessionDenial,
    isSessionVerificationInconclusive,
    SESSION_VERIFICATION_STATUS
} from '../../../services/auth/sessionVerification';

import {
    revalidateLicense,
    hasStaffSessionToken,
    verifyStaffSession,
    getAdminOfflineAuthorization,
    verifyAdminSession
} from '../../../services/supabase';
import {
    ADMIN_OFFLINE_AUTHORIZATION_REASON,
    getAdminOfflineAuthorizationUserMessage,
    isSafeAdminOfflineVerificationFailure
} from '../../../services/auth/adminOfflineAuthorization';

import {
    saveLicenseToStorage,
    getLicenseFromStorage
} from '../../../services/licenseStorage';

import {
    hasModernAdminIdentityEvidence,
    isLicensePlanBlockFailure,
    requiresAdminIdentity
} from './licenseGuards';
import {
    assertLocalTenantAccess,
    initializeLocalTenantGuard,
    isLocalTenantAccessError,
    lockLocalTenantAccess,
    runWithLocalTenantSyncLease
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';

let coordinatorState = 'idle';

const SAFE_BOOTSTRAP_DIAGNOSTIC_CODES = new Set([
    'ABORT_ERR',
    'ACTOR_RUNTIME_RESTORE_FAILED',
    'ACTOR_SESSION_RESTORE_FAILED',
    'ADMIN_AUTH_RATE_LIMITED',
    'ADMIN_DEVICE_REQUIRED',
    'ADMIN_ENROLLMENT_RATE_LIMITED',
    'ADMIN_LOGIN_RATE_LIMITED',
    'ADMIN_SESSION_CREDENTIALS_MISSING',
    'ADMIN_SESSION_EXPIRED',
    'ADMIN_SESSION_INVALID',
    'ADMIN_SESSION_REQUIRED',
    'AUTH_RATE_LIMITED',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NETWORK',
    'ETIMEDOUT',
    'LICENSE_EXPIRED',
    'LICENSE_NOT_ACTIVE',
    'RATE_LIMITED',
    'SESSION_LOCAL_STORAGE_UNAVAILABLE',
    'SESSION_RATE_LIMITED',
    'SESSION_SERVER_ERROR',
    'SESSION_TRANSPORT_UNAVAILABLE',
    'SESSION_VERIFICATION_INVALID_RESPONSE',
    'SESSION_VERIFICATION_UNCLASSIFIED',
    'UND_ERR_CONNECT_TIMEOUT'
]);

const safeBootstrapDiagnosticCode = (code) => {
    const normalizedCode = String(code || '').toUpperCase();
    return SAFE_BOOTSTRAP_DIAGNOSTIC_CODES.has(normalizedCode)
        || /^SESSION_SERVER_HTTP_5\d\d$/.test(normalizedCode)
        || /^SESSION_GATEWAY_HTTP_(?:401|403)$/.test(normalizedCode)
        || /^PGRST\d{3}$/.test(normalizedCode)
        ? normalizedCode
        : null;
};

const safeBootstrapDiagnosticStatus = (status) => (
    Number.isInteger(status) && (status === 0 || (status >= 100 && status <= 599))
        ? status
        : null
);

const getAdminVerificationErrorCategory = (status) => {
    if (status === SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE) return 'transport';
    if (status === SESSION_VERIFICATION_STATUS.SERVER_ERROR) return 'server';
    if (status === SESSION_VERIFICATION_STATUS.AUTHORITATIVE_DENIAL) return 'authoritative_denial';
    if (status === SESSION_VERIFICATION_STATUS.INVALID_RESPONSE) return 'invalid_response';
    if ([
        SESSION_VERIFICATION_STATUS.LOCAL_STORAGE_ERROR,
        SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING
    ].includes(status)) return 'local_state';
    return 'unknown';
};

const logAdminVerificationGate = (result, continuityEligible) => {
    const validStatuses = Object.values(SESSION_VERIFICATION_STATUS);
    const status = validStatuses.includes(result?.verificationStatus)
        ? result.verificationStatus
        : 'unknown';
    Logger.warn('[AdminAuth]', {
        phase: 'admin_bootstrap_verification_gate',
        category: getAdminVerificationErrorCategory(status),
        status,
        code: safeBootstrapDiagnosticCode(result?.code) || 'SESSION_VERIFICATION_UNCLASSIFIED',
        httpStatus: safeBootstrapDiagnosticStatus(result?.httpStatus),
        continuityEligible: continuityEligible === true
    });
};

const logAdminOfflineAuthorization = (authorization) => {
    const knownReasons = Object.values(ADMIN_OFFLINE_AUTHORIZATION_REASON);
    Logger.warn('[AdminAuth]', {
        phase: 'admin_offline_authorization_decision',
        category: 'offline_authorization',
        status: authorization?.eligible === true ? 'eligible' : 'denied',
        code: 'ADMIN_OFFLINE_AUTHORIZATION',
        httpStatus: null,
        eligibilityReason: knownReasons.includes(authorization?.reason)
            ? authorization.reason
            : 'unknown'
    });
};

const logAdminRestorationFailure = (phase, error, eligibilityReason) => {
    const knownReasons = Object.values(ADMIN_OFFLINE_AUTHORIZATION_REASON);
    Logger.warn('[AdminAuth]', {
        phase: `admin_${phase}_failed`,
        category: phase === 'actor_runtime_restore' ? 'actor_runtime' : 'bootstrap_restoration',
        status: 'failed',
        code: safeBootstrapDiagnosticCode(error?.code) || 'ACTOR_SESSION_RESTORE_FAILED',
        httpStatus: null,
        eligibilityReason: knownReasons.includes(eligibilityReason) ? eligibilityReason : 'unknown'
    });
};

const enterDatabaseRecovery = (set, error) => {
    const classification = classifyDatabaseError(error);
    const diagnostic = error?.diagnostic || getDatabaseRecoveryState();
    coordinatorState = 'recovery_required';
    setDatabaseRecoveryState({
        ...diagnostic,
        status: diagnostic?.isRetryable === false
            ? DATABASE_RECOVERY_STATUS.FAILED
            : DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
        errorCode: diagnostic?.errorCode || classification.code,
        databaseName: diagnostic?.databaseName || 'LanzoDB1',
        isRetryable: classification.retryable !== false,
        requiresMigration: classification.requiresMigration === true || diagnostic?.requiresMigration === true,
        message: diagnostic?.message || 'La base local necesita recuperarse antes de continuar.'
    });
    set({
        appStatus: 'local_database_recovery_required',
        _isInitializing: false
    });
};

const getVerificationUnavailableMessage = (actorType, result) => {
    const actor = actorType === 'staff' ? 'Staff' : 'administrativa';
    switch (result?.verificationStatus) {
        case SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE:
            return 'No pudimos verificar tu sesión por un problema de conexión. Tus datos locales se mantienen protegidos. Puedes volver a intentarlo cuando se restablezca la conexión.';
        case SESSION_VERIFICATION_STATUS.SERVER_ERROR:
            return 'El servidor no pudo completar la verificación. Tus credenciales locales y datos se mantienen protegidos. Inténtalo de nuevo más tarde.';
        case SESSION_VERIFICATION_STATUS.LOCAL_STORAGE_ERROR:
            return 'No pudimos leer las credenciales guardadas. Tus datos locales se mantienen protegidos. Reintenta cuando el almacenamiento esté disponible.';
        default:
            return `No pudimos confirmar la sesión ${actor}. El acceso sigue protegido y tus credenciales locales se conservaron. Reintenta la verificación.`;
    }
};

const setVerificationUnavailable = (set, actorType, license, result) => {
    const isAdmin = actorType === 'admin';
    const message = result?.userMessage || getVerificationUnavailableMessage(actorType, result);
    const uiCode = result?.uiCode || 'SESSION_VERIFICATION_INCONCLUSIVE';
    set({
        appStatus: isAdmin ? 'admin_login_required' : 'staff_login_required',
        licenseDetails: license,
        currentDeviceRole: actorType,
        ...(isAdmin
            ? {
                currentAdminUser: null,
                adminLoginLicenseKey: license?.license_key || null,
                adminLoginMessage: message,
                adminLoginError: {
                    code: uiCode,
                    verificationStatus: result?.verificationStatus || SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
                    reasonCode: result?.code || null
                }
            }
            : {
                currentStaffUser: null,
                staffLoginLicenseKey: license?.license_key || null,
                staffLoginMessage: message,
                staffLoginError: {
                    code: uiCode,
                    verificationStatus: result?.verificationStatus || SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
                    reasonCode: result?.code || null
                }
            })
    });
};

const logFreeAdminAuthorityMode = (license, selectedMode) => {
    const planCode = String(license?.plan_code || license?.plan?.code || '').trim().toLowerCase();
    if (planCode !== 'free_trial') return;
    Logger.log('[AppStore] FREE_ADMIN_AUTHORITY_MODE', {
        planCode,
        deviceRole: license?.device_role || null,
        hasAdminIdentity: hasModernAdminIdentityEvidence(license),
        selectedMode
    });
};

export const getInitializeAppCoordinatorState = () => coordinatorState;

// Compare data, never a promise or a boolean authorization cache. Object key
// order is immaterial; any changed stored license field forces the normal path.
const canonicalLicense = (value) => JSON.stringify(value, (_key, entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
        : entry
));

export const createLicenseBootstrapActions = ({ set, get }) => {
    // A flight belongs to this store instance, not another tenant/store factory.
    let initializePromise = null;
    return ({
    initializeApp: (options = {}) => {
        if (initializePromise) {
            Logger.debug('[AppStore] initializeApp reutiliza la promesa en ejecución.');
            return initializePromise;
        }
        if (get()._isAdminAuthenticationInFlight?.()) {
            return Promise.resolve({ status: get().appStatus, code: 'ADMIN_AUTH_IN_PROGRESS' });
        }

        const force = options?.force === true;
        coordinatorState = 'running';
        set({ _isInitializing: true });
        Logger.log('[AppStore] Iniciando aplicación (coordinador idempotente)...');

        const runBootstrap = async () => {
            let bootstrapActorGeneration = actorRuntimeController.getState().generation;
            const assertBootstrapActorCurrent = () => {
                if (actorRuntimeController.getState().generation !== bootstrapActorGeneration) {
                    const stale = new Error('SESSION_VERIFICATION_CONTEXT_STALE');
                    stale.code = 'SESSION_VERIFICATION_CONTEXT_STALE';
                    throw stale;
                }
            };
            const restoreActorAuthority = async (actorType, actor) => {
                assertBootstrapActorCurrent();
                beginActorRuntimeAuthentication(actorType);
                bootstrapActorGeneration = actorRuntimeController.getState().generation;
                const startedAt = globalThis.performance?.now?.() ?? Date.now();
                const slowTimer = setTimeout(() => {
                    Logger.warn('[AdminAuth]', { phase: 'operation_slow', operation: 'actor_runtime_restore', durationMs: 15_000 });
                }, 15_000);
                try {
                    const restored = await restoreActorRuntimeFromCurrentSessionCache({ actorType, actor });
                    bootstrapActorGeneration = restored.generation;
                    assertBootstrapActorCurrent();
                    Logger.debug('[AdminAuth]', {
                        phase: 'actor_runtime_restore_completed',
                        status: 'granted',
                        durationMs: Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt))
                    });
                    return restored;
                } catch (error) {
                    Logger.debug('[AdminAuth]', {
                        phase: 'actor_runtime_restore_completed',
                        status: 'failed',
                        code: /^[A-Z0-9_:-]{1,80}$/i.test(String(error?.code || '')) ? error.code : null,
                        durationMs: Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt))
                    });
                    const currentActor = actorRuntimeController.getState();
                    const ownedRestoreFailure = currentActor.reason === 'ambiguous_actor_session_evidence'
                        || currentActor.reason === `${actorType}_session_restore_failed`;
                    if (currentActor.status === 'locked'
                        && currentActor.generation === bootstrapActorGeneration + 1
                        && ownedRestoreFailure) {
                        bootstrapActorGeneration = currentActor.generation;
                    }
                    throw error;
                } finally {
                    clearTimeout(slowTimer);
                }
            };
            try {
                // Recheck current authority on every invocation. No successful
                // initialization promise is retained. In particular Staff still
                // requires an online session check and Admin keeps F-02/168h.
                const initialState = get();
                let reusableHandle = null;
                if (!force && initialState.appStatus === 'ready'
                    && actorRuntimeController.getState().status === 'granted') {
                    try { reusableHandle = actorRuntimeController.capture(); } catch {
                        // A stale tenant binding cannot be reused. The normal
                        // bootstrap below prepares and verifies the new context.
                    }
                }
                if (reusableHandle) {
                    const handle = reusableHandle;
                    const actorAtStart = canonicalLicense(handle.actorType === 'admin'
                        ? initialState.currentAdminUser : initialState.currentStaffUser);
                    const licenseAtStart = canonicalLicense(initialState.licenseDetails);
                    const assertReusableContext = () => {
                        try { handle.assertCurrent(); } catch {
                            const error = new Error('SESSION_VERIFICATION_CONTEXT_STALE');
                            error.code = 'SESSION_VERIFICATION_CONTEXT_STALE';
                            throw error;
                        }
                        if (actorAtStart !== canonicalLicense(handle.actorType === 'admin'
                            ? get().currentAdminUser : get().currentStaffUser)
                            || get().appStatus !== 'ready'
                            || get().currentDeviceRole !== handle.actorType
                            || canonicalLicense(get().licenseDetails) !== licenseAtStart) {
                            const error = new Error('SESSION_VERIFICATION_CONTEXT_STALE');
                            error.code = 'SESSION_VERIFICATION_CONTEXT_STALE';
                            throw error;
                        }
                    };
                    const stored = await getLicenseFromStorage();
                    assertReusableContext();
                    if (stored?.license_key && canonicalLicense(stored) === licenseAtStart
                        && (handle.actorType === 'admin' || navigator.onLine)) {
                        let reusable = false;
                        try {
                            const actor = handle.actorType === 'admin'
                                ? initialState.currentAdminUser : initialState.currentStaffUser;
                            await assertAuthenticatedActorSessionCurrent({ handle, actorType: handle.actorType, actor });
                            assertReusableContext();
                            let verification = { valid: true };
                            if (navigator.onLine) {
                                const beforeLocalPersistence = async (source = stored) => {
                                    assertReusableContext();
                                    await assertLocalTenantAccess(source, { reason: 'bootstrap_current_session_check' });
                                    assertReusableContext();
                                };
                                verification = handle.actorType === 'admin'
                                    ? await verifyAdminSession(stored.license_key, { beforeLocalPersistence })
                                    : await runWithLocalTenantSyncLease(stored,
                                        { reason: 'bootstrap_current_staff_check' },
                                        () => verifyStaffSession(stored.license_key, { beforeLocalPersistence }));
                                assertReusableContext();
                            }
                            const verifiedActor = handle.actorType === 'admin'
                                ? verification.admin_user : verification.staff_user;
                            const detailsUnchanged = !verification.details
                                || canonicalLicense({ ...stored, ...verification.details }) === licenseAtStart;
                            reusable = verification.valid === true && detailsUnchanged
                                && (!verifiedActor || canonicalLicense(verifiedActor) === canonicalLicense(actor));
                            if (reusable) {
                                if (navigator.onLine && handle.actorType === 'admin') {
                                    // Preserve the existing positive-verification
                                    // refresh contract without creating a new epoch.
                                    await refreshAuthenticatedAdminSessionAuthorization({ handle, actor });
                                    assertReusableContext();
                                }
                                // Verification can rotate credentials or expire a
                                // binding; prove it again after its last await.
                                await assertAuthenticatedActorSessionCurrent({ handle, actorType: handle.actorType, actor });
                                assertReusableContext();
                            }
                        } catch (error) {
                            // Failed proof is never an authorization cache hit.
                            // A new generation belongs to its new owner and must
                            // not be locked by this old invocation.
                            assertBootstrapActorCurrent();
                            if (error?.code === 'SESSION_VERIFICATION_CONTEXT_STALE') throw error;
                        }
                        if (reusable) {
                            coordinatorState = 'ready';
                            return { status: 'ready' };
                        }
                    }
                }
                assertBootstrapActorCurrent();
                // App bootstrap is a new actor authority epoch. Any async work
                // captured by a previous in-memory actor must be stale before
                // stored credentials are inspected or a tenant is prepared.
                lockActorRuntime('application_bootstrap');
                bootstrapActorGeneration = actorRuntimeController.getState().generation;
                initializeLocalTenantGuard('application_bootstrap');
                const localLicense = await getLicenseFromStorage();
                assertBootstrapActorCurrent();

                if (!localLicense?.license_key) {
                    lockLocalTenantAccess('no_stored_license');
                    coordinatorState = 'ready';
                    set({ appStatus: 'unauthenticated' });
                    return { status: 'unauthenticated' };
                }

                // This is the first tenant-owned boundary. It intentionally
                // precedes actor-token reads, profile loading, catalog startup
                // and every sync coordinator.
                await assertLocalTenantAccess(localLicense, { reason: 'stored_license_bootstrap' });
                assertBootstrapActorCurrent();
                await prepareLocalDatabase({ force });
                assertBootstrapActorCurrent();

                Logger.log('[AppStore] Carga rápida activada - Usando caché local');

                const hasStoredStaffSession = await hasStaffSessionToken();
                assertBootstrapActorCurrent();
                Logger.log(`[AppStore] Sesión staff local: ${hasStoredStaffSession ? 'encontrada' : 'no encontrada'}`);
                const localDeviceRole = localLicense.device_role || null;

                if (localDeviceRole !== 'admin' && localDeviceRole !== 'staff') {
                    if (navigator.onLine && typeof get().discoverAdminAccess === 'function') {
                        set({
                            appStatus: 'loading',
                            licenseDetails: localLicense,
                            currentDeviceRole: null,
                            currentAdminUser: null,
                            currentStaffUser: null
                        });
                        await get().discoverAdminAccess(localLicense.license_key);
                        coordinatorState = 'ready';
                        return { status: get().appStatus };
                    }

                    set({
                        appStatus: 'license_access_required',
                        licenseDetails: localLicense,
                        currentDeviceRole: null,
                        currentAdminUser: null,
                        currentStaffUser: null,
                        adminLoginLicenseKey: localLicense.license_key
                    });
                    coordinatorState = 'ready';
                    return { status: 'license_access_required' };
                }

                if (localDeviceRole === 'staff') {
                    assertBootstrapActorCurrent();
                    set({
                        licenseDetails: { ...localLicense, device_role: 'staff' },
                        currentDeviceRole: 'staff',
                        currentStaffUser: null,
                        staffLoginLicenseKey: localLicense.license_key
                    });

                    if (!navigator.onLine) {
                        Logger.warn('[Staff] Sesion staff requiere verificacion online al iniciar.');
                        setVerificationUnavailable(set, 'staff', localLicense, {
                            verificationStatus: SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE,
                            code: 'ONLINE_REQUIRED'
                        });
                        coordinatorState = 'ready';
                        return { status: 'staff_login_required' };
                    }

                    const staffSession = await runWithLocalTenantSyncLease(
                        localLicense,
                        { reason: 'staff_session_restore' },
                        () => verifyStaffSession(localLicense.license_key, {
                            beforeLocalPersistence: async () => {
                                assertBootstrapActorCurrent();
                                await assertLocalTenantAccess(localLicense, { reason: 'staff_session_restore_response' });
                                assertBootstrapActorCurrent();
                            }
                        })
                    );
                    assertBootstrapActorCurrent();
                    if (!staffSession?.valid) {
                        if (isAuthoritativeSessionDenial(staffSession)) {
                            const serverCheck = await revalidateLicense(localLicense.license_key);
                            assertBootstrapActorCurrent();
                            if (isLicensePlanBlockFailure(serverCheck)) {
                                await get()._requireLicenseChange(localLicense, serverCheck);
                                coordinatorState = 'ready';
                                return { status: get().appStatus };
                            }

                            await get()._requireStaffLogin(localLicense, staffSession);
                            coordinatorState = 'ready';
                            return { status: get().appStatus };
                        }

                        if (staffSession?.verificationStatus === SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING) {
                            await get()._requireStaffLogin(localLicense, staffSession);
                        } else if (isSessionVerificationInconclusive(staffSession)) {
                            setVerificationUnavailable(set, 'staff', localLicense, staffSession);
                        } else {
                            await get()._requireStaffLogin(localLicense, {
                                ...staffSession,
                                preserveSessionCredentials: true
                            });
                        }
                        coordinatorState = 'ready';
                        return { status: 'staff_login_required' };
                    }

                    const restoredLicense = {
                        ...localLicense,
                        device_role: 'staff',
                        staff_user: staffSession.staff_user || localLicense.staff_user || null
                    };
                    assertBootstrapActorCurrent();
                    await saveLicenseToStorage(restoredLicense);
                    assertBootstrapActorCurrent();
                    set({
                        licenseDetails: restoredLicense,
                        currentDeviceRole: 'staff',
                        currentStaffUser: restoredLicense.staff_user,
                        staffLoginMessage: null,
                        staffLoginError: null
                    });

                    try {
                        await restoreActorAuthority('staff', restoredLicense.staff_user);
                    } catch (actorError) {
                        if (classifyDatabaseError(actorError).structural) throw actorError;
                        assertBootstrapActorCurrent();
                        setVerificationUnavailable(set, 'staff', restoredLicense, {
                            code: actorError?.code || 'ACTOR_SESSION_RESTORE_FAILED',
                            verificationStatus: SESSION_VERIFICATION_STATUS.VERIFIED,
                            uiCode: 'ACTOR_RUNTIME_RESTORE_FAILED',
                            userMessage: 'La sesión Staff se verificó, pero no pudimos restaurar una autoridad operativa segura. El acceso permanece bloqueado; reintenta la recuperación.'
                        });
                        coordinatorState = 'ready';
                        return { status: 'staff_login_required' };
                    }

                    assertBootstrapActorCurrent();
                    await loadBootstrapProfile(get()._loadProfile, restoredLicense.license_key, {}, options?.lifecycle, 'bootstrap_profile_nested_work');
                    assertBootstrapActorCurrent();
                    get()._validateInBackground(restoredLicense.license_key, {
                        reason: 'staff_session_restore', lifecycle: options?.lifecycle
                    });
                    coordinatorState = 'ready';
                    return { status: get().appStatus };
                }

                const needsAdminIdentity = localDeviceRole === 'admin' && requiresAdminIdentity(localLicense);
                if (needsAdminIdentity) {
                    // Persist a local cutover marker before validating the session. The marker
                    // does not grant authority; it only prevents a modern owner from falling
                    // back to legacy mode after an expired/revoked Admin session.
                    const actorBoundAdminLicense = localLicense.admin_identity_required === true
                        ? localLicense
                        : { ...localLicense, admin_identity_required: true };
                    if (actorBoundAdminLicense !== localLicense) {
                        assertBootstrapActorCurrent();
                        await saveLicenseToStorage(actorBoundAdminLicense);
                        assertBootstrapActorCurrent();
                    }
                    logFreeAdminAuthorityMode(actorBoundAdminLicense, 'actor_bound');

                    assertBootstrapActorCurrent();
                    set({
                        licenseDetails: { ...actorBoundAdminLicense, device_role: 'admin' },
                        currentDeviceRole: 'admin',
                        currentAdminUser: null,
                        adminLoginLicenseKey: actorBoundAdminLicense.license_key
                    });

                    if (!navigator.onLine) {
                        const offlineAuthorization = await getAdminOfflineAuthorization({
                            license: actorBoundAdminLicense,
                            adminUser: actorBoundAdminLicense.admin_user || null
                        });
                        assertBootstrapActorCurrent();
                        if (offlineAuthorization.eligible) {
                            const offlineAdmin = actorBoundAdminLicense.admin_user || null;
                            try {
                                await restoreActorAuthority('admin', offlineAdmin);
                                assertBootstrapActorCurrent();
                                set({ currentAdminUser: offlineAdmin });
                                options?.lifecycle?.markUnobservable('bootstrap_offline_preparation_nested_work');
                                await (options?.lifecycle
                                    ? get()._processOfflineMode(actorBoundAdminLicense, { lifecycle: options.lifecycle })
                                    : get()._processOfflineMode(actorBoundAdminLicense));
                                assertBootstrapActorCurrent();
                                if (!['ready', 'setup_required', 'unauthenticated'].includes(get().appStatus)) {
                                    await get()._completeRestoredAdminPreparation?.(actorBoundAdminLicense.license_key, { lifecycle: options?.lifecycle });
                                    assertBootstrapActorCurrent();
                                }
                            } catch (actorError) {
                                if (classifyDatabaseError(actorError).structural) throw actorError;
                                assertBootstrapActorCurrent();
                                setVerificationUnavailable(set, 'admin', actorBoundAdminLicense, {
                                    code: actorError?.code || 'ACTOR_SESSION_RESTORE_FAILED',
                                    verificationStatus: SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
                                    uiCode: 'ACTOR_RUNTIME_RESTORE_FAILED',
                                    userMessage: 'La evidencia local no permitió restaurar una autoridad administrativa segura. El acceso permanece bloqueado; conéctate y reintenta la verificación.'
                                });
                            }
                        } else {
                            setVerificationUnavailable(set, 'admin', actorBoundAdminLicense, {
                                verificationStatus: SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE,
                                code: offlineAuthorization.reason,
                                uiCode: 'SESSION_VERIFICATION_INCONCLUSIVE',
                                userMessage: getAdminOfflineAuthorizationUserMessage(offlineAuthorization)
                            });
                        }
                        coordinatorState = 'ready';
                        return { status: get().appStatus };
                    }

                    const adminSession = await verifyAdminSession(actorBoundAdminLicense.license_key, {
                        beforeLocalPersistence: async (tenantSource) => {
                            assertBootstrapActorCurrent();
                            await assertLocalTenantAccess(
                                tenantSource,
                                { reason: 'admin_session_restore_before_local_persistence' }
                            );
                            assertBootstrapActorCurrent();
                        }
                    });
                    assertBootstrapActorCurrent();
                    if (!adminSession.valid) {
                        const continuityEligible = isSafeAdminOfflineVerificationFailure(adminSession);
                        logAdminVerificationGate(adminSession, continuityEligible);

                        if (isAuthoritativeSessionDenial(adminSession)) {
                            await get()._requireAdminLogin(actorBoundAdminLicense, adminSession);
                            coordinatorState = 'ready';
                            return { status: get().appStatus };
                        }

                        if (continuityEligible) {
                            const offlineAuthorization = await getAdminOfflineAuthorization({
                                license: actorBoundAdminLicense,
                                adminUser: actorBoundAdminLicense.admin_user || null,
                                verificationResult: adminSession
                            });
                            assertBootstrapActorCurrent();
                            logAdminOfflineAuthorization(offlineAuthorization);
                            if (offlineAuthorization.eligible) {
                                const offlineAdmin = actorBoundAdminLicense.admin_user || null;
                                let restorationPhase = 'actor_runtime_restore';
                                try {
                                    await restoreActorAuthority('admin', offlineAdmin);
                                    assertBootstrapActorCurrent();
                                    set({ currentAdminUser: offlineAdmin });
                                    restorationPhase = 'offline_mode_processing';
                                    options?.lifecycle?.markUnobservable('bootstrap_offline_preparation_nested_work');
                                await (options?.lifecycle
                                    ? get()._processOfflineMode(actorBoundAdminLicense, { lifecycle: options.lifecycle })
                                    : get()._processOfflineMode(actorBoundAdminLicense));
                                    assertBootstrapActorCurrent();
                                    if (!['ready', 'setup_required', 'unauthenticated'].includes(get().appStatus)) {
                                        restorationPhase = 'restored_admin_preparation';
                                        await get()._completeRestoredAdminPreparation?.(actorBoundAdminLicense.license_key, { lifecycle: options?.lifecycle });
                                        assertBootstrapActorCurrent();
                                    }
                                    coordinatorState = 'ready';
                                    return { status: get().appStatus };
                                } catch (actorError) {
                                    if (classifyDatabaseError(actorError).structural) throw actorError;
                                    assertBootstrapActorCurrent();
                                    logAdminRestorationFailure(restorationPhase, actorError, offlineAuthorization.reason);
                                    setVerificationUnavailable(set, 'admin', actorBoundAdminLicense, {
                                        code: actorError?.code || 'ACTOR_SESSION_RESTORE_FAILED',
                                        verificationStatus: SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
                                        uiCode: 'ACTOR_RUNTIME_RESTORE_FAILED',
                                        userMessage: 'La evidencia local no permitió restaurar una autoridad administrativa segura. El acceso permanece bloqueado; reintenta la verificación.'
                                    });
                                    coordinatorState = 'ready';
                                    return { status: get().appStatus };
                                }
                            }
                            setVerificationUnavailable(set, 'admin', actorBoundAdminLicense, {
                                ...adminSession,
                                code: offlineAuthorization.reason,
                                uiCode: 'SESSION_VERIFICATION_INCONCLUSIVE',
                                userMessage: getAdminOfflineAuthorizationUserMessage(offlineAuthorization)
                            });
                            coordinatorState = 'ready';
                            return { status: get().appStatus };
                        }

                        if (adminSession?.verificationStatus === SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING
                            && adminSession.missingCredentials?.includes('admin_session_token')) {
                            assertBootstrapActorCurrent();
                            await get().discoverAdminAccess(actorBoundAdminLicense.license_key);
                            coordinatorState = 'ready';
                            return { status: get().appStatus };
                        }

                        if (adminSession?.verificationStatus === SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING) {
                            await get()._requireAdminLogin(actorBoundAdminLicense, {
                                ...adminSession,
                                preserveSessionCredentials: true
                            });
                            coordinatorState = 'ready';
                            return { status: get().appStatus };
                        }

                        if (isSessionVerificationInconclusive(adminSession)) {
                            setVerificationUnavailable(set, 'admin', actorBoundAdminLicense, adminSession);
                        } else {
                            setVerificationUnavailable(set, 'admin', actorBoundAdminLicense, {
                                ...adminSession,
                                verificationStatus: SESSION_VERIFICATION_STATUS.INVALID_RESPONSE
                            });
                        }
                        coordinatorState = 'ready';
                        return { status: 'admin_login_required' };
                    }

                    const restoredLicense = {
                        ...actorBoundAdminLicense,
                        ...adminSession.details,
                        device_role: 'admin',
                        staff_user: null,
                        admin_identity_required: true,
                        admin_user: adminSession.admin_user || actorBoundAdminLicense.admin_user || null
                    };
                    assertBootstrapActorCurrent();
                    await saveLicenseToStorage(restoredLicense);
                    assertBootstrapActorCurrent();
                    set({
                        licenseDetails: restoredLicense,
                        currentDeviceRole: 'admin',
                        currentAdminUser: restoredLicense.admin_user,
                        adminLoginMessage: null,
                        adminLoginError: null
                    });

                    try {
                        await restoreActorAuthority('admin', restoredLicense.admin_user);
                    } catch (actorError) {
                        if (classifyDatabaseError(actorError).structural) throw actorError;
                        assertBootstrapActorCurrent();
                        setVerificationUnavailable(set, 'admin', restoredLicense, {
                            code: actorError?.code || 'ACTOR_SESSION_RESTORE_FAILED',
                            verificationStatus: SESSION_VERIFICATION_STATUS.VERIFIED,
                            uiCode: 'ACTOR_RUNTIME_RESTORE_FAILED',
                            userMessage: 'La sesión se verificó, pero no pudimos restaurar una autoridad operativa segura. El acceso permanece bloqueado; reintenta la recuperación.'
                        });
                        coordinatorState = 'ready';
                        return { status: 'admin_login_required' };
                    }

                    if (get()._completeRestoredAdminPreparation) {
                        await get()._completeRestoredAdminPreparation(restoredLicense.license_key, { lifecycle: options?.lifecycle });
                        assertBootstrapActorCurrent();
                    } else {
                        await loadBootstrapProfile(get()._loadProfile, restoredLicense.license_key, {}, options?.lifecycle, 'bootstrap_profile_nested_work');
                        assertBootstrapActorCurrent();
                        get()._validateInBackground(restoredLicense.license_key, {
                            reason: 'admin_session_restore', lifecycle: options?.lifecycle
                        });
                    }
                    coordinatorState = 'ready';
                    return { status: get().appStatus };
                }

                // Legacy/FREE admin compatibility has no stable authenticated
                // admin-user session proof. Keep ActorRuntime LOCKED rather
                // than manufacturing authority from a device identity.
                logFreeAdminAuthorityMode(localLicense, 'legacy_local_owner');
                assertBootstrapActorCurrent();
                options?.lifecycle?.markUnobservable('bootstrap_offline_preparation_nested_work');
                await (options?.lifecycle
                                    ? get()._processOfflineMode(localLicense, { lifecycle: options.lifecycle })
                                    : get()._processOfflineMode(localLicense));
                assertBootstrapActorCurrent();
                if (navigator.onLine) {
                    get()._validateInBackground(localLicense.license_key, {
                        reason: 'admin_legacy_restore', lifecycle: options?.lifecycle
                    });
                } else {
                    Logger.log('[AppStore] Sin red al iniciar, se mantiene cache local.');
                }
                coordinatorState = 'ready';
                return { status: get().appStatus };
            } catch (criticalError) {
                if (criticalError?.code === 'SESSION_VERIFICATION_CONTEXT_STALE'
                    || (bootstrapActorGeneration !== null
                        && actorRuntimeController.getState().generation !== bootstrapActorGeneration)) {
                    coordinatorState = 'ready';
                    return {
                        status: get().appStatus,
                        code: 'BOOTSTRAP_CONTEXT_STALE'
                    };
                }
                lockActorRuntime('application_bootstrap_failed');
                if (isLocalTenantAccessError(criticalError)) {
                    coordinatorState = 'tenant_blocked';
                    enterLocalTenantIsolationFailure(set, criticalError);
                    return {
                        status: 'local_tenant_mismatch',
                        code: criticalError.code
                    };
                }

                const classification = classifyDatabaseError(criticalError);
                if (classification.structural) {
                    Logger.warn('[AppStore] Bootstrap pausado por recuperación local.', {
                        code: classification.code
                    });
                    enterDatabaseRecovery(set, criticalError);
                    return { status: 'local_database_recovery_required', code: classification.code };
                }

                coordinatorState = 'failed';
                Logger.error('Error crítico inicializando:', criticalError);
                set({ appStatus: 'unauthenticated' });
                return {
                    status: 'failed',
                    error: criticalError?.message || 'Error de inicialización'
                };
            } finally {
                if (coordinatorState === 'running') coordinatorState = 'ready';
            }
        };
        try {
            initializePromise = options?.lifecycle
                ? options?.lifecycle.track(runBootstrap)
                : runBootstrap();
        } catch (error) {
            set({ _isInitializing: false });
            coordinatorState = 'failed';
            return Promise.reject(error);
        }
        // Also clear a flight rejected before its factory could start.
        initializePromise = initializePromise.finally(() => {
            initializePromise = null;
            set({ _isInitializing: false });
        });

        return initializePromise;
    }
});
};
