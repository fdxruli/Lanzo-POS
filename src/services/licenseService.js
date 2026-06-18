// src/services/licenseService.js
import { getDeviceSecurityToken, supabaseClient } from './supabase';
import { loadData, saveData, STORES } from './database';
import Logger from './Logger';
import { checkInternetConnection, getStableDeviceId } from './utils';
import { useAppStore } from '../store/useAppStore';

export const getLicenseDevicesSmart = async (licenseKey) => {
    const CACHE_KEY = `devices_${licenseKey}`;

    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) throw new Error('OFFLINE_MODE');

        const deviceFingerprint = await getStableDeviceId();

        const { data, error } = await supabaseClient.rpc('get_license_devices_anon', {
            license_key_param: licenseKey,
            current_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        if (data.success) {
            useAppStore.getState().clearServerStatus?.();

            await saveData(STORES.SYNC_CACHE, {
                key: CACHE_KEY,
                data: data.data || [],
                updatedAt: new Date().toISOString()
            });

            return {
                success: true,
                data: data.data || [],
                source: 'network'
            };
        }

        throw new Error(data.message);
    } catch (error) {
        Logger.warn('Error de red o servidor, buscando dispositivos en cache...', error.message);

        const isActuallyOnline = await checkInternetConnection();

        if (isActuallyOnline) {
            const isServerError = error.message.includes('fetch') ||
                error.message.includes('network') ||
                error.code?.startsWith('5');

            if (isServerError) {
                Logger.error('Detectado fallo en Supabase con Internet activo');
                useAppStore.getState().reportServerStatus?.(
                    'down',
                    'Supabase no respondió al consultar los dispositivos. Se mostrarán datos locales si existen.',
                    'license_devices_lookup'
                );
            }
        }

        const cachedRecord = await loadData(STORES.SYNC_CACHE, CACHE_KEY);

        if (cachedRecord && cachedRecord.data) {
            return {
                success: true,
                data: cachedRecord.data,
                source: 'cache',
                lastUpdated: cachedRecord.updatedAt,
                originalError: error.message
            };
        }

        const isNetworkError = error.message === 'OFFLINE_MODE' || error.message.includes('fetch');

        return {
            success: false,
            message: isNetworkError
                ? 'Sin conexion con el servidor. Se muestran datos locales si existen.'
                : error.message
        };
    }
};

export const deactivateDeviceSmart = async (deviceId, licenseKey) => {
    const isOnline = await checkInternetConnection();
    if (!isOnline) {
        return { success: false, message: 'Necesitas conexion a internet para liberar dispositivos.' };
    }

    try {
        const deviceFingerprint = await getStableDeviceId();

        const { data, error } = await supabaseClient.rpc('release_device_anon', {
            device_id_param: deviceId,
            license_key_param: licenseKey,
            requester_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        if (data?.success && data?.released_current_device) {
            await saveData(STORES.SYNC_CACHE, { key: 'device_security_token', value: null });
            await saveData(STORES.SYNC_CACHE, { key: 'last_valid_license_state', value: null });
        }

        return data;
    } catch (error) {
        return { success: false, message: error.message };
    }
};

export const renewLicenseService = async (licenseKey) => {
    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            return {
                success: false,
                message: 'No tienes conexion a internet. Conectate para renovar.'
            };
        }

        const deviceFingerprint = await getStableDeviceId();

        const { data, error } = await supabaseClient.rpc('renew_license_free', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        if (data && data.success) {
            return {
                success: true,
                message: data.message,
                newExpiry: data.new_expiry,
                status: data.status
            };
        }

        return {
            success: false,
            message: data.message || 'No se pudo renovar la licencia.'
        };
    } catch (error) {
        Logger.error('Error renovando licencia:', error);
        return {
            success: false,
            message: error.message || 'Error de conexion al renovar.'
        };
    }
};

const getAdminStaffRpcContext = async (licenseKey) => {
    const [deviceFingerprint, securityToken] = await Promise.all([
        getStableDeviceId(),
        getDeviceSecurityToken()
    ]);

    if (!licenseKey || !deviceFingerprint || !securityToken) {
        throw new Error('No se pudo confirmar el dispositivo administrador.');
    }

    return {
        p_license_key: licenseKey,
        p_admin_device_fingerprint: deviceFingerprint,
        p_admin_security_token: securityToken
    };
};

export const listStaffUsersService = async (licenseKey) => {
    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            return { success: false, message: 'Necesitas conexion a internet para consultar usuarios staff.' };
        }

        const context = await getAdminStaffRpcContext(licenseKey);
        const { data, error } = await supabaseClient.rpc('admin_list_staff_users', context);

        if (error) throw error;

        return {
            success: Boolean(data?.success),
            data: data?.data || [],
            message: data?.message || data?.error || null
        };
    } catch (error) {
        Logger.error('Error listando usuarios staff:', error);
        return { success: false, message: error.message || 'No se pudieron cargar usuarios staff.' };
    }
};

export const createStaffUserService = async (licenseKey, payload) => {
    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            return { success: false, message: 'Necesitas conexion a internet para crear usuarios staff.' };
        }

        const context = await getAdminStaffRpcContext(licenseKey);
        const { data, error } = await supabaseClient.rpc('admin_create_staff_user', {
            ...context,
            p_username: payload.username,
            p_password: payload.password,
            p_display_name: payload.display_name,
            p_permissions: payload.permissions || {},
            p_role_name: payload.role_name || 'staff'
        });

        if (error) throw error;

        return {
            success: Boolean(data?.success),
            staff_user: data?.staff_user || null,
            message: data?.message || data?.error || data?.code || null
        };
    } catch (error) {
        Logger.error('Error creando usuario staff:', error);
        return { success: false, message: error.message || 'No se pudo crear usuario staff.' };
    }
};

export const updateStaffUserService = async (licenseKey, staffUserId, payload) => {
    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            return { success: false, message: 'Necesitas conexion a internet para actualizar usuarios staff.' };
        }

        const context = await getAdminStaffRpcContext(licenseKey);
        const { data, error } = await supabaseClient.rpc('admin_update_staff_user', {
            ...context,
            p_staff_user_id: staffUserId,
            p_display_name: payload.display_name,
            p_permissions: payload.permissions || {},
            p_is_active: payload.is_active,
            p_new_password: payload.new_password || null,
            p_role_name: payload.role_name || 'staff'
        });

        if (error) throw error;

        return {
            success: Boolean(data?.success),
            staff_user: data?.staff_user || null,
            message: data?.message || data?.error || data?.code || null
        };
    } catch (error) {
        Logger.error('Error actualizando usuario staff:', error);
        return { success: false, message: error.message || 'No se pudo actualizar usuario staff.' };
    }
};
