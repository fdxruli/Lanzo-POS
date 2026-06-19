// src/store/slices/license/licenseProcessingActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    GRACE_PERIOD_DAYS,
    RENEWAL_REASONS
} from './licenseConstants';

import {
    normalizeValidationCode,
    isFatalValidationFailure,
    isStaffLoginRequiredFailure,
    isStaffDeviceAuthorizationFailure,
    isLicensePlanBlockFailure,
    deriveGracePeriodEnd
} from './licenseGuards';

export const createLicenseProcessingActions = ({
    set,
    get,
    clearLocalLicenseSession,
    hasStaffValidationContext
}) => ({
    _processServerValidation: async (serverValidation, localLicense) => {
        const now = new Date();
        const derivedGracePeriodEnd = deriveGracePeriodEnd(serverValidation, localLicense);
        const graceEnd = derivedGracePeriodEnd ? new Date(derivedGracePeriodEnd) : null;

        if (isLicensePlanBlockFailure(serverValidation)) {
            await get()._requireLicenseChange(localLicense, serverValidation);
            return;
        }

        const isWithinGracePeriod = graceEnd && graceEnd > now;

        if (
            !serverValidation.valid &&
            serverValidation.reason !== 'offline_grace' &&
            !isWithinGracePeriod
        ) {
            if (
                isStaffLoginRequiredFailure(serverValidation) ||
                (
                    isStaffDeviceAuthorizationFailure(serverValidation) &&
                    await hasStaffValidationContext(get(), localLicense)
                )
            ) {
                await get()._requireStaffLogin(localLicense, serverValidation);
                return;
            }

            if (isFatalValidationFailure(serverValidation)) {
                Logger.warn('[AppStore] Licencia revocada fatalmente:', serverValidation.reason);

                await clearLocalLicenseSession();

                set({
                    appStatus: 'unauthenticated',
                    licenseDetails: null,
                    licenseStatus: normalizeValidationCode(serverValidation) || 'invalid',
                    companyProfile: null,
                    profileImportCandidate: null,
                    pendingTermsUpdate: null
                });

                return;
            }

            if (RENEWAL_REASONS.includes(serverValidation.reason)) {
                Logger.warn('[AppStore] Licencia expirada. Bloqueando pantalla...');

                await get()._loadProfile(localLicense.license_key);

                set({
                    appStatus: 'locked_renewal',
                    licenseStatus: 'expired',
                    licenseDetails: {
                        ...localLicense,
                        valid: false,
                        status: 'expired'
                    }
                });

                return;
            }

            Logger.warn(
                '[AppStore] Validación fallida (posible error post-update). Manteniendo sesión local.'
            );

            await get()._processOfflineMode(localLicense);
            return;
        }

        let finalStatus = serverValidation.status || serverValidation.reason || 'active';

        if (serverValidation.status === 'grace_period' || isWithinGracePeriod) {
            finalStatus = 'grace_period';
            Logger.log('[AppStore] Licencia en PERÍODO DE GRACIA');
        }

        // CORRECCIÓN 3: Unificado el nombre del campo a 'has_updated_terms' (con 'd').
        // En el monolito original, _processServerValidation usaba 'has_update_terms' (sin 'd')
        // mientras que verifySessionIntegrity usaba 'has_updated_terms' (con 'd').
        // Uno de los dos siempre fallaba silenciosamente. Se elige 'has_updated_terms' como canónico.
        if (serverValidation.legal_status?.has_updated_terms) {
            Logger.log('Términos actualizados detectados:', serverValidation.legal_status);
            set({ pendingTermsUpdate: serverValidation.legal_status });
        } else {
            set({ pendingTermsUpdate: null });
        }

        const finalLicenseData = {
            ...localLicense,
            ...serverValidation,
            valid: true,
            status: finalStatus,
            grace_period_ends: derivedGracePeriodEnd,
            localExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };

        await saveLicenseToStorage(finalLicenseData);

        set({
            licenseDetails: finalLicenseData,
            licenseStatus: finalStatus,
            gracePeriodEnds: derivedGracePeriodEnd,
            currentDeviceRole: finalLicenseData.device_role || 'admin',
            currentStaffUser: finalLicenseData.device_role === 'staff'
                ? finalLicenseData.staff_user || null
                : null
        });

        await get()._loadProfile(finalLicenseData.license_key);
        await get().refreshLicenseSyncMode('server_validation');
    },

    _processOfflineMode: async (localLicense) => {
        const now = new Date();

        if (!localLicense.localExpiry) {
            Logger.log('[AppStore] localExpiry faltante, generando basado en activación...');

            const baseDate = localLicense.activated_at
                ? new Date(localLicense.activated_at)
                : now;

            const expiryDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
            localLicense.localExpiry = expiryDate.toISOString();

            await saveLicenseToStorage(localLicense);
        }

        const localExpiryTime = new Date(localLicense.localExpiry).getTime();
        const nowTime = now.getTime();

        if (localExpiryTime <= nowTime) {
            console.warn('[AppStore] Caché local expirado (30 días sin conexión)');
            console.warn(`Fecha de expiración: ${localLicense.localExpiry}`);
            console.warn(`Fecha actual: ${now.toISOString()}`);

            await clearLocalLicenseSession();

            set({ appStatus: 'unauthenticated' });
            return;
        }

        const daysRemaining = Math.floor((localExpiryTime - nowTime) / (1000 * 60 * 60 * 24));

        Logger.log(`[AppStore] Modo offline válido. Días restantes: ${daysRemaining}`);

        let localStatus = localLicense.status || 'active';

        const expiryDate = localLicense.expires_at
            ? new Date(localLicense.expires_at).getTime()
            : null;

        const derivedGracePeriodEnd =
            localLicense.grace_period_ends ||
            (expiryDate
                ? new Date(
                    expiryDate + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
                ).toISOString()
                : null);

        const graceDate = derivedGracePeriodEnd
            ? new Date(derivedGracePeriodEnd).getTime()
            : null;

        if (expiryDate && expiryDate < nowTime) {
            if (graceDate && graceDate > nowTime) {
                localStatus = 'grace_period';
                Logger.log('[AppStore] Licencia en PERÍODO DE GRACIA (offline)');
            } else {
                console.warn('[AppStore] Licencia expirada localmente');

                await clearLocalLicenseSession();

                set({ appStatus: 'unauthenticated' });
                return;
            }
        }

        const updatedLocalLicense = {
            ...localLicense,
            status: localStatus,
            grace_period_ends: derivedGracePeriodEnd || localLicense.grace_period_ends || null
        };

        set({
            licenseDetails: updatedLocalLicense,
            licenseStatus: localStatus,
            gracePeriodEnds: updatedLocalLicense.grace_period_ends || null,
            currentDeviceRole: updatedLocalLicense.device_role || 'admin',
            currentStaffUser: updatedLocalLicense.device_role === 'staff'
                ? updatedLocalLicense.staff_user || null
                : null
        });

        await get()._loadProfile(updatedLocalLicense.license_key);
    }
});