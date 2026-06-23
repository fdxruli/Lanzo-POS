// src/store/slices/license/licenseMaintenanceActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    renewLicenseService
} from '../../../services/licenseService';

const isRealtimeLicenseMode = (state = {}) => (
    state.licenseSyncMode === 'hybrid_realtime' ||
    state.licenseDetails?.features?.realtime_license_sync === true
);

export const createLicenseMaintenanceActions = ({
    set,
    get
}) => ({
    performSystemHealthCheck: async (reason = 'wake') => {
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
        const lastActiveRaw = sessionStorage.getItem('lanzo_last_active');
        const now = Date.now();

        if (!lastActiveRaw && !isRealtimeMode) return;

        const lastActive = lastActiveRaw ? parseInt(lastActiveRaw, 10) : now;
        const timeAwayMs = Number.isFinite(lastActive) ? now - lastActive : 0;
        const timeAwayMinutes = Math.max(timeAwayMs, 0) / (1000 * 60);

        // Antes se omitía todo si la app estuvo fuera menos de 3 minutos. En PWA móvil
        // eso deja canales WebSocket dormidos/stale aunque la app esté abierta. Para
        // licencias realtime siempre recuperamos el canal al volver a primer plano.
        if (!isRealtimeMode && timeAwayMinutes < 3) {
            Logger.log(
                `[HealthCheck] Inactividad breve (${timeAwayMinutes.toFixed(1)}m), omitiendo check de servidor.`
            );
            return;
        }

        Logger.log(
            `[HealthCheck] Retorno tras ${timeAwayMinutes.toFixed(1)}m (${reason}). Revalidando integridad...`
        );

        // Consumir el timestamp para evitar ejecuciones en bucle.
        sessionStorage.removeItem('lanzo_last_active');

        // Caso límite 3: Verificación de red antes de golpear la API.
        if (!navigator.onLine) {
            Logger.warn('[HealthCheck] El sistema está offline tras despertar. Operando con caché local.');
            return;
        }

        if (isRealtimeMode && typeof state.recoverRealtimeSecurity === 'function') {
            await state.recoverRealtimeSecurity(reason);
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