// src/store/slices/license/licenseProcessingActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    RENEWAL_REASONS
} from './licenseConstants';

import {
    normalizeValidationCode,
    isFatalValidationFailure,
    isStaffLoginRequiredFailure,
    isStaffDeviceAuthorizationFailure,
    isLicensePlanBlockFailure,
    isAdministrativelyBlockedLicense,
    deriveGracePeriodEnd,
    deriveLocalGracePeriodEnd,
    requiresAdminIdentity
} from './licenseGuards';

import {
    clearAdminSessionCache,
    clearStaffSessionCache,
    verifyAdminSession
} from '../../../services/supabase';
import {
    isAuthoritativeSessionDenial,
    SESSION_VERIFICATION_STATUS
} from '../../../services/auth/sessionVerification';
import {
    beginActorRuntimeAuthentication,
    grantAuthenticatedActorRuntime,
    lockActorRuntime
} from '../../../services/auth/actorSessionRuntimeBridge';
import { assertLocalTenantSyncAccess } from '../../../services/tenant/localTenantGuard';
import { classifyActorAuthorityError } from '../../../services/auth/actorAuthorityErrors';
import { getActorAuthorityRecoverySnapshot, reportActorAuthorityError } from '../../../services/auth/actorAuthorityRecovery';
import { createEffectiveLicenseValidationEvidence } from '../../../utils/licenseStatusPresentation';
import {
    assertLicenseValidationContextCurrent,
    captureLicenseValidationContext,
    persistWithinLicenseValidationContext
} from './licenseValidationContext';

const shouldLoadProfileForLicense = (state = {}, licenseKey, refreshProfile = false) => (
    refreshProfile ||
    !state.companyProfile ||
    state.companyProfile?.license_key !== licenseKey
);

