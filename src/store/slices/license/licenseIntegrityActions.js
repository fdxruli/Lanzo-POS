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

        if (!licenseDetails?.license_key) return false;

        const localCheck = assertLocalTransactionAllowed(licenseDetails, state);

        if (!localCheck.ok) {
            Logger.warn(`[Integrity] Validación local bloqueó operación (${reason}):`, localCheck.code);
            return false;
        }

        if (transactionMode && allowLocalOnly && !forceRemote) {
            Logger.log(`[Integrity] Validación local de transacción aprobada (${reason}).`);
            return true;
        }

        if (!navigator.onLine) {
            if (allowLocalOnly) {
                Logger.warn(`[Integrity] Sin conexión; usando validación local (${reason}).`);
                return true;
            }
            return false;
        }

        if (shouldSkipRemoteValidationByCooldown({
            forceRemote,
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

            if (!serverCheck?.valid && serverCheck?.valid !== false) {
                Logger.warn('[Integrity] Respuesta inválida del servidor; no se marca validación exitosa.');
                return false;
            }

            markLastLicenseValidationSuccess(licenseDetails.license_key);

            if (isLicensePlanBlockFailure(serverCheck)) {
                await get()._requireLicenseChange(licenseDetails, serverCheck);
                return false;
            }

            if (
                isStaffLoginRequiredFailure(serverCheck) ||
                (
                    isStaffDeviceAuthorizationFailure(serverCheck) &&
                    await hasStaffValidationContext(get(), licenseDetails)
                )
            ) {
                await get()._requireStaffLogin(licenseDetails, serverCheck);
                return false;
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
                    return false;
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

                    return false;
                }

                if (isFatalValidationFailure(serverCheck)) {
                    Logger.warn('[Integrity] Fallo fatal de seguridad:', serverCheck.reason);
                    await logout();
                    return false;
                }

                Logger.warn('[Integrity] Respuesta no concluyente del servidor; manteniendo sesión local:', serverCheck.reason || serverCheck.status || serverCheck.error);

                await get()._processOfflineMode(licenseDetails, {
                    refreshProfile: false,
                    reason: `integrity_inconclusive_${reason}`
                });

                return false;
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
        } catch (error) {
            markLastLicenseValidationAttempt(licenseDetails.license_key);
            Logger.warn('Verificación de integridad falló (red/server), manteniendo sesión:', error);
        }

        return true;
    }
});
