// src/store/slices/license/licenseIntegrityActions.js

import Logger from '../../../services/Logger';
import { revalidateLicense } from '../../../services/supabase';
import { saveLicenseToStorage } from '../../../services/licenseStorage';
import {
    LICENSE_REMOTE_VALIDATION_COOLDOWN_MS,
    RENEWAL_REASONS
} from './licenseConstants';
import {
    assertLocalTransactionAllowed,
    isCriticalLicenseValidationReason,
    normalizeValidationCode,
    isFatalValidationFailure,
    isRecoverableValidationFailure,
    isStaffLoginRequiredFailure,
    isStaffDeviceAuthorizationFailure,
    isLicensePlanBlockFailure,
    deriveGracePeriodEnd
} from './licenseGuards';
import {
    LAST_REMOTE_LICENSE_KEY,
    LAST_REMOTE_LICENSE_VALIDATION_KEY,
    markLastLicenseValidationAttempt,
    markLastLicenseValidationSuccess
} from './licenseValidationTimestamps';
import { isLocalTenantAccessError } from '../../../services/tenant/localTenantGuard';

const normalizeOptions = (options = {}) => {
    if (typeof options === 'string') {
        return { reason: options };
    }

    return options || {};
};

const shouldSkipRemoteValidationByCooldown = ({ forceRemote, reason, licenseKey }) => {
    if (forceRemote || isCriticalLicenseValidationReason(reason)) return false;

    try {
        const lastLicenseKey = sessionStorage.getItem(LAST_REMOTE_LICENSE_KEY);
        const lastRemote = Number(sessionStorage.getItem(LAST_REMOTE_LICENSE_VALIDATION_KEY) || 0);

        return (
            lastLicenseKey === licenseKey &&
            Number.isFinite(lastRemote) &&
            lastRemote > 0 &&
            Date.now() - lastRemote < LICENSE_REMOTE_VALIDATION_COOLDOWN_MS
        );
    } catch {
        return false;
    }
};

const shouldRefreshProfileAfterValidation = ({ refreshProfile, state, previousDetails, updatedDetails }) => {
    if (!updatedDetails?.valid) return false;
    if (refreshProfile) return true;
    if (!state.companyProfile) return true;
    if (state.companyProfile?.license_key !== updatedDetails.license_key) return true;
    if (previousDetails?.license_key !== updatedDetails.license_key) return true;

    return false;
};

const buildIntegrityFailure = ({ code, message, source, reason }) => ({
    code: code || 'SESSION_INVALID',
    message: message || 'No se pudo validar la sesión para completar la venta.',
    source: source || 'integrity',
    reason: reason || null,
    occurredAt: new Date().toISOString()
});