export const createLicenseProcessingActions = ({
    set,
    get,
    clearLocalLicenseSession,
    hasStaffValidationContext
}) => ({
    _processServerValidation: async (serverValidation, localLicense, options = {}) => {
        const {
            refreshProfile = false,
            reason = 'server_validation',
            isContextCurrent = null,
            persistWithinContext = null
        } = options || {};
        const contextIsCurrent = () => (
            typeof isContextCurrent !== 'function' || isContextCurrent()
        );
        const persist = (operation) => (
            typeof persistWithinContext === 'function'
                ? persistWithinContext(operation)
                : operation()
        );
        if (!contextIsCurrent()) return;
        if (getActorAuthorityRecoverySnapshot()) return;
        if (classifyActorAuthorityError(serverValidation)?.requiresReauthentication) {
            if (get()._requireActorAuthorityRecovery) {
                await get()._requireActorAuthorityRecovery(serverValidation, { operation: reason });
            } else {
                reportActorAuthorityError(serverValidation, { operation: reason });
            }
            return;
        }
        await assertLocalTenantSyncAccess(
            { ...localLicense, ...serverValidation, license_key: serverValidation?.license_key || localLicense?.license_key },
            { reason }
        );
        if (!contextIsCurrent()) return;
        const now = new Date();
        const derivedGracePeriodEnd = deriveGracePeriodEnd(serverValidation, localLicense);
        const graceEnd = derivedGracePeriodEnd ? new Date(derivedGracePeriodEnd) : null;

        if (isLicensePlanBlockFailure(serverValidation)) {
            if (!contextIsCurrent()) return;
            lockActorRuntime('license_plan_blocked');
            await get()._requireLicenseChange(localLicense, serverValidation);
            return;
        }

        if (isAdministrativelyBlockedLicense(serverValidation)) {
            const blockedEvidence = createEffectiveLicenseValidationEvidence(
                { ...serverValidation, valid: false },
                { effectiveStatus: 'administratively_blocked', now }
            );
            const blockedLicense = {
                ...localLicense,
                ...serverValidation,
                valid: false,
                status: 'administratively_blocked',
                ...(blockedEvidence ? { effective_lifecycle_validation: blockedEvidence } : {})
            };

            if (!contextIsCurrent()) return;
            await persist(() => saveLicenseToStorage(blockedLicense));
            if (!contextIsCurrent()) return;
            set({
                licenseDetails: blockedLicense,
                licenseStatus: 'administratively_blocked',
                gracePeriodEnds: null
            });
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
                if (!contextIsCurrent()) return;
                await get()._requireStaffLogin(localLicense, serverValidation);
                return;
            }

            if (isFatalValidationFailure(serverValidation)) {
                if (!contextIsCurrent()) return;
                Logger.warn('[AppStore] Licencia revocada fatalmente:', serverValidation.reason);
                lockActorRuntime('license_validation_fatal');
                const invalidationContext = captureLicenseValidationContext(get(), localLicense.license_key);
                await clearLocalLicenseSession();
                assertLicenseValidationContextCurrent(invalidationContext, get());
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
                if (!contextIsCurrent()) return;
                Logger.warn('[AppStore] Licencia expirada. Bloqueando pantalla...');
                lockActorRuntime('license_renewal_required');
                const renewalContext = captureLicenseValidationContext(get(), localLicense.license_key);

                await get()._loadProfile(localLicense.license_key, {
                    refreshProfile: false,
                    profileLoadMode: 'background',
                    reason: `renewal_${reason}`
                });
                assertLicenseValidationContextCurrent(renewalContext, get());

                const expiredEvidence = createEffectiveLicenseValidationEvidence(
                    { ...serverValidation, valid: false },
                    { effectiveStatus: 'expired', now }
                );
                const expiredDetails = {
                    ...localLicense,
                    ...serverValidation,
                    valid: false,
                    status: 'expired',
                    ...(expiredEvidence ? { effective_lifecycle_validation: expiredEvidence } : {})
                };

                set({
                    appStatus: 'locked_renewal',
                    licenseStatus: 'expired',
                    licenseDetails: expiredDetails
                });

                return;
            }

            Logger.warn(
                '[AppStore] Validación fallida (posible error post-update). Manteniendo sesión local.'
            );

            await get()._processOfflineMode(localLicense, {
                refreshProfile,
                reason: `server_validation_fallback_${reason}`
            });
            return;
        }

        let finalStatus = serverValidation.lifecycle_state ||
            serverValidation.status || serverValidation.reason || 'active';

        if (
            serverValidation.lifecycle_state === 'grace_period' ||
            serverValidation.status === 'grace_period' ||
            isWithinGracePeriod
        ) {
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

        const effectiveLifecycleEvidence = serverValidation.is_fallback === true
            ? (
                localLicense?.effective_lifecycle_validation ||
                serverValidation?.effective_lifecycle_validation ||
                null
            )
            : createEffectiveLicenseValidationEvidence(
                { ...serverValidation, valid: true },
                { effectiveStatus: finalStatus, now }
            );

        const finalLicenseData = {
            ...localLicense,
            ...serverValidation,
            valid: true,
            status: finalStatus,
            grace_period_ends: derivedGracePeriodEnd,
            ...(effectiveLifecycleEvidence
                ? { effective_lifecycle_validation: effectiveLifecycleEvidence }
                : {}),
            localExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };

        if (!contextIsCurrent()) return;
        await persist(() => saveLicenseToStorage(finalLicenseData));
        if (!contextIsCurrent()) return;

        const becameAdminIdentityRequired =
            localLicense.device_role === 'admin' &&
            !requiresAdminIdentity(localLicense) &&
            requiresAdminIdentity(finalLicenseData);
        const becameFree =
            localLicense.device_role === 'admin' &&
            requiresAdminIdentity(localLicense) &&
            !requiresAdminIdentity(finalLicenseData);

        if (becameFree) {
            lockActorRuntime('admin_identity_no_longer_required');
            const freeTransitionContext = captureLicenseValidationContext(
                get(),
                finalLicenseData.license_key
            );
            await clearAdminSessionCache();
            assertLicenseValidationContextCurrent(freeTransitionContext, get());
        }

        if (becameAdminIdentityRequired) {
            await get().stopLicenseSync();
            if (!contextIsCurrent()) return;
            await clearStaffSessionCache();
            if (!contextIsCurrent()) return;
            set({
                licenseDetails: { ...finalLicenseData, device_role: 'admin' },
                currentDeviceRole: 'admin',
                currentStaffUser: null,
                currentAdminUser: null,
                appStatus: 'loading'
            });

            if (!contextIsCurrent()) return;
            beginActorRuntimeAuthentication('admin');
            const adminUpgradeContext = captureLicenseValidationContext(
                get(),
                finalLicenseData.license_key
            );
            const assertAdminUpgradeContext = () => assertLicenseValidationContextCurrent(
                adminUpgradeContext,
                get()
            );
            const persistAdminUpgradeContext = (operation) => persistWithinLicenseValidationContext(
                adminUpgradeContext,
                get,
                operation
            );
            const adminSession = await verifyAdminSession(finalLicenseData.license_key, {
                beforeLocalPersistence: assertAdminUpgradeContext
            });
            assertAdminUpgradeContext();
            if (adminSession?.valid) {
                const restored = {
                    ...finalLicenseData,
                    ...adminSession.details,
                    device_role: 'admin',
                    staff_user: null,
                    admin_user: adminSession.admin_user || null
                };
                await persistAdminUpgradeContext(() => saveLicenseToStorage(restored));
                assertAdminUpgradeContext();
                set({
                    licenseDetails: restored,
                    currentAdminUser: restored.admin_user,
                    appStatus: 'ready'
                });
                try {
                    await grantAuthenticatedActorRuntime({
                        actorType: 'admin',
                        actor: restored.admin_user
                    });
                } catch (actorError) {
                    lockActorRuntime('hot_pro_upgrade_actor_binding_failed');
                    Logger.warn('[AdminAuth] Sesión hot-upgrade sin autoridad ActorRuntime segura.', actorError?.code || actorError?.name);
                    set({
                        appStatus: 'admin_login_required',
                        currentAdminUser: null,
                        adminLoginLicenseKey: finalLicenseData.license_key,
                        adminLoginMessage: 'La sesión se verificó, pero no pudimos restaurar una autoridad operativa segura. Reintenta la recuperación.',
                        adminLoginError: {
                            code: 'ACTOR_RUNTIME_RESTORE_FAILED',
                            verificationStatus: SESSION_VERIFICATION_STATUS.VERIFIED
                        }
                    });
                    return;
                }
                await get()._loadProfile(restored.license_key, {
                    refreshProfile,
                    profileLoadMode: 'background',
                    reason: 'hot_pro_upgrade_admin_session'
                });
                return;
            }

            if (isAuthoritativeSessionDenial(adminSession)
                || (adminSession?.verificationStatus === SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING
                    && adminSession.missingCredentials?.includes('admin_session_token'))) {
                lockActorRuntime('hot_pro_upgrade_admin_session_rejected');
                await get().discoverAdminAccess(finalLicenseData.license_key);
                return;
            }

            lockActorRuntime('hot_pro_upgrade_session_verification_inconclusive');
            set({
                appStatus: 'admin_login_required',
                currentAdminUser: null,
                adminLoginLicenseKey: finalLicenseData.license_key,
                adminLoginMessage: adminSession?.verificationStatus === SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE
                    ? 'No pudimos verificar tu sesión por un problema de conexión. Tus datos locales se mantienen protegidos; reintenta cuando regrese la conexión.'
                    : 'No pudimos confirmar la sesión administrativa. Las credenciales y los datos locales se mantienen protegidos; reintenta la verificación.',
                adminLoginError: {
                    code: 'SESSION_VERIFICATION_INCONCLUSIVE',
                    verificationStatus: adminSession?.verificationStatus || SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
                    reasonCode: adminSession?.code || null
                }
            });
            return;
        }

        set({
            licenseDetails: finalLicenseData,
            licenseStatus: finalStatus,
            gracePeriodEnds: derivedGracePeriodEnd,
            currentDeviceRole: finalLicenseData.device_role || 'admin',
            currentStaffUser: finalLicenseData.device_role === 'staff'
                ? finalLicenseData.staff_user || null
                : null,
            localTenantIsolation: null
        });

        if (shouldLoadProfileForLicense(get(), finalLicenseData.license_key, refreshProfile)) {
            await get()._loadProfile(finalLicenseData.license_key, {
                refreshProfile,
                profileLoadMode: 'background',
                reason
            });
        }

        await get().refreshLicenseSyncMode('server_validation');
    },

    _processOfflineMode: async (localLicense, options = {}) => {
        const { refreshProfile = false, reason = 'offline_mode' } = options || {};
        await assertLocalTenantSyncAccess(localLicense, { reason });
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

            lockActorRuntime('offline_license_expired');
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
            deriveLocalGracePeriodEnd(localLicense);

        const graceDate = derivedGracePeriodEnd
            ? new Date(derivedGracePeriodEnd).getTime()
            : null;

        if (expiryDate && expiryDate < nowTime) {
            if (graceDate && graceDate > nowTime) {
                localStatus = 'grace_period';
                Logger.log('[AppStore] Licencia en PERÍODO DE GRACIA (offline)');
            } else {
                console.warn('[AppStore] Licencia expirada localmente');

                lockActorRuntime('offline_license_expired');
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
                : null,
            localTenantIsolation: null
        });

        if (shouldLoadProfileForLicense(get(), updatedLocalLicense.license_key, refreshProfile)) {
            await get()._loadProfile(updatedLocalLicense.license_key, {
                refreshProfile,
                profileLoadMode: 'background',
                reason
            });
        }
    }
});
