// src/store/slices/license/licenseIntegrityActions.js

import Logger from '../../../services/Logger';

import {
    revalidateLicense
} from '../../../services/supabase';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    RENEWAL_REASONS
} from './licenseConstants';

import {
    normalizeValidationCode,
    isFatalValidationFailure,
    isRecoverableValidationFailure,
    isStaffLoginRequiredFailure,
    isStaffDeviceAuthorizationFailure,
    isLicensePlanBlockFailure,
    deriveGracePeriodEnd
} from './licenseGuards';

export const createLicenseIntegrityActions = ({
    set,
    get,
    hasStaffValidationContext
}) => ({
    verifySessionIntegrity: async () => {
        const { licenseDetails, logout } = get();

        if (!licenseDetails?.license_key) return false;

        if (navigator.onLine) {
            try {
                Logger.log('Verificando integridad de sesión con servidor...');

                const serverCheck = await revalidateLicense(licenseDetails.license_key);

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

                // Usa 'has_updated_terms' (con 'd') — igual que _processServerValidation.
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
                        const reason = normalizeValidationCode(serverCheck);

                        Logger.warn(
                            '[Integrity] Validación recuperable; manteniendo sesión local:',
                            reason
                        );

                        await get()._processOfflineMode(licenseDetails);

                        set({
                            serverHealth: 'degraded',
                            serverMessage:
                                'No se pudo completar la validación segura del dispositivo. ' +
                                'La sesión local se conserva mientras se recupera el almacenamiento o la conexión.'
                        });

                        return false;
                    }

                    if (isFatalValidationFailure(serverCheck)) {
                        Logger.warn('[Integrity] Fallo fatal de seguridad:', serverCheck.reason);
                        await logout();
                        return false;
                    }

                    Logger.warn(
                        '[Integrity] Respuesta no concluyente del servidor; manteniendo sesión local:',
                        serverCheck.reason || serverCheck.status || serverCheck.error
                    );

                    await get()._processOfflineMode(licenseDetails);

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
                    JSON.stringify(licenseDetails.staff_user || null) !==
                    JSON.stringify(updatedDetails.staff_user || null) ||
                    JSON.stringify(licenseDetails.features || {}) !==
                    JSON.stringify(updatedDetails.features || {});

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

                if (updatedDetails.valid) {
                    await get()._loadProfile(licenseDetails.license_key);
                    await get().refreshLicenseSyncMode('integrity');
                }
            } catch (error) {
                Logger.warn(
                    'Verificación de integridad falló (error red/server), manteniendo sesión:',
                    error
                );
            }
        }

        return true;
    }
});