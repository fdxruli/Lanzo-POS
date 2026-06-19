// src/store/slices/license/licenseBackgroundValidationActions.js

import { checkInternetConnection, showMessageModal } from '../../../services/utils';
import Logger from '../../../services/Logger';

import {
  revalidateLicense
} from '../../../services/supabase';

import {
  saveLicenseToStorage,
  getLicenseFromStorage
} from '../../../services/licenseStorage';

import {
  normalizeValidationCode,
  isFatalValidationFailure,
  isStaffDeviceAuthorizationFailure,
  isLicensePlanBlockFailure
} from './licenseGuards';

export const createLicenseBackgroundValidationActions = ({
  set,
  get,
  clearLocalLicenseSession,
  hasStaffValidationContext
}) => ({
  _validateInBackground: async (licenseKey) => {
    try {
      if (get().appStatus === 'staff_login_required') {
        Logger.log('[Background] Login staff requerido; se conserva la pantalla actual.');
        return;
      }

      Logger.log('[Background] Iniciando validación silenciosa...');

      const BACKGROUND_TIMEOUT = 8000;

      const validationPromise = revalidateLicense(licenseKey);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('BACKGROUND_TIMEOUT')), BACKGROUND_TIMEOUT)
      );

      const serverValidation = await Promise.race([
        validationPromise,
        timeoutPromise
      ]);

      if (!serverValidation?.valid && serverValidation?.valid !== false) {
        Logger.warn('[Background] Respuesta inválida del servidor, ignorando.');
        return;
      }

      const localLicense = await getLicenseFromStorage();
      const sourceLicense = localLicense || get().licenseDetails || {
        license_key: licenseKey
      };

      if (isLicensePlanBlockFailure(serverValidation)) {
        await get()._requireLicenseChange(sourceLicense, serverValidation);
        return;
      }

      if (!localLicense) {
        Logger.warn('[Background] No hay licencia local para comparar.');
        return;
      }

      if (get().appStatus === 'staff_login_required') {
        Logger.log('[Background] Login staff requerido tras validar; no se fuerza salida.');
        return;
      }

      const criticalChanges = {
        validityChanged: serverValidation.valid !== localLicense.valid,
        statusChanged: serverValidation.status !== localLicense.status,
        expiryChanged:
          Boolean(serverValidation.expires_at) &&
          serverValidation.expires_at !== localLicense.expires_at,
        graceChanged:
          Boolean(serverValidation.grace_period_ends) &&
          serverValidation.grace_period_ends !== localLicense.grace_period_ends,
        featuresChanged:
          JSON.stringify(serverValidation.features || {}) !==
          JSON.stringify(localLicense.features || {}),
        realtimeTopicChanged:
          serverValidation.realtime_topic !== localLicense.realtime_topic,
        maxDevicesChanged:
          serverValidation.max_devices !== localLicense.max_devices,
        planCodeChanged:
          serverValidation.plan_code !== localLicense.plan_code,
        planNameChanged:
          serverValidation.plan_name !== localLicense.plan_name,
        productNameChanged:
          serverValidation.product_name !== localLicense.product_name,
        deviceRoleChanged:
          serverValidation.device_role !== localLicense.device_role,
        staffUserChanged:
          JSON.stringify(serverValidation.staff_user || null) !==
          JSON.stringify(localLicense.staff_user || null),
        wasRevoked:
          !serverValidation.valid &&
          isFatalValidationFailure(serverValidation),
        needsRenewal:
          !serverValidation.valid &&
          ['expired_subscription', 'LICENSE_EXPIRED'].includes(serverValidation.reason)
      };

      if (criticalChanges.wasRevoked) {
        if (
          isStaffDeviceAuthorizationFailure(serverValidation) &&
          await hasStaffValidationContext(get(), localLicense)
        ) {
          await get()._requireStaffLogin(localLicense, serverValidation);
          return;
        }

        await clearLocalLicenseSession();

        set({
          appStatus: 'unauthenticated',
          licenseDetails: null,
          licenseStatus: normalizeValidationCode(serverValidation) || 'invalid',
          companyProfile: null,
          profileImportCandidate: null,
          pendingTermsUpdate: null
        });

        Logger.error(
          '[Background] Licencia remota no disponible:',
          normalizeValidationCode(serverValidation)
        );

        showMessageModal(
          'LICENCIA NO DISPONIBLE\n\nLa licencia local ya no existe o fue desactivada en el servidor. Ingresa una licencia valida para continuar.',
          null,
          {
            type: 'error',
            confirmButtonText: 'Entendido',
            showCancel: false,
            isDismissible: false
          }
        );

        return;
      }

      if (criticalChanges.needsRenewal) {
        Logger.warn('[Background] Licencia expirada detectada');

        const expiredDetails = {
          ...localLicense,
          ...serverValidation,
          valid: false,
          status: 'expired'
        };

        await saveLicenseToStorage(expiredDetails);

        set({
          appStatus: 'locked_renewal',
          licenseStatus: 'expired',
          licenseDetails: expiredDetails,
          gracePeriodEnds: null
        });

        showMessageModal(
          'Tu licencia ha expirado.\n\nPara continuar usando la aplicación, renueva tu suscripción.',
          null,
          { type: 'warning' }
        );

        return;
      }

      if (
        criticalChanges.validityChanged ||
        criticalChanges.statusChanged ||
        criticalChanges.expiryChanged ||
        criticalChanges.graceChanged ||
        criticalChanges.featuresChanged ||
        criticalChanges.realtimeTopicChanged ||
        criticalChanges.maxDevicesChanged ||
        criticalChanges.planCodeChanged ||
        criticalChanges.planNameChanged ||
        criticalChanges.productNameChanged ||
        criticalChanges.deviceRoleChanged ||
        criticalChanges.staffUserChanged
      ) {
        Logger.log('[Background] Cambios detectados en licencia, actualizando...');
        await get()._processServerValidation(serverValidation, localLicense);
      } else {
        Logger.log('[Background] Licencia validada sin cambios. Verificando perfil...');
        await get()._loadProfile(localLicense.license_key);
      }

      sessionStorage.setItem('Lanzo_app_loaded', Date.now().toString());
      sessionStorage.setItem('Lanzo_last_validation', Date.now().toString());

      get().clearServerStatus?.();
    } catch (error) {
      const isOnlineNow = await checkInternetConnection();

      if (isOnlineNow) {
        if (error.message === 'BACKGROUND_TIMEOUT') {
          Logger.warn('[Salud] Detectada latencia alta en Supabase');

          get().reportServerStatus?.(
            'degraded',
            'Supabase está respondiendo más lento de lo normal. Los cambios de configuración pueden tardar unos segundos en reflejarse.',
            'background_timeout'
          );
        } else if (
          error.message?.includes('fetch') ||
          error.message?.includes('network') ||
          error.code === 'PGRST301' ||
          error.code?.startsWith('5')
        ) {
          Logger.warn('[Salud] Detectada caída o interrupción de Supabase');

          get().reportServerStatus?.(
            'down',
            'No se pudo contactar Supabase en este momento. Lanzo POS seguirá reintentando automáticamente.',
            'background_network_error'
          );
        }
      } else {
        get().clearServerStatus?.();
      }

      if (error.message === 'BACKGROUND_TIMEOUT') {
        Logger.warn('[Background] Timeout de validación (8s) - Servidor lento o sin conexión');
      } else if (
        error.message?.includes('fetch') ||
        error.message?.includes('network')
      ) {
        Logger.warn('[Background] Error de red durante validación');
      } else {
        Logger.warn('[Background] Validación falló:', error.message);
      }

      sessionStorage.setItem('Lanzo_last_validation', Date.now().toString());
    }
  }
});