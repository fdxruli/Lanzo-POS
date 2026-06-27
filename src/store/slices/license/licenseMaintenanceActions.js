// src/store/slices/license/licenseMaintenanceActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    renewLicenseService
} from '../../../services/licenseService';

const LAST_ACTIVE_STORAGE_KEY = 'lanzo_last_active';
const LAST_OFFLINE_STORAGE_KEY = 'lanzo_last_offline';

const readStoredTimestamp = (key) => {
    try {
        const rawValue = sessionStorage.getItem(key);
        const parsedValue = rawValue ? parseInt(rawValue, 10) : 0;
        return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
    } catch {
        return 0;
    }
};

const removeStoredTimestamp = (key) => {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Best effort cleanup.
    }
};

const getPositiveDurationMs = (value) => {
    const parsedValue = Number(value || 0);
    return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
};

const getDurationFromTimestamp = (timestamp, now = Date.now()) => (
    timestamp > 0 ? Math.max(0, now - timestamp) : 0
);

const isRealtimeLicenseMode = (state = {}) => {
    if (state.licenseSyncMode && state.licenseSyncMode !== 'idle') {
        return state.licenseSyncMode === 'hybrid_realtime';
    }

    return state.licenseDetails?.features?.realtime_license_sync === true;
};

export const createLicenseMaintenanceActions = ({
    set,
    get
}) => ({
    performSystemHealthCheck: async (reason = 'wake', metadata = {}) => {
        const state = get();

        // Caso límite 1: No interrumpir la carga inicial ni ejecutar en pantallas sin autenticación.
        if (
            state.appStatus === 'loading' ||
            state._isInitializing ||
            state.appStatus === 'unauthenticated'
        ) {
            return;
        }

        const isRealtimeMode = isRealtimeLicenseMode(state);
        const now = Date.now();
        const lastActiveAt = readStoredTimestamp(LAST_ACTIVE_STORAGE_KEY);
        const offlineStartedAt = readStoredTimestamp(LAST_OFFLINE_STORAGE_KEY);
        const providedTimeAwayMs = getPositiveDurationMs(metadata.timeAwayMs);
        const providedOfflineDurationMs = getPositiveDurationMs(metadata.offlineDurationMs);
        const storedTimeAwayMs = getDurationFromTimestamp(lastActiveAt, now);
        const storedOfflineDurationMs = getDurationFromTimestamp(offlineStartedAt, now);
        const timeAwayMs = Math.max(storedTimeAwayMs, providedTimeAwayMs);
        const offlineDurationMs = Math.max(storedOfflineDurationMs, providedOfflineDurationMs);
        const timeAwayMinutes = timeAwayMs / (1000 * 60);
        const safeReason = String(reason || 'wake').toLowerCase();
        const isOnlineReason = safeReason.includes('online');

        if (!lastActiveAt && !isRealtimeMode && !isOnlineReason && providedTimeAwayMs <= 0) return;

        // Para polling/local conservamos el umbral de 3 minutos. En realtime no se fuerza
        // validación remota aquí: solo se delega en recoverRealtimeSecurity para hacer probe
        // no crítico, esperar reconexión o recuperar canal si realmente está caído.
        if (!isRealtimeMode && timeAwayMinutes < 3 && !isOnlineReason) {
            Logger.log(
                `[HealthCheck] Inactividad breve (${timeAwayMinutes.toFixed(1)}m), omitiendo check de servidor.`
            );
            return;
        }

        Logger.log(
            isRealtimeMode
                ? `[HealthCheck] Retorno tras ${timeAwayMinutes.toFixed(1)}m (${reason}). Evaluando Realtime...`
                : `[HealthCheck] Retorno tras ${timeAwayMinutes.toFixed(1)}m (${reason}). Revalidando integridad...`
        );

        // Consumir el timestamp para evitar ejecuciones en bucle.
        removeStoredTimestamp(LAST_ACTIVE_STORAGE_KEY);

        // Caso límite 3: Verificación de red antes de golpear la API.
        if (!navigator.onLine) {
            Logger.warn('[HealthCheck] El sistema está offline tras despertar. Operando con caché local.');
            return;
        }

        if (offlineDurationMs > 0) {
            removeStoredTimestamp(LAST_OFFLINE_STORAGE_KEY);
        }

        if (isRealtimeMode && typeof state.recoverRealtimeSecurity === 'function') {
            await state.recoverRealtimeSecurity(reason, {
                source: reason,
                timeAwayMs,
                offlineDurationMs
            });
            return;
        }

        // Reutilizar la lógica que ya maneja periodos de gracia, expiración y actualizaciones de términos.
        await state.runLicenseSyncCheck(reason);
    },

    renewLicense: async () => {
        const { licenseDetails } = get();

        if (!licenseDetails?.license_key) {
            return {
                success: false,
                message: 'No hay licencia para renovar'
            };
        }

        Logger.log('Solicitando renovación de licencia...');

        const result = await renewLicenseService(licenseDetails.license_key);

        if (result.success) {
            Logger.log('Renovación exitosa. Actualizando estado local...');

            const updatedLicense = {
                ...licenseDetails,
                expires_at: result.newExpiry,
                status: result.status,
                valid: true,
                localExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            };

            set({
                licenseDetails: updatedLicense,
                licenseStatus: result.status,
                appStatus: 'ready',
                gracePeriodEnds: null
            });

            await saveLicenseToStorage(updatedLicense);

            return {
                success: true,
                message: result.message
            };
        }

        Logger.warn('Falló la renovación:', result.message);

        return {
            success: false,
            message: result.message
        };
    }
});