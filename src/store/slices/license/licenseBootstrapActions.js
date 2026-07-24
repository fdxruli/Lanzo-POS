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
    revalidateLicense,
    clearStaffSessionCache,
    clearAdminSessionCache,
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
    isLicensePlanBlockFailure,
    requiresAdminIdentity
} from './licenseGuards';

let initializePromise = null;
let coordinatorState = 'idle';

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

export const getInitializeAppCoordinatorState = () => coordinatorState;

export const createLicenseBootstrapActions = ({ set, get }) => ({
    initializeApp: (options = {}) => {
        if (initializePromise) {
            Logger.debug('[AppStore] initializeApp reutiliza la promesa en ejecución.');
            return initializePromise;
        }

        const force = options?.force === true;
        coordinatorState = 'running';
        set({ _isInitializing: true });
        Logger.log('[AppStore] Iniciando aplicación (coordinador idempotente)...');

        initializePromise = (async () => {
            try {
                await prepareLocalDatabase({ force });
                const localLicense = await getLicenseFromStorage();

                if (!localLicense?.license_key) {
                    coordinatorState = 'ready';
                    set({ appStatus: 'unauthenticated' });
                    return { status: 'unauthenticated' };
                }

                Logger.log('[AppStore] Carga rápida activada - Usando caché local');

                const hasStoredStaffSession = await hasStaffSessionToken();
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
                    await clearAdminSessionCache();
                    set({
                        licenseDetails: { ...localLicense, device_role: 'staff' },
                        currentDeviceRole: 'staff',
                        currentStaffUser: null,
                        staffLoginLicenseKey: localLicense.license_key
                    });

                    if (!navigator.onLine) {
                        Logger.warn('[Staff] Sesion staff requiere verificacion online al iniciar.');
                        set({
                            appStatus: 'staff_login_required',
                            staffLoginMessage: 'Necesitas internet para iniciar sesion staff.',
                            staffLoginError: null
                        });
                        coordinatorState = 'ready';
                        return { status: 'staff_login_required' };
                    }

                    const staffSession = await verifyStaffSession(localLicense.license_key);
                    if (!staffSession?.valid) {
                        const serverCheck = await revalidateLicense(localLicense.license_key);
                        if (isLicensePlanBlockFailure(serverCheck)) {
                            await get()._requireLicenseChange(localLicense, serverCheck);
                            coordinatorState = 'ready';
                            return { status: get().appStatus };
                        }

                        await clearStaffSessionCache();
                        set({
                            appStatus: 'staff_login_required',
                            currentStaffUser: null,
                            staffLoginMessage: staffSession?.message || 'Inicia sesion staff para continuar.',
                            staffLoginError: null
                        });
                        coordinatorState = 'ready';
                        return { status: 'staff_login_required' };
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
                    get()._validateInBackground(restoredLicense.license_key);
                    coordinatorState = 'ready';
                    return { status: get().appStatus };
                }

                const needsAdminIdentity = localDeviceRole === 'admin' && requiresAdminIdentity(localLicense);
                if (needsAdminIdentity) {
                    await clearStaffSessionCache();
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
                                adminLoginMessage: 'Conectate a internet para validar la sesion administrativa.'
                            });
                        }
                        coordinatorState = 'ready';
                        return { status: get().appStatus };
                    }

                    if (!await hasAdminSessionToken()) {
                        await get().discoverAdminAccess(localLicense.license_key);
                        coordinatorState = 'ready';
                        return { status: get().appStatus };
                    }

                    const adminSession = await verifyAdminSession(localLicense.license_key);
                    if (!adminSession.valid) {
                        await get()._requireAdminLogin(localLicense, adminSession);
                        coordinatorState = 'ready';
                        return { status: get().appStatus };
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
                    get()._validateInBackground(restoredLicense.license_key);
                    coordinatorState = 'ready';
                    return { status: get().appStatus };
                }

                await get()._processOfflineMode(localLicense);
                if (navigator.onLine) {
                    get()._validateInBackground(localLicense.license_key);
                } else {
                    Logger.log('[AppStore] Sin red al iniciar, se mantiene cache local.');
                }
                coordinatorState = 'ready';
                return { status: get().appStatus };
            } catch (criticalError) {
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
                set({ _isInitializing: false });
                initializePromise = null;
                if (coordinatorState === 'running') coordinatorState = 'ready';
            }
        })();

        return initializePromise;
    }
});