export const createLicenseIntegrityActions = ({
    set,
    get,
    hasStaffValidationContext
}) => ({
    verifySessionIntegrity: async (options = {}) => {
        const {
            reason = 'manual',
            forceRemote = false,
            refreshProfile = false,
            transactionMode = false,
            allowLocalOnly = true
        } = normalizeOptions(options);

        const state = get();
        const { licenseDetails, logout } = state;

        const failIntegrity = (failure = {}, source = 'integrity') => {
            const normalized = buildIntegrityFailure({
                code: failure.code || failure.reason || failure.status,
                message: failure.message || failure.details,
                source,
                reason
            });
            set({ lastIntegrityFailure: normalized });
            return false;
        };

        set({ lastIntegrityFailure: null });

        if (!licenseDetails?.license_key) {
            return failIntegrity({
                code: 'LICENSE_MISSING',
                message: 'No hay una licencia activa para cobrar.'
            }, 'local');
        }

        const localCheck = assertLocalTransactionAllowed(licenseDetails, state);
        const isOnline = navigator.onLine;
        const isExplicitExpiryTransitionRetry = (
            state.appStatus === 'locked_renewal' &&
            reason === 'license_expiry_transition_retry'
        );
        const shouldResolveLifecycleRemotely = (
            localCheck.requiresRemoteResolution === true ||
            isExplicitExpiryTransitionRetry
        ) && isOnline;

        if (!localCheck.ok && !shouldResolveLifecycleRemotely) {
            Logger.warn(`[Integrity] Validación local bloqueó operación (${reason}):`, localCheck.code);
            return failIntegrity(localCheck, 'local');
        }

        if (localCheck.requiresRemoteResolution) {
            Logger.warn('[Integrity] Local lifecycle stale; requesting canonical entitlement.');

            if (!isOnline) {
                if (localCheck.ok && allowLocalOnly) {
                    await get()._processOfflineMode(licenseDetails, {
                        refreshProfile: false,
                        reason: `integrity_offline_grace_${reason}`
                    });
                    Logger.log('[Integrity] Transaction allowed during grace period.');
                    return true;
                }

                return failIntegrity(localCheck, 'local');
            }
        }

        if (transactionMode && allowLocalOnly && !forceRemote && !shouldResolveLifecycleRemotely) {
            Logger.log(`[Integrity] Validación local de transacción aprobada (${reason}).`);
            return true;
        }

        if (!isOnline) {
            if (allowLocalOnly) {
                Logger.warn(`[Integrity] Sin conexión; usando validación local (${reason}).`);
                return true;
            }
            return failIntegrity({
                code: 'OFFLINE_PRECHECK',
                message: 'No hay conexión para validar la sesión en este momento.'
            }, 'network');
        }

        if (shouldSkipRemoteValidationByCooldown({
            forceRemote: forceRemote || shouldResolveLifecycleRemotely,
            reason,
            licenseKey: licenseDetails.license_key
        })) {
            Logger.log(`[Integrity] Revalidación remota omitida por cooldown (${reason}).`);
            return true;
        }

        try {
            Logger.log(`[Integrity] Verificando sesión con servidor (${reason}).`);
            markLastLicenseValidationAttempt(licenseDetails.license_key);

            const serverCheck = await revalidateLicense(licenseDetails.license_key);

            if (
                get().appStatus !== state.appStatus ||
                get().licenseDetails?.license_key !== licenseDetails.license_key
            ) {
                Logger.log('[Integrity] La sesión cambió durante la validación; se descarta la respuesta.');
                return failIntegrity({
                    code: 'SESSION_CHANGED',
                    message: 'La sesión cambió durante la validación. Intenta cobrar nuevamente.'
                }, 'runtime');
            }

            if (!serverCheck?.valid && serverCheck?.valid !== false) {
                Logger.warn('[Integrity] Respuesta inválida del servidor; no se marca validación exitosa.');
                return failIntegrity({
                    code: 'VALIDATION_RESPONSE_INVALID',
                    message: 'El servidor no pudo confirmar el estado de la licencia.'
                }, 'server');
            }

            markLastLicenseValidationSuccess(licenseDetails.license_key);

            if (isLicensePlanBlockFailure(serverCheck)) {
                await get()._requireLicenseChange(licenseDetails, serverCheck);
                return failIntegrity({
                    ...serverCheck,
                    code: serverCheck.block_reason || serverCheck.reason || 'LICENSE_PLAN_BLOCKED'
                }, 'server');
            }

            if (
                isStaffLoginRequiredFailure(serverCheck) ||
                (
                    isStaffDeviceAuthorizationFailure(serverCheck) &&
                    await hasStaffValidationContext(get(), licenseDetails)
                )
            ) {
                await get()._requireStaffLogin(licenseDetails, serverCheck);
                return failIntegrity({
                    ...serverCheck,
                    code: normalizeValidationCode(serverCheck) || 'STAFF_LOGIN_REQUIRED',
                    message: serverCheck.message || serverCheck.details || 'Inicia sesión staff para cobrar.'
                }, 'staff');
            }

            const now = new Date();
            const derivedGracePeriodEnd = deriveGracePeriodEnd(serverCheck, licenseDetails);
            const graceEnd = derivedGracePeriodEnd ? new Date(derivedGracePeriodEnd) : null;
            const isWithinGracePeriod = graceEnd && graceEnd > now;
            const isTechnicallyValid = serverCheck.valid || isWithinGracePeriod;

            if (serverCheck.legal_status?.has_updated_terms) {
                Logger.log('Nuevos términos detectados durante el uso.');
                set({ pendingTermsUpdate: serverCheck.legal_status });
            } else {
                set({ pendingTermsUpdate: null });
            }

            if (!isTechnicallyValid && serverCheck.reason !== 'offline_grace') {
                if (RENEWAL_REASONS.includes(serverCheck.reason)) {
                    Logger.log('[Integrity] Licencia expirada. Activando pantalla de renovación.');

                    const expiredDetails = {
                        ...licenseDetails,
                        ...serverCheck,
                        valid: false,
                        status: 'expired'
                    };

                    set({
                        appStatus: 'locked_renewal',
                        licenseStatus: 'expired',
                        licenseDetails: expiredDetails,
                        gracePeriodEnds: null
                    });

                    await saveLicenseToStorage(expiredDetails);
                    return failIntegrity({
                        code: 'LICENSE_EXPIRED',
                        message: 'Tu período de gracia terminó. Lanzo está confirmando la transición a tu plan Local; revisa Licencia para continuar.'
                    }, 'server');
                }

                if (isRecoverableValidationFailure(serverCheck)) {
                    const validationReason = normalizeValidationCode(serverCheck);
                    Logger.warn('[Integrity] Validación recuperable; manteniendo sesión local:', validationReason);

                    await get()._processOfflineMode(licenseDetails, {
                        refreshProfile: false,
                        reason: `integrity_recoverable_${reason}`
                    });

                    set({
                        serverHealth: 'degraded',
                        serverMessage: 'No se pudo completar la validación segura del dispositivo. La sesión local se conserva mientras se recupera la conexión.'
                    });

                    if (localCheck.ok && transactionMode && allowLocalOnly) {
                        Logger.warn('[Integrity] Validación remota recuperable; operación permitida por el contrato local vigente.');
                        return true;
                    }

                    return failIntegrity({
                        code: normalizeValidationCode(serverCheck) || 'VALIDATION_UNAVAILABLE',
                        message: serverCheck.message || 'No se pudo completar la validación segura del dispositivo.'
                    }, 'network');
                }

                if (isFatalValidationFailure(serverCheck)) {
                    Logger.warn('[Integrity] Fallo fatal de seguridad:', serverCheck.reason);
                    await logout();
                    return failIntegrity({
                        code: normalizeValidationCode(serverCheck) || 'LICENSE_BLOCKED',
                        message: serverCheck.message || 'La licencia o el dispositivo fueron bloqueados por seguridad.'
                    }, 'security');
                }

                Logger.warn('[Integrity] Respuesta no concluyente del servidor; manteniendo sesión local:', serverCheck.reason || serverCheck.status || serverCheck.error);

                await get()._processOfflineMode(licenseDetails, {
                    refreshProfile: false,
                    reason: `integrity_inconclusive_${reason}`
                });

                return failIntegrity({
                    code: normalizeValidationCode(serverCheck) || 'VALIDATION_INCONCLUSIVE',
                    message: serverCheck.message || 'No se pudo confirmar el estado de la licencia.'
                }, 'server');
            }

            let newStatus = serverCheck.status || serverCheck.reason || 'active';
            if (serverCheck.status === 'grace_period' || isWithinGracePeriod) {
                newStatus = 'grace_period';
            }

            const updatedDetails = {
                ...licenseDetails,
                ...serverCheck,
                grace_period_ends: derivedGracePeriodEnd,
                status: newStatus,
                valid: isTechnicallyValid
            };

            const hasChanges =
                JSON.stringify(licenseDetails.valid) !== JSON.stringify(updatedDetails.valid) ||
                licenseDetails.status !== updatedDetails.status ||
                licenseDetails.expires_at !== updatedDetails.expires_at ||
                licenseDetails.grace_period_ends !== updatedDetails.grace_period_ends ||
                licenseDetails.realtime_topic !== updatedDetails.realtime_topic ||
                licenseDetails.max_devices !== updatedDetails.max_devices ||
                licenseDetails.plan_code !== updatedDetails.plan_code ||
                licenseDetails.plan_name !== updatedDetails.plan_name ||
                licenseDetails.product_name !== updatedDetails.product_name ||
                licenseDetails.device_role !== updatedDetails.device_role ||
                JSON.stringify(licenseDetails.staff_user || null) !== JSON.stringify(updatedDetails.staff_user || null) ||
                JSON.stringify(licenseDetails.features || {}) !== JSON.stringify(updatedDetails.features || {});

            if (hasChanges) {
                Logger.log(`[Integrity] Sesión actualizada. Estado: ${newStatus}`);

                set({
                    licenseStatus: newStatus,
                    gracePeriodEnds: derivedGracePeriodEnd,
                    licenseDetails: updatedDetails,
                    currentDeviceRole: updatedDetails.device_role || 'admin',
                    currentStaffUser: updatedDetails.device_role === 'staff'
                        ? updatedDetails.staff_user || null
                        : null
                });

                await saveLicenseToStorage(updatedDetails);
            }

            if (newStatus === 'grace_period') {
                Logger.log('[Integrity] License refreshed to grace_period.');
                Logger.log('[Integrity] Transaction allowed during grace period.');
            }

            if (shouldRefreshProfileAfterValidation({
                refreshProfile,
                state,
                previousDetails: licenseDetails,
                updatedDetails
            })) {
                await get()._loadProfile(updatedDetails.license_key, {
                    refreshProfile,
                    reason: `integrity_${reason}`
                });
            }

            await get().refreshLicenseSyncMode('integrity');

            if (state.appStatus === 'locked_renewal' && isTechnicallyValid) {
                set({ appStatus: 'ready' });
            }

            set({ lastIntegrityFailure: null });
        } catch (error) {
            markLastLicenseValidationAttempt(licenseDetails.license_key);
            if (isLocalTenantAccessError(error)) {
                return failIntegrity({
                    code: 'TENANT_MISMATCH',
                    message: 'La sesión local no corresponde a la licencia activa.'
                }, 'security');
            }
            Logger.warn('Verificación de integridad falló (red/server), manteniendo sesión:', error);

            if (localCheck.ok && allowLocalOnly) {
                if (localCheck.requiresRemoteResolution) {
                    await get()._processOfflineMode(licenseDetails, {
                        refreshProfile: false,
                        reason: `integrity_network_fallback_${reason}`
                    });
                }
                set({
                    lastIntegrityFailure: null,
                    serverHealth: 'degraded',
                    serverMessage: 'No se pudo confirmar el estado remoto; se conserva la operación local vigente.'
                });
                return true;
            }

            return failIntegrity({
                code: error?.message || 'NETWORK_ERROR',
                message: 'No se pudo validar la sesión por un problema de conexión. Intenta nuevamente.'
            }, 'network');
        }

        return true;
    }
});
