// src/store/slices/license/licenseActivationActions.js

import Logger from '../../../services/Logger';

import {
    activateLicense,
    revalidateLicense,
    createFreeTrial
} from '../../../services/supabase';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    isLicensePlanBlockFailure,
    isStaffDeviceAuthorizationFailure,
    getStaffLoginMessage
} from './licenseGuards';
import { clearPendingAdminSessionIfLicenseChanged } from './pendingAdminSession';
import {
    assertLocalTenantAccess,
    initializeLocalTenantGuard,
    isLocalTenantAccessError
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';
import { isBrowserStorageUnavailableError } from '../../../services/db/databaseRecoveryState';

const readActivationValue = (source, key) => {
    if (source && source[key] !== undefined) return source[key];
    if (source?.details && source.details[key] !== undefined) return source.details[key];
    return undefined;
};

const preserveActivationFailure = (source = {}, overrides = {}) => {
    const failure = { success: false };
    const code = readActivationValue(source, 'code');
    const message = readActivationValue(source, 'message');
    const retryAfterSeconds = source?.retry_after_seconds ??
        source?.retryAfterSeconds ??
        source?.details?.retry_after_seconds ??
        source?.details?.retryAfterSeconds;

    if (code !== undefined && code !== null) failure.code = code;
    if (message !== undefined && message !== null) failure.message = message;
    if (retryAfterSeconds !== undefined && retryAfterSeconds !== null) {
        failure.retry_after_seconds = retryAfterSeconds;
    }

    return { ...failure, ...overrides };
};

const completeValidLicenseSession = async (set, get, licenseData, profileOptions) => {
    await assertLocalTenantAccess(licenseData, { reason: profileOptions?.reason || 'activation_complete' });
    await saveLicenseToStorage(licenseData);

    set({
        pendingAdminSessionResult: null,
        licenseDetails: licenseData,
        currentDeviceRole: licenseData.device_role || 'admin',
        currentStaffUser: licenseData.device_role === 'staff'
            ? licenseData.staff_user || null
            : null,
        localTenantIsolation: null
    });

    await get()._loadProfile(licenseData.license_key, profileOptions);
};

export const createLicenseActivationActions = ({
    set,
    get,
    hasStaffValidationContext
}) => ({
    handleLogin: async (licenseKey) => {
        initializeLocalTenantGuard('license_login');
        clearPendingAdminSessionIfLicenseChanged(set, get, licenseKey, 'activate_different_license');
        try {
            const result = await activateLicense(licenseKey, {
                beforeLocalPersistence: (resolvedDetails = {}) => assertLocalTenantAccess(
                    { ...resolvedDetails, license_key: resolvedDetails.license_key || licenseKey },
                    { reason: 'license_activation' }
                )
            });

            const confirmsTenant = Boolean(
                result.valid ||
                result.staff_login_required ||
                result.access_choice_required ||
                result.admin_enrollment_required ||
                isLicensePlanBlockFailure(result)
            );

            if (confirmsTenant) {
                await assertLocalTenantAccess(
                    { ...(result.details || {}), license_key: result.details?.license_key || licenseKey },
                    { reason: 'license_activation_response' }
                );
            }

            if (result.valid) {
                const licenseDataToSave = {
                    ...result.details,
                    license_key: result.details?.license_key || licenseKey,
                    valid: true
                };

                const activatedAsStaffWithoutStaffPlan =
                    licenseDataToSave.device_role === 'staff' &&
                    licenseDataToSave.features?.staff_roles !== true;

                if (activatedAsStaffWithoutStaffPlan) {
                    await get()._requireLicenseChange(
                        {
                            ...licenseDataToSave,
                            license_key: licenseDataToSave.license_key || licenseKey
                        },
                        {
                            valid: false,
                            reason: 'DEVICE_NOT_ALLOWED',
                            block_reason: 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
                            message:
                                'Esta licencia ya no incluye usuarios staff. Este dispositivo no puede continuar con esta licencia.',
                            license_key: licenseDataToSave.license_key || licenseKey,
                            plan_code: licenseDataToSave.plan_code,
                            plan_name: licenseDataToSave.plan_name,
                            product_name: licenseDataToSave.product_name,
                            max_devices: licenseDataToSave.max_devices,
                            device_role: licenseDataToSave.device_role
                        }
                    );

                    return preserveActivationFailure(
                        result,
                        {
                            licenseChangeRequired: true,
                            message: 'Esta licencia ya no incluye usuarios staff.'
                        }
                    );
                }

                await completeValidLicenseSession(set, get, licenseDataToSave, {
                    forceRemote: true,
                    reason: 'activation'
                });

                return { success: true };
            }

            if (isLicensePlanBlockFailure(result)) {
                await get()._requireLicenseChange(
                    {
                        ...(result.details || {}),
                        license_key: licenseKey
                    },
                    result
                );

                return preserveActivationFailure(
                    result,
                    {
                        licenseChangeRequired: true,
                        message: result.message || 'Esta licencia requiere cambiarse en este dispositivo.'
                    }
                );
            }

            if (result.staff_login_required) {
                set({
                    pendingAdminSessionResult: null,
                    appStatus: 'staff_login_required',
                    licenseDetails: {
                        ...(result.details || {}),
                        license_key: licenseKey,
                        valid: false,
                        device_role: 'staff'
                    },
                    currentDeviceRole: 'staff',
                    currentStaffUser: null,
                    staffLoginLicenseKey: licenseKey,
                    staffLoginMessage: result.message || 'Este dispositivo requiere login staff.',
                    staffLoginError: null
                });

                return preserveActivationFailure(
                    result,
                    {
                        staffLoginRequired: true,
                        message: result.message || 'Este dispositivo requiere login staff.'
                    }
                );
            }

            if (result.access_choice_required) {
                set({
                    pendingAdminSessionResult: null,
                    appStatus: 'license_access_required',
                    licenseDetails: { ...(result.details || {}), license_key: licenseKey, valid: false },
                    currentDeviceRole: null,
                    currentAdminUser: null,
                    currentStaffUser: null,
                    adminLoginLicenseKey: licenseKey,
                    staffLoginLicenseKey: licenseKey,
                    adminLoginMessage: result.message || 'Elige como deseas ingresar.',
                    adminLoginError: null
                });
                return preserveActivationFailure(result, { accessChoiceRequired: true });
            }

            if (result.admin_enrollment_required) {
                set({
                    pendingAdminSessionResult: null,
                    appStatus: 'admin_enrollment_required',
                    licenseDetails: { ...(result.details || {}), license_key: licenseKey, valid: false, device_role: 'admin' },
                    currentDeviceRole: 'admin',
                    currentAdminUser: null,
                    adminLoginLicenseKey: licenseKey,
                    adminLoginMessage: result.message,
                    adminLoginError: null,
                    adminEnrollmentRequired: true
                });
                return preserveActivationFailure(result, { adminEnrollmentRequired: true });
            }

            if (
                isStaffDeviceAuthorizationFailure(result) &&
                await hasStaffValidationContext(get(), {
                    ...(result.details || {}),
                    license_key: licenseKey
                })
            ) {
                await get()._requireStaffLogin({
                    ...(result.details || {}),
                    license_key: licenseKey,
                    device_role: 'staff'
                }, result);

                return preserveActivationFailure(
                    result,
                    {
                        staffLoginRequired: true,
                        message: getStaffLoginMessage(result)
                    }
                );
            }

            const errorMsg = (result.message || '').toLowerCase();

            if (
                !result.valid &&
                (errorMsg.includes('limit') || errorMsg.includes('active') || errorMsg.includes('device'))
            ) {
                await assertLocalTenantAccess(
                    { ...(result.details || {}), license_key: licenseKey },
                    { reason: 'license_recovery_validation' }
                );
                Logger.log('Dispositivo ya registrado. Intentando recuperar sesión...');

                const revalidate = await revalidateLicense(licenseKey);

                if (revalidate.valid) {
                    Logger.log('Sesión recuperada exitosamente.');

                    const recoveredData = {
                        ...revalidate,
                        license_key: licenseKey,
                        valid: true
                    };

                    await completeValidLicenseSession(set, get, recoveredData);

                    return { success: true };
                }
            }

            return preserveActivationFailure(result, {
                message: result.message || 'Licencia no válida'
            });
        } catch (error) {
            if (isBrowserStorageUnavailableError(error)) {
                return preserveActivationFailure(error);
            }

            if (isLocalTenantAccessError(error)) {
                enterLocalTenantIsolationFailure(set, error);
                return preserveActivationFailure(error, { localTenantMismatch: true });
            }

            Logger.error('Error en login:', error);

            return preserveActivationFailure(error);
        }
    },

    handleFreeTrial: async () => {
        initializeLocalTenantGuard('free_trial');
        try {
            const result = await createFreeTrial({
                beforeLocalPersistence: (resolvedDetails = {}) => assertLocalTenantAccess(
                    resolvedDetails,
                    { reason: 'free_trial_creation' }
                )
            });

            if (result.success) {
                const rawData = result.details || result;

                await assertLocalTenantAccess(rawData, { reason: 'free_trial_response' });

                const licenseDataToSave = {
                    ...rawData,
                    valid: true,
                    product_name: rawData.product_name || 'Lanzo Local',
                    max_devices: rawData.max_devices || 1
                };

                await saveLicenseToStorage(licenseDataToSave);

                set({
                    pendingAdminSessionResult: null,
                    licenseDetails: {
                        ...licenseDataToSave,
                        valid: false,
                        device_role: 'admin'
                    },
                    appStatus: 'admin_enrollment_required',
                    currentDeviceRole: 'admin',
                    currentAdminUser: null,
                    currentStaffUser: null,
                    adminLoginLicenseKey: licenseDataToSave.license_key,
                    adminLoginMessage: 'Crea las credenciales del propietario para continuar.',
                    adminLoginError: null,
                    adminEnrollmentRequired: true,
                    localTenantIsolation: null
                });

                return { success: true, adminEnrollmentRequired: true };
            }

            return {
                success: false,
                ...(result.code ? { code: result.code } : {}),
                message: result.message || result.error || 'No se pudo crear la licencia Lanzo Local.'
            };
        } catch (error) {
            if (isBrowserStorageUnavailableError(error)) {
                return {
                    success: false,
                    code: error.code,
                    message: error.message
                };
            }

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
                message: error.message
            };
        }
    }
});
