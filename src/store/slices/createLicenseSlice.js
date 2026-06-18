import { checkInternetConnection, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import { renewLicenseService } from '../../services/licenseService';
import {
  activateLicense,
  revalidateLicense,
  createFreeTrial,
  clearLicenseSecurityCache,
  clearStaffSessionCache,
  hasStaffSessionToken,
  staffLoginOnDevice,
  staffLogoutSession,
  verifyStaffSession
} from '../../services/supabase';

import {
  saveLicenseToStorage,
  getLicenseFromStorage,
  clearLicenseFromStorage
} from '../../services/licenseStorage';

import {
  GRACE_PERIOD_DAYS,
  RENEWAL_REASONS
} from './license/licenseConstants';

import {
  normalizeValidationCode,
  isFatalValidationFailure,
  isRecoverableValidationFailure,
  isStaffLoginRequiredFailure,
  isStaffDeviceAuthorizationFailure,
  isLicensePlanBlockFailure,
  buildLicensePlanBlockInfo,
  deriveGracePeriodEnd,
  getStaffLoginMessage
} from './license/licenseGuards';

import { createLicenseInitialState } from './license/licenseState';
import { createLicenseSyncActions } from './license/licenseSyncActions';
import { createLicenseRealtimeActions } from './license/licenseRealtimeActions';

const hasStaffValidationContext = async (state = {}, licenseDetails = {}) => (
  licenseDetails?.device_role === 'staff' ||
  state.licenseDetails?.device_role === 'staff' ||
  state.currentDeviceRole === 'staff' ||
  state.appStatus === 'staff_login_required' ||
  await hasStaffSessionToken()
);

const clearLocalLicenseSession = async () => {
  clearLicenseFromStorage();
  await clearLicenseSecurityCache();
};

export const createLicenseSlice = (set, get) => ({
  ...createLicenseInitialState(),
  isAdminDevice: () => get().currentDeviceRole !== 'staff',
  canAccess: (permission) => {
    const state = get();
    if (state.currentDeviceRole !== 'staff') return true;
    if (!state.currentStaffUser) return false;
    return state.currentStaffUser.permissions?.[permission] === true;
  },

  ...createLicenseRealtimeActions({
    set,
    get,
    hasStaffValidationContext
  }),

  ...createLicenseSyncActions({
    set,
    get
  }),

  _requireLicenseChange: async (licenseSource = null, validation = {}) => {
    const state = get();
    const sourceLicense = licenseSource || state.licenseDetails || {};
    const blockInfo = buildLicensePlanBlockInfo(validation, sourceLicense);

    Logger.warn('[LicensePlan] Licencia bloqueada por cambio de plan:', blockInfo);

    await get().stopLicenseSync();
    await clearStaffSessionCache();
    await clearLocalLicenseSession();

    set({
      appStatus: 'license_change_required',
      licenseDetails: null,
      licenseStatus: blockInfo.reason || 'license_plan_blocked',
      licensePlanBlockInfo: blockInfo,
      gracePeriodEnds: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null,
      currentStaffUser: null,
      staffLoginLicenseKey: null,
      staffLoginMessage: null,
      staffLoginError: null,
      pendingTermsUpdate: null,
      realtimeSubscription: null,
      _isInitializing: false,
      _isInitializingSecurity: false,
      _securityCleanupScheduled: false,
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      _isLicenseSyncChecking: false,
      serverHealth: 'ok',
      serverMessage: null
    });
  },

  confirmLicenseChangeRequired: async () => {
    await clearLocalLicenseSession();

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      licenseStatus: 'active',
      licensePlanBlockInfo: null,
      gracePeriodEnds: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null,
      currentStaffUser: null,
      staffLoginLicenseKey: null,
      staffLoginMessage: null,
      staffLoginError: null,
      pendingTermsUpdate: null,
      serverHealth: 'ok',
      serverMessage: null
    });
  },

  _requireStaffLogin: async (licenseSource = null, validation = {}) => {
    const state = get();
    const sourceLicense = licenseSource || state.licenseDetails || {};
    const licenseKey = sourceLicense.license_key || state.staffLoginLicenseKey || null;

    const nextLicenseDetails = sourceLicense.license_key
      ? {
        ...sourceLicense,
        device_role: 'staff',
        staff_user: null
      }
      : state.licenseDetails;

    // Si un staff queda bloqueado/liberado/no autorizado, apagamos cualquier
    // sincronización activa para evitar revalidaciones de fondo o un canal
    // Realtime vivo mientras el usuario está en StaffLoginModal.
    await get().stopLicenseSync();

    await clearStaffSessionCache();

    if (nextLicenseDetails?.license_key) {
      await saveLicenseToStorage(nextLicenseDetails);
    }

    set({
      appStatus: 'staff_login_required',
      ...(nextLicenseDetails ? { licenseDetails: nextLicenseDetails } : {}),
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      staffLoginLicenseKey: licenseKey,
      staffLoginMessage: getStaffLoginMessage(validation),
      staffLoginError: null
    });
  },

  performSystemHealthCheck: async () => {
    const state = get();

    // Caso límite 1: No interrumpir la carga inicial ni ejecutar en pantallas sin autenticación
    if (state.appStatus === 'loading' || state._isInitializing || state.appStatus === 'unauthenticated') {
      return;
    }

    const lastActiveRaw = sessionStorage.getItem('lanzo_last_active');
    const now = Date.now();

    if (!lastActiveRaw) return;

    const timeAwayMs = now - parseInt(lastActiveRaw, 10);
    const timeAwayMinutes = timeAwayMs / (1000 * 60);

    // Caso límite 2: Control de ráfagas. Solo revalidar si la app estuvo dormida más de 3 minutos.
    // Ajusta este umbral según la criticidad de tu POS.
    if (timeAwayMinutes < 3) {
      Logger.log(`[HealthCheck] Inactividad breve (${timeAwayMinutes.toFixed(1)}m), omitiendo check de servidor.`);
      return;
    }

    Logger.log(`[HealthCheck] Retorno tras ${timeAwayMinutes.toFixed(1)}m de inactividad. Revalidando integridad...`);

    // Consumir el timestamp para evitar ejecuciones en bucle
    sessionStorage.removeItem('lanzo_last_active');

    // Caso límite 3: Verificación de red antes de golpear la API
    if (!navigator.onLine) {
      Logger.warn('[HealthCheck] El sistema está offline tras despertar. Operando con caché local.');
      // Aquí el Health Check detecta que no hay red, podríamos forzar un chequeo a Dexie local si fuera necesario.
      return;
    }

    // Reutilizar la lógica que ya maneja periodos de gracia, expiración y actualizaciones de términos
    await state.runLicenseSyncCheck('wake');
  },

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
        set({ appStatus: 'unauthenticated', _isInitializing: false });
        return;
      }

      Logger.log('[AppStore] Carga rápida activada - Usando caché local');
      const hasStoredStaffSession = await hasStaffSessionToken();
      const localDeviceRole = localLicense.device_role || (localLicense.staff_user ? 'staff' : 'admin');

      if (localDeviceRole === 'staff' || hasStoredStaffSession) {
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

      await get()._processOfflineMode(localLicense);
      set({ _isInitializing: false });

      if (navigator.onLine) {
        get()._validateInBackground(localLicense.license_key);
      } else {
        Logger.log('[AppStore] Sin red al iniciar, se mantiene cache local.');
      }
    } catch (criticalError) {
      Logger.error('Error crítico inicializando:', criticalError);
      set({ appStatus: 'unauthenticated', _isInitializing: false });
    }
  },

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

      const serverValidation = await Promise.race([validationPromise, timeoutPromise]);

      if (!serverValidation?.valid && serverValidation?.valid !== false) {
        Logger.warn('[Background] Respuesta inválida del servidor, ignorando.');
        return;
      }

      const localLicense = await getLicenseFromStorage();
      const sourceLicense = localLicense || get().licenseDetails || { license_key: licenseKey };

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

        Logger.error('[Background] Licencia remota no disponible:', normalizeValidationCode(serverValidation));

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
      } else if (error.message?.includes('fetch') || error.message?.includes('network')) {
        Logger.warn('[Background] Error de red durante validación');
      } else {
        Logger.warn('[Background] Validación falló:', error.message);
      }

      sessionStorage.setItem('Lanzo_last_validation', Date.now().toString());
    }
  },

  renewLicense: async () => {
    const { licenseDetails } = get();
    if (!licenseDetails?.license_key) {
      return { success: false, message: 'No hay licencia para renovar' };
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

      return { success: true, message: result.message };
    }

    Logger.warn('Falló la renovación:', result.message);
    return { success: false, message: result.message };
  },

  _processServerValidation: async (serverValidation, localLicense) => {
    const now = new Date();
    const derivedGracePeriodEnd = deriveGracePeriodEnd(serverValidation, localLicense);
    const graceEnd = derivedGracePeriodEnd ? new Date(derivedGracePeriodEnd) : null;
    if (isLicensePlanBlockFailure(serverValidation)) {
      await get()._requireLicenseChange(localLicense, serverValidation);
      return;
    }

    const isWithinGracePeriod = graceEnd && graceEnd > now;

    if (
      !serverValidation.valid &&
      serverValidation.reason !== 'offline_grace' &&
      !isWithinGracePeriod
    ) {
      if (
        isStaffLoginRequiredFailure(serverValidation) ||
        (
          isStaffDeviceAuthorizationFailure(serverValidation) &&
          await hasStaffValidationContext(get(), localLicense)
        )
      ) {
        await get()._requireStaffLogin(localLicense, serverValidation);
        return;
      }

      if (isFatalValidationFailure(serverValidation)) {
        Logger.warn('[AppStore] Licencia revocada fatalmente:', serverValidation.reason);
        await clearLocalLicenseSession();
        set({
          appStatus: 'unauthenticated',
          licenseDetails: null,
          licenseStatus: normalizeValidationCode(serverValidation) || 'invalid',
          companyProfile: null,
          profileImportCandidate: null,
          pendingTermsUpdate: null
        });
        return;
      }

      if (RENEWAL_REASONS.includes(serverValidation.reason)) {
        Logger.warn('[AppStore] Licencia expirada. Bloqueando pantalla...');
        await get()._loadProfile(localLicense.license_key);
        set({
          appStatus: 'locked_renewal',
          licenseStatus: 'expired',
          licenseDetails: { ...localLicense, valid: false, status: 'expired' }
        });
        return;
      }

      Logger.warn(
        '[AppStore] Validación fallida (posible error post-update). Manteniendo sesión local.'
      );
      await get()._processOfflineMode(localLicense);
      return;
    }

    let finalStatus = serverValidation.status || serverValidation.reason || 'active';

    if (serverValidation.status === 'grace_period' || isWithinGracePeriod) {
      finalStatus = 'grace_period';
      Logger.log('[AppStore] Licencia en PERÍODO DE GRACIA');
    }

    // CORRECCIÓN 3: Unificado el nombre del campo a 'has_updated_terms' (con 'd').
    // En el monolito original, _processServerValidation usaba 'has_update_terms' (sin 'd')
    // mientras que verifySessionIntegrity usaba 'has_updated_terms' (con 'd').
    // Uno de los dos siempre fallaba silenciosamente. Se elige 'has_updated_terms' como canónico.
    if (serverValidation.legal_status?.has_updated_terms) {
      Logger.log('Términos actualizados detectados:', serverValidation.legal_status);
      set({ pendingTermsUpdate: serverValidation.legal_status });
    } else {
      set({ pendingTermsUpdate: null });
    }

    const finalLicenseData = {
      ...localLicense,
      ...serverValidation,
      valid: true,
      status: finalStatus,
      grace_period_ends: derivedGracePeriodEnd,
      localExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    await saveLicenseToStorage(finalLicenseData);

    set({
      licenseDetails: finalLicenseData,
      licenseStatus: finalStatus,
      gracePeriodEnds: derivedGracePeriodEnd,
      currentDeviceRole: finalLicenseData.device_role || 'admin',
      currentStaffUser: finalLicenseData.device_role === 'staff' ? finalLicenseData.staff_user || null : null
    });

    await get()._loadProfile(finalLicenseData.license_key);
    await get().refreshLicenseSyncMode('server_validation');
  },

  _processOfflineMode: async (localLicense) => {
    const now = new Date();

    if (!localLicense.localExpiry) {
      Logger.log('[AppStore] localExpiry faltante, generando basado en activación...');

      const baseDate = localLicense.activated_at ? new Date(localLicense.activated_at) : now;

      const expiryDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      localLicense.localExpiry = expiryDate.toISOString();

      await saveLicenseToStorage(localLicense);
    }

    const localExpiryTime = new Date(localLicense.localExpiry).getTime();
    const nowTime = now.getTime();

    if (localExpiryTime <= nowTime) {
      console.warn('[AppStore] Caché local expirado (30 días sin conexión)');
      console.warn(`Fecha de expiración: ${localLicense.localExpiry}`);
      console.warn(`Fecha actual: ${now.toISOString()}`);
      await clearLocalLicenseSession();
      set({ appStatus: 'unauthenticated' });
      return;
    }

    const daysRemaining = Math.floor((localExpiryTime - nowTime) / (1000 * 60 * 60 * 24));
    Logger.log(`[AppStore] Modo offline válido. Días restantes: ${daysRemaining}`);

    let localStatus = localLicense.status || 'active';

    const expiryDate = localLicense.expires_at ? new Date(localLicense.expires_at).getTime() : null;
    const derivedGracePeriodEnd =
      localLicense.grace_period_ends ||
      (expiryDate
        ? new Date(
          expiryDate + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
        ).toISOString()
        : null);
    const graceDate = derivedGracePeriodEnd ? new Date(derivedGracePeriodEnd).getTime() : null;

    if (expiryDate && expiryDate < nowTime) {
      if (graceDate && graceDate > nowTime) {
        localStatus = 'grace_period';
        Logger.log('[AppStore] Licencia en PERÍODO DE GRACIA (offline)');
      } else {
        console.warn('[AppStore] Licencia expirada localmente');
        await clearLocalLicenseSession();
        set({ appStatus: 'unauthenticated' });
        return;
      }
    }

    const updatedLocalLicense = {
      ...localLicense,
      status: localStatus,
      grace_period_ends: derivedGracePeriodEnd || localLicense.grace_period_ends || null
    };

    set({
      licenseDetails: updatedLocalLicense,
      licenseStatus: localStatus,
      gracePeriodEnds: updatedLocalLicense.grace_period_ends || null,
      currentDeviceRole: updatedLocalLicense.device_role || 'admin',
      currentStaffUser: updatedLocalLicense.device_role === 'staff' ? updatedLocalLicense.staff_user || null : null
    });

    await get()._loadProfile(updatedLocalLicense.license_key);
  },

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
            currentStaffUser: recoveredData.device_role === 'staff' ? recoveredData.staff_user || null : null
          });
          await get()._loadProfile(licenseKey);
          return { success: true };
        }
      }

      return { success: false, message: result.message || 'Licencia no válida' };
    } catch (error) {
      Logger.error('Error en login:', error);
      return { success: false, message: error.message };
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
          product_name: rawData.product_name || 'Lanzo Trial',
          max_devices: rawData.max_devices || 1
        };
        await saveLicenseToStorage(licenseDataToSave);
        set({ licenseDetails: licenseDataToSave, appStatus: 'setup_required' });
        return { success: true };
      }
      return { success: false, message: result.error || 'No se pudo crear prueba.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  },

  handleStaffLogin: async ({ username, password }) => {
    const state = get();
    const licenseKey = state.staffLoginLicenseKey || state.licenseDetails?.license_key;

    if (!licenseKey) {
      return { success: false, message: 'No hay licencia para iniciar sesion staff.' };
    }

    const result = await staffLoginOnDevice({
      licenseKey,
      username,
      password
    });

    if (!result.success) {
      const isStaffAlreadyInUse = result.code === 'STAFF_ALREADY_IN_USE';
      const message = isStaffAlreadyInUse
        ? [
          'Este usuario staff ya está activo en otro dispositivo. Pide al administrador liberar ese dispositivo desde Configuración > Licencia y Rubros > Dispositivos.',
          result.active_device_name ? `Dispositivo activo: ${result.active_device_name}` : null
        ].filter(Boolean).join('\n')
        : result.message;

      set({
        appStatus: isStaffAlreadyInUse ? 'staff_login_required' : state.appStatus,
        currentDeviceRole: isStaffAlreadyInUse ? 'staff' : state.currentDeviceRole,
        currentStaffUser: isStaffAlreadyInUse ? null : state.currentStaffUser,
        staffLoginLicenseKey: licenseKey,
        staffLoginMessage: message,
        staffLoginError: {
          code: result.code || 'STAFF_LOGIN_FAILED',
          message,
          active_device_name: result.active_device_name || null,
          active_device_last_used_at: result.active_device_last_used_at || null,
          active_device_activated_at: result.active_device_activated_at || null
        }
      });

      return {
        success: false,
        code: result.code,
        message,
        active_device_name: result.active_device_name || null,
        active_device_last_used_at: result.active_device_last_used_at || null,
        active_device_activated_at: result.active_device_activated_at || null
      };
    }

    const licenseDataToSave = {
      ...state.licenseDetails,
      ...result.details,
      license_key: result.details?.license_key || licenseKey,
      valid: true,
      device_role: 'staff',
      staff_user: result.staff_user || result.details?.staff_user || null
    };

    await saveLicenseToStorage(licenseDataToSave);

    set({
      licenseDetails: licenseDataToSave,
      currentDeviceRole: 'staff',
      currentStaffUser: licenseDataToSave.staff_user,
      staffLoginLicenseKey: licenseKey,
      staffLoginMessage: null,
      staffLoginError: null
    });

    await get()._loadProfile(licenseKey);
    return { success: true };
  },

  logoutStaff: async () => {
    const licenseKey = get().licenseDetails?.license_key || get().staffLoginLicenseKey;
    await get().stopLicenseSync();
    await staffLogoutSession(licenseKey);

    set({
      appStatus: 'staff_login_required',
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      staffLoginLicenseKey: licenseKey || null,
      staffLoginMessage: 'Sesion staff cerrada.',
      staffLoginError: null
    });
  },

  logout: async () => {
    await get().stopLicenseSync();

    await clearLocalLicenseSession();

    // CORRECCIÓN 5: Añadidos serverHealth y serverMessage al reset del logout.
    // Sin esto, si el usuario cerraba sesión con un banner de error activo,
    // ese banner quedaba visible en la pantalla de login/bienvenida.
    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      licensePlanBlockInfo: null,
      companyProfile: null,
      profileImportCandidate: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      currentDeviceRole: null,
      currentStaffUser: null,
      staffLoginLicenseKey: null,
      staffLoginMessage: null,
      staffLoginError: null,
      realtimeSubscription: null,
      _isInitializingSecurity: false,
      _securityCleanupScheduled: false,
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      _isLicenseSyncChecking: false,
      serverHealth: 'ok',
      serverMessage: null
    });
  },

  verifySessionIntegrity: async () => {
    const { licenseDetails, logout } = get();

    if (!licenseDetails?.license_key) return false;

    if (navigator.onLine) {
      try {
        Logger.log('Verificando integridad de sesión con servidor...');

        const serverCheck = await revalidateLicense(licenseDetails.license_key);

        if (isLicensePlanBlockFailure(serverCheck)) {
          await get()._requireLicenseChange(licenseDetails, serverCheck);
          return false;
        }

        if (
          isStaffLoginRequiredFailure(serverCheck) ||
          (
            isStaffDeviceAuthorizationFailure(serverCheck) &&
            await hasStaffValidationContext(get(), licenseDetails)
          )
        ) {
          await get()._requireStaffLogin(licenseDetails, serverCheck);
          return false;
        }

        const now = new Date();
        const derivedGracePeriodEnd = deriveGracePeriodEnd(serverCheck, licenseDetails);
        const graceEnd = derivedGracePeriodEnd ? new Date(derivedGracePeriodEnd) : null;

        const isWithinGracePeriod = graceEnd && graceEnd > now;
        const isTechnicallyValid = serverCheck.valid || isWithinGracePeriod;

        // Usa 'has_updated_terms' (con 'd') — igual que _processServerValidation (corregido)
        if (serverCheck.legal_status?.has_updated_terms) {
          Logger.log('Nuevos términos detectados durante el uso.');
          set({ pendingTermsUpdate: serverCheck.legal_status });
        } else {
          set({ pendingTermsUpdate: null });
        }

        if (!isTechnicallyValid && serverCheck.reason !== 'offline_grace') {
          if (RENEWAL_REASONS.includes(serverCheck.reason)) {
            Logger.log('[Integrity] Licencia expirada. Activando pantalla de renovación.');

            const expiredDetails = {
              ...licenseDetails,
              ...serverCheck,
              valid: false,
              status: 'expired'
            };

            set({
              appStatus: 'locked_renewal',
              licenseStatus: 'expired',
              licenseDetails: expiredDetails,
              gracePeriodEnds: null
            });

            await saveLicenseToStorage(expiredDetails);
            return false;
          }

          if (isRecoverableValidationFailure(serverCheck)) {
            const reason = normalizeValidationCode(serverCheck);

            Logger.warn(
              '[Integrity] Validación recuperable; manteniendo sesión local:',
              reason
            );

            await get()._processOfflineMode(licenseDetails);

            set({
              serverHealth: 'degraded',
              serverMessage:
                'No se pudo completar la validación segura del dispositivo. ' +
                'La sesión local se conserva mientras se recupera el almacenamiento o la conexión.'
            });

            return false;
          }

          if (isFatalValidationFailure(serverCheck)) {
            Logger.warn('[Integrity] Fallo fatal de seguridad:', serverCheck.reason);
            await logout();
            return false;
          }

          Logger.warn(
            '[Integrity] Respuesta no concluyente del servidor; manteniendo sesión local:',
            serverCheck.reason || serverCheck.status || serverCheck.error
          );

          await get()._processOfflineMode(licenseDetails);
          return false;
        }

        let newStatus = serverCheck.status || serverCheck.reason || 'active';

        if (serverCheck.status === 'grace_period' || isWithinGracePeriod) {
          newStatus = 'grace_period';
        }

        const updatedDetails = {
          ...licenseDetails,
          ...serverCheck,
          grace_period_ends: derivedGracePeriodEnd,
          status: newStatus,
          valid: isTechnicallyValid
        };

        const hasChanges =
          JSON.stringify(licenseDetails.valid) !== JSON.stringify(updatedDetails.valid) ||
          licenseDetails.status !== updatedDetails.status ||
          licenseDetails.expires_at !== updatedDetails.expires_at ||
          licenseDetails.grace_period_ends !== updatedDetails.grace_period_ends ||
          licenseDetails.realtime_topic !== updatedDetails.realtime_topic ||
          licenseDetails.max_devices !== updatedDetails.max_devices ||
          licenseDetails.plan_code !== updatedDetails.plan_code ||
          licenseDetails.plan_name !== updatedDetails.plan_name ||
          licenseDetails.product_name !== updatedDetails.product_name ||
          licenseDetails.device_role !== updatedDetails.device_role ||
          JSON.stringify(licenseDetails.staff_user || null) !==
          JSON.stringify(updatedDetails.staff_user || null) ||
          JSON.stringify(licenseDetails.features || {}) !==
          JSON.stringify(updatedDetails.features || {});

        if (hasChanges) {
          Logger.log(`[Integrity] Sesión actualizada. Estado: ${newStatus}`);
          set({
            licenseStatus: newStatus,
            gracePeriodEnds: derivedGracePeriodEnd,
            licenseDetails: updatedDetails,
            currentDeviceRole: updatedDetails.device_role || 'admin',
            currentStaffUser: updatedDetails.device_role === 'staff' ? updatedDetails.staff_user || null : null
          });
          await saveLicenseToStorage(updatedDetails);
        }

        if (updatedDetails.valid) {
          await get()._loadProfile(licenseDetails.license_key);
          await get().refreshLicenseSyncMode('integrity');
        }
      } catch (error) {
        Logger.warn(
          'Verificación de integridad falló (error red/server), manteniendo sesión:',
          error
        );
      }
    }

    return true;
  }
});
