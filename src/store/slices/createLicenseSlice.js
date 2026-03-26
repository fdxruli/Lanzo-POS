import { checkInternetConnection, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import { renewLicenseService } from '../../services/licenseService';
import {
  activateLicense,
  revalidateLicense,
  createFreeTrial,
  deactivateCurrentDevice
} from '../../services/supabase';
import { startLicenseListener, stopLicenseListener } from '../../services/licenseRealtime';
import {
  saveLicenseToStorage,
  getLicenseFromStorage,
  clearLicenseFromStorage
} from '../../services/licenseStorage';

const FATAL_REASONS = [
  'banned',
  'deleted',
  'revoked',
  'device_limit_reached',
  'license_not_found',
  'invalid_license',
  'invalid'
];

const RENEWAL_REASONS = ['expired_subscription', 'LICENSE_EXPIRED', 'license_expired'];

export const createLicenseSlice = (set, get) => ({
  realtimeSubscription: null,
  _isInitializingSecurity: false,
  _securityCleanupScheduled: false,

  licenseStatus: 'active',
  gracePeriodEnds: null,
  licenseDetails: null,
  // CORRECCIÓN 1: Nombre unificado con 'a' (_isInitializing), eliminando el typo '_isInitilizing'
  // que existía en el monolito original y que hacía que la guardia anti-doble-ejecución no funcionara.
  _isInitializing: false,
  pendingTermsUpdate: null,

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
    await state.verifySessionIntegrity();
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
      await get()._processOfflineMode(localLicense);
      set({ _isInitializing: false });

      // CORRECCIÓN 2: Eliminada variable 'isRecentlyLoaded' que era código muerto
      // (se leía de sessionStorage pero nunca se usaba en ninguna condición).
      const lastCheck = sessionStorage.getItem('Lanzo_last_validation');
      const now = Date.now();

      const shouldValidate =
        navigator.onLine && (!lastCheck || now - parseInt(lastCheck) > 5 * 60 * 1000);

      if (shouldValidate) {
        get()._validateInBackground(localLicense.license_key);
      } else {
        Logger.log('[AppStore] Validación reciente detectada, omitiendo check.');
      }
    } catch (criticalError) {
      Logger.error('Error crítico inicializando:', criticalError);
      set({ appStatus: 'unauthenticated', _isInitializing: false });
    }
  },

  _validateInBackground: async (licenseKey) => {
    try {
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
      if (!localLicense) {
        Logger.warn('[Background] No hay licencia local para comparar.');
        return;
      }

      const criticalChanges = {
        validityChanged: serverValidation.valid !== localLicense.valid,
        statusChanged: serverValidation.status !== localLicense.status,
        wasRevoked:
          !serverValidation.valid &&
          ['banned', 'deleted', 'revoked'].includes(serverValidation.reason),
        needsRenewal:
          !serverValidation.valid &&
          ['expired_subscription', 'LICENSE_EXPIRED'].includes(serverValidation.reason)
      };

      if (criticalChanges.wasRevoked) {
        Logger.error('[Background] ALERTA CRÍTICA: Licencia revocada remotamente');

        showMessageModal(
          'LICENCIA REVOCADA\n\nTu licencia ha sido desactivada remotamente. La sesión se cerrará por seguridad.',
          async () => {
            await get().logout();
            window.location.reload();
          },
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

      if (criticalChanges.validityChanged || criticalChanges.statusChanged) {
        Logger.log('[Background] Cambios detectados en licencia, actualizando...');
        await get()._processServerValidation(serverValidation, localLicense);
      } else {
        Logger.log('[Background] Licencia validada sin cambios. Verificando perfil...');
        await get()._loadProfile(localLicense.license_key);
      }

      sessionStorage.setItem('Lanzo_app_loaded', Date.now().toString());
      sessionStorage.setItem('Lanzo_last_validation', Date.now().toString());
      set({ serverHealth: 'ok', serverMessage: null });
    } catch (error) {
      const isOnlineNow = await checkInternetConnection();
      if (isOnlineNow) {
        if (error.message === 'BACKGROUND_TIMEOUT') {
          Logger.warn('[Salud] Detectada latencia alta en Supabase');
          set({
            serverHealth: 'degraded',
            serverMessage:
              'Nuestros servidores están respondiendo más lento de lo normal. Tu licencia sigue activa en modo local.'
          });
        } else if (
          error.message?.includes('fetch') ||
          error.code === 'PGRST301' ||
          error.code?.startsWith('5')
        ) {
          Logger.warn('[Salud] Detectada caída en Supabase');
          set({
            serverHealth: 'down',
            serverMessage:
              'Estamos realizando mantenimiento en la base de datos. Algunas funciones online no estarán disponibles momentáneamente.'
          });
        }
      } else {
        set({ serverHealth: 'ok', serverMessage: null });
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
    const graceEnd = serverValidation.grace_period_ends
      ? new Date(serverValidation.grace_period_ends)
      : null;

    const isWithinGracePeriod = graceEnd && graceEnd > now;

    if (
      !serverValidation.valid &&
      serverValidation.reason !== 'offline_grace' &&
      !isWithinGracePeriod
    ) {
      if (FATAL_REASONS.includes(serverValidation.reason)) {
        Logger.warn('[AppStore] Licencia revocada fatalmente:', serverValidation.reason);
        clearLicenseFromStorage();
        set({
          appStatus: 'unauthenticated',
          licenseDetails: null,
          licenseStatus: serverValidation.reason || 'invalid'
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

    let finalStatus = serverValidation.reason || 'active';

    if (!serverValidation.valid && isWithinGracePeriod) {
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
      localExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    await saveLicenseToStorage(finalLicenseData);

    set({
      licenseDetails: finalLicenseData,
      licenseStatus: finalStatus,
      gracePeriodEnds: finalLicenseData.grace_period_ends || null
    });

    await get()._loadProfile(finalLicenseData.license_key);
  },

  _processOfflineMode: async (localLicense) => {
    const now = new Date();

    if (!localLicense.localExpiry) {
      console.log('[AppStore] localExpiry faltante, generando basado en activación...');

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
      clearLicenseFromStorage();
      set({ appStatus: 'unauthenticated' });
      return;
    }

    const daysRemaining = Math.floor((localExpiryTime - nowTime) / (1000 * 60 * 60 * 24));
    console.log(`[AppStore] Modo offline válido. Días restantes: ${daysRemaining}`);

    let localStatus = localLicense.status || 'active';

    const expiryDate = localLicense.expires_at ? new Date(localLicense.expires_at).getTime() : null;
    const graceDate = localLicense.grace_period_ends
      ? new Date(localLicense.grace_period_ends).getTime()
      : null;

    if (expiryDate && expiryDate < nowTime) {
      if (graceDate && graceDate > nowTime) {
        localStatus = 'grace_period';
        console.log('[AppStore] Licencia en PERÍODO DE GRACIA (offline)');
      } else {
        console.warn('[AppStore] Licencia expirada localmente');
        clearLicenseFromStorage();
        set({ appStatus: 'unauthenticated' });
        return;
      }
    }

    const updatedLocalLicense = { ...localLicense, status: localStatus };

    set({
      licenseDetails: updatedLocalLicense,
      licenseStatus: localStatus,
      gracePeriodEnds: localLicense.grace_period_ends || null
    });

    await get()._loadProfile(null);
  },

  startRealtimeSecurity: async () => {
    const state = get();

    if (state._isInitializingSecurity) {
      Logger.log('[Realtime] Ya hay inicialización en progreso');
      return;
    }

    if (!state.licenseDetails?.license_key) {
      Logger.warn('[Realtime] No hay licencia para monitorear');
      return;
    }

    const deviceFingerprint = localStorage.getItem('lanzo_device_id');
    if (!deviceFingerprint) {
      Logger.warn('[Realtime] No hay fingerprint del dispositivo');
      return;
    }

    set({ _isInitializingSecurity: true });

    try {
      if (state.realtimeSubscription) {
        await get().stopRealtimeSecurity();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const channel = startLicenseListener(state.licenseDetails.license_key, deviceFingerprint, {
        onLicenseChanged: async (_newLicenseData) => {
          Logger.log('[Realtime] Cambio en licencia detectado');
          await get().verifySessionIntegrity();
        },

        onDeviceChanged: (event) => {
          if (event.status === 'banned' || event.status === 'deleted') {
            Logger.warn('[Realtime] Dispositivo revocado');

            showMessageModal(
              'ACCESO REVOCADO: Tu dispositivo ha sido desactivado remotamente.',
              async () => {
                try {
                  await get().logout();
                } catch (e) {
                  console.error(e);
                } finally {
                  window.location.reload();
                }
              },
              {
                type: 'error',
                confirmButtonText: 'Entendido, salir',
                showCancel: false,
                isDismissible: false
              }
            );
          }
        },

        // CORRECCIÓN 4: Añadido callback onPermanentFailure.
        // Antes, licenseRealtime.js importaba useAppStore directamente (acoplamiento incorrecto).
        // Ahora el servicio notifica hacia arriba a través de este callback, sin conocer el store.
        onPermanentFailure: (message) => {
          get().reportServerFailure(message);
        }
      });

      set({ realtimeSubscription: channel });
      Logger.log('[Realtime] Seguridad iniciada');
    } catch (error) {
      Logger.error('[Realtime] Error inicializando seguridad:', error);
      set({ realtimeSubscription: null });
    } finally {
      set({ _isInitializingSecurity: false });
    }
  },

  stopRealtimeSecurity: async () => {
    const { realtimeSubscription, _securityCleanupScheduled } = get();

    if (!realtimeSubscription || _securityCleanupScheduled) return;

    set({ _securityCleanupScheduled: true });

    try {
      await stopLicenseListener(realtimeSubscription);
      Logger.log('[Realtime] Seguridad detenida');
    } catch (err) {
      Logger.warn('[Realtime] Error deteniendo listener:', err);
    } finally {
      set({
        realtimeSubscription: null,
        _securityCleanupScheduled: false
      });
    }
  },

  handleLogin: async (licenseKey) => {
    try {
      const result = await activateLicense(licenseKey);

      if (result.valid) {
        const licenseDataToSave = { ...result.details, valid: true };
        await saveLicenseToStorage(licenseDataToSave);
        set({ licenseDetails: licenseDataToSave });
        await get()._loadProfile(licenseKey);
        return { success: true };
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
          set({ licenseDetails: recoveredData });
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

  logout: async () => {
    const { licenseDetails } = get();

    await get().stopRealtimeSecurity();

    try {
      if (licenseDetails?.license_key) {
        await deactivateCurrentDevice(licenseDetails.license_key);
      }
    } catch (error) {
      Logger.warn('Error desactivando dispositivo:', error);
    }

    clearLicenseFromStorage();

    // CORRECCIÓN 5: Añadidos serverHealth y serverMessage al reset del logout.
    // Sin esto, si el usuario cerraba sesión con un banner de error activo,
    // ese banner quedaba visible en la pantalla de login/bienvenida.
    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      realtimeSubscription: null,
      _isInitializingSecurity: false,
      _securityCleanupScheduled: false,
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

        const now = new Date();
        const graceEnd = serverCheck.grace_period_ends
          ? new Date(serverCheck.grace_period_ends)
          : null;

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

          Logger.warn('[Integrity] Fallo fatal de seguridad:', serverCheck.reason);
          await logout();
          return false;
        }

        let newStatus = serverCheck.status || serverCheck.reason || 'active';

        if (isWithinGracePeriod && !serverCheck.valid) {
          newStatus = 'grace_period';
        }

        const updatedDetails = {
          ...licenseDetails,
          ...serverCheck,
          status: newStatus,
          valid: isTechnicallyValid
        };

        const hasChanges =
          JSON.stringify(licenseDetails.valid) !== JSON.stringify(updatedDetails.valid) ||
          licenseDetails.status !== updatedDetails.status;

        if (hasChanges) {
          Logger.log(`[Integrity] Sesión actualizada. Estado: ${newStatus}`);
          set({
            licenseStatus: newStatus,
            gracePeriodEnds: serverCheck.grace_period_ends,
            licenseDetails: updatedDetails
          });
          await saveLicenseToStorage(updatedDetails);
        }

        if (updatedDetails.valid) {
          await get()._loadProfile(licenseDetails.license_key);
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