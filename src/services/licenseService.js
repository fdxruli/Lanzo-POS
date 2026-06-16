// src/services/licenseService.js
import { supabaseClient } from './supabase';
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
            useAppStore.setState({ serverHealth: 'ok', serverMessage: null });

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
                useAppStore.setState({
                    serverHealth: 'down',
                    serverMessage: 'El proveedor de la base de datos esta momentaneamente inaccesible. Mostrando datos locales.'
                });
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
