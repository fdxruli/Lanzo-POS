// src/store/slices/license/licenseMaintenanceActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    renewLicenseService
} from '../../../services/licenseService';

export const createLicenseMaintenanceActions = ({
    set,
    get
}) => ({
    performSystemHealthCheck: async () => {
        const state = get();

        // Caso límite 1: No interrumpir la carga inicial ni ejecutar en pantallas sin autenticación
        if (
            state.appStatus === 'loading' ||
            state._isInitializing ||
            state.appStatus === 'unauthenticated'
        ) {
            return;
        }

        const lastActiveRaw = sessionStorage.getItem('lanzo_last_active');
        const now = Date.now();

        if (!lastActiveRaw) return;

        const timeAwayMs = now - parseInt(lastActiveRaw, 10);
        const timeAwayMinutes = timeAwayMs / (1000 * 60);

        // Caso límite 2: Control de ráfagas. Solo revalidar si la app estuvo dormida más de 3 minutos.
        if (timeAwayMinutes < 3) {
            Logger.log(
                `[HealthCheck] Inactividad breve (${timeAwayMinutes.toFixed(1)}m), omitiendo check de servidor.`
            );
            return;
        }

        Logger.log(
            `[HealthCheck] Retorno tras ${timeAwayMinutes.toFixed(1)}m de inactividad. Revalidando integridad...`
        );

        // Consumir el timestamp para evitar ejecuciones en bucle
        sessionStorage.removeItem('lanzo_last_active');

        // Caso límite 3: Verificación de red antes de golpear la API
        if (!navigator.onLine) {
            Logger.warn('[HealthCheck] El sistema está offline tras despertar. Operando con caché local.');
            return;
        }

        // Reutilizar la lógica que ya maneja periodos de gracia, expiración y actualizaciones de términos
        await state.runLicenseSyncCheck('wake');
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