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

export const createLicenseActivationActions = ({
    set,
    get,
    hasStaffValidationContext
}) => ({
    handleLogin: async (licenseKey) => {
        try {
            const result = await activateLicense(licenseKey);

            if (result.valid) {
                const licenseDataToSave = { ...result.details, valid: true };

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

                    return {
                        success: false,
                        licenseChangeRequired: true,
                        message: 'Esta licencia ya no incluye usuarios staff.'
                    };
                }

                await saveLicenseToStorage(licenseDataToSave);
            }

            if (isLicensePlanBlockFailure(result)) {
                await get()._requireLicenseChange(
                    {
                        ...(result.details || {}),
                        license_key: licenseKey
                    },
                    result
                );

                return {
                    success: false,
                    licenseChangeRequired: true,
                    message: result.message || 'Esta licencia requiere cambiarse en este dispositivo.'
                };
            }

            if (result.staff_login_required) {
                set({
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

                return {
                    success: false,
                    staffLoginRequired: true,
                    message: result.message || 'Este dispositivo requiere login staff.'
                };
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

                return {
                    success: false,
                    staffLoginRequired: true,
                    message: getStaffLoginMessage(result)
                };
            }

            const errorMsg = (result.message || '').toLowerCase();

            if (
                !result.valid &&
                (errorMsg.includes('limit') || errorMsg.includes('active') || errorMsg.includes('device'))
            ) {
                Logger.log('Dispositivo ya registrado. Intentando recuperar sesión...');

                const revalidate = await revalidateLicense(licenseKey);

                if (revalidate.valid) {
                    Logger.log('Sesión recuperada exitosamente.');

                    const recoveredData = {
                        ...revalidate,
                        license_key: licenseKey,
                        valid: true
                    };

                    await saveLicenseToStorage(recoveredData);

                    set({
                        licenseDetails: recoveredData,
                        currentDeviceRole: recoveredData.device_role || 'admin',
                        currentStaffUser: recoveredData.device_role === 'staff'
                            ? recoveredData.staff_user || null
                            : null
                    });

                    await get()._loadProfile(licenseKey);

                    return { success: true };
                }
            }

            return {
                success: false,
                message: result.message || 'Licencia no válida'
            };
        } catch (error) {
            Logger.error('Error en login:', error);

            return {
                success: false,
                message: error.message
            };
        }
    },

    handleFreeTrial: async () => {
        try {
            const result = await createFreeTrial();

            if (result.success) {
                const rawData = result.details || result;

                const licenseDataToSave = {
                    ...rawData,
                    valid: true,
                    product_name: rawData.product_name || 'Lanzo Local',
                    max_devices: rawData.max_devices || 1
                };

                await saveLicenseToStorage(licenseDataToSave);

                set({
                    licenseDetails: licenseDataToSave,
                    appStatus: 'setup_required'
                });

                return { success: true };
            }

            return {
                success: false,
                message: result.error || 'No se pudo crear la licencia Lanzo Local.'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }
});
