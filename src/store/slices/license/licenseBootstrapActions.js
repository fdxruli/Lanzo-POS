// src/store/slices/license/licenseBootstrapActions.js

import Logger from '../../../services/Logger';

import {
    revalidateLicense,
    clearStaffSessionCache,
    hasStaffSessionToken,
    verifyStaffSession,
    hasAdminSessionToken,
    hasValidOfflineAdminSession,
    verifyAdminSession
} from '../../../services/supabase';

import {
    saveLicenseToStorage,
    getLicenseFromStorage
} from '../../../services/licenseStorage';

import {
    isLicensePlanBlockFailure
} from './licenseGuards';

export const createLicenseBootstrapActions = ({
    set,
    get
}) => ({
    initializeApp: async () => {
        if (get()._isInitializing) {
            Logger.warn('initializeApp ya está en ejecución, saltando...');
            return;
        }

        set({ _isInitializing: true });
        Logger.log('[AppStore] Iniciando aplicación (Modo Instantáneo)...');

        try {
            const localLicense = await getLicenseFromStorage();

            if (!localLicense?.license_key) {
                set({
                    appStatus: 'unauthenticated',
                    _isInitializing: false
                });
                return;
            }

            Logger.log('[AppStore] Carga rápida activada - Usando caché local');

            const hasStoredStaffSession = await hasStaffSessionToken();
            Logger.log(`[AppStore] Sesión staff local: ${hasStoredStaffSession ? 'encontrada' : 'no encontrada'}`);
            const localDeviceRole =
                localLicense.device_role || (localLicense.staff_user ? 'staff' : 'admin');

            if (localDeviceRole === 'staff' || hasStoredStaffSession) {
                set({
                    licenseDetails: {
                        ...localLicense,
                        device_role: 'staff'
                    },
                    currentDeviceRole: 'staff',
                    currentStaffUser: null,
                    staffLoginLicenseKey: localLicense.license_key
                });

                if (!navigator.onLine) {
                    Logger.warn('[Staff] Sesion staff requiere verificacion online al iniciar.');

                    set({
                        appStatus: 'staff_login_required',
                        staffLoginMessage: 'Necesitas internet para iniciar sesion staff.',
                        staffLoginError: null,
                        _isInitializing: false
                    });

                    return;
                }

                const staffSession = await verifyStaffSession(localLicense.license_key);

                if (!staffSession?.valid) {
                    const serverCheck = await revalidateLicense(localLicense.license_key);

                    if (isLicensePlanBlockFailure(serverCheck)) {
                        await get()._requireLicenseChange(localLicense, serverCheck);
                        return;
                    }

                    await clearStaffSessionCache();

                    set({
                        appStatus: 'staff_login_required',
                        currentStaffUser: null,
                        staffLoginMessage: staffSession?.message || 'Inicia sesion staff para continuar.',
                        staffLoginError: null,
                        _isInitializing: false
                    });

                    return;
                }

                const restoredLicense = {
                    ...localLicense,
                    device_role: 'staff',
                    staff_user: staffSession.staff_user || localLicense.staff_user || null
                };

                await saveLicenseToStorage(restoredLicense);

                set({
                    licenseDetails: restoredLicense,
                    currentDeviceRole: 'staff',
                    currentStaffUser: restoredLicense.staff_user,
                    staffLoginMessage: null,
                    staffLoginError: null
                });

                await get()._loadProfile(restoredLicense.license_key);

                set({ _isInitializing: false });

                get()._validateInBackground(restoredLicense.license_key);

                return;
            }

            const planCode = String(localLicense.plan_code || '').toLowerCase();
            const requiresAdminIdentity = localDeviceRole === 'admin'
                && planCode !== 'free_trial'
                && (Number(localLicense.max_devices || 1) > 1 || localLicense.features?.staff_roles === true);

            if (requiresAdminIdentity) {
                set({
                    licenseDetails: { ...localLicense, device_role: 'admin' },
                    currentDeviceRole: 'admin',
                    currentAdminUser: null,
                    adminLoginLicenseKey: localLicense.license_key
                });

                if (!navigator.onLine) {
                    if (await hasValidOfflineAdminSession()) {
                        set({ currentAdminUser: localLicense.admin_user || null });
                        await get()._processOfflineMode(localLicense);
                    } else {
                        set({
                            appStatus: 'admin_login_required',
                            adminLoginMessage: 'Conectate a internet para validar la sesion administrativa.',
                            _isInitializing: false
                        });
                    }
                    set({ _isInitializing: false });
                    return;
                }

                if (!await hasAdminSessionToken()) {
                    await get().discoverAdminAccess(localLicense.license_key);
                    set({ _isInitializing: false });
                    return;
                }

                const adminSession = await verifyAdminSession(localLicense.license_key);
                if (!adminSession.valid) {
                    await get()._requireAdminLogin(localLicense, adminSession);
                    set({ _isInitializing: false });
                    return;
                }

                const restoredLicense = {
                    ...localLicense,
                    ...adminSession.details,
                    device_role: 'admin',
                    staff_user: null,
                    admin_user: adminSession.admin_user || localLicense.admin_user || null
                };
                await saveLicenseToStorage(restoredLicense);
                set({
                    licenseDetails: restoredLicense,
                    currentDeviceRole: 'admin',
                    currentAdminUser: restoredLicense.admin_user,
                    adminLoginMessage: null,
                    adminLoginError: null
                });
                await get()._loadProfile(restoredLicense.license_key);
                set({ _isInitializing: false });
                get()._validateInBackground(restoredLicense.license_key);
                return;
            }

            await get()._processOfflineMode(localLicense);

            set({ _isInitializing: false });

            if (navigator.onLine) {
                get()._validateInBackground(localLicense.license_key);
            } else {
                Logger.log('[AppStore] Sin red al iniciar, se mantiene cache local.');
            }
        } catch (criticalError) {
            Logger.error('Error crítico inicializando:', criticalError);

            set({
                appStatus: 'unauthenticated',
                _isInitializing: false
            });
        }
    }
});
