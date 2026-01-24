import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
import { isLocalStorageEnabled, normalizeDate, showMessageModal, safeLocalStorageSet } from '../services/utils';
import Logger from '../services/Logger';
import { renewLicenseService } from '../services/licenseService';

import {
  activateLicense,
  revalidateLicense,
  getBusinessProfile,
  saveBusinessProfile,
  createFreeTrial,
  uploadFile,
  deactivateCurrentDevice
} from '../services/supabase';

import { startLicenseListener, stopLicenseListener } from '../services/licenseRealtime';

const _ui_render_config_v2 = import.meta.env.VITE_LICENSE_SALT;

const FATAL_REASONS = ['banned', 'deleted', 'revoked', 'device_limit_reached','license_not_found', 'invalid_license', 'invalid'];

const RENEWAL_REASONS = ['expired_subscription', 'LICENSE_EXPIRED', 'license_expired'];

// === HELPERS (Sin cambios) ===
const stableStringify = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return JSON.stringify(obj.map(item =>
      typeof item === 'object' && item !== null
        ? JSON.parse(stableStringify(item))
        : item
    ));
  }

  const sortedKeys = Object.keys(obj).sort();
  const sortedObj = sortedKeys.reduce((result, key) => {
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      result[key] = JSON.parse(stableStringify(value));
    } else {
      result[key] = value;
    }
    return result;
  }, {});

  return JSON.stringify(sortedObj);
};

const generateSignature = (data) => {
  const stringData = stableStringify(data);
  let hash = 0;
  if (stringData.length === 0) return hash;
  const mixedString = stringData + _ui_render_config_v2;
  for (let i = 0; i < mixedString.length; i++) {
    const char = mixedString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
};

const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };

  // Aseguramos que siempre tenga localExpiry al guardar
  if (!dataToStore.localExpiry) {
    dataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const signature = generateSignature(dataToStore);
  const packageToStore = { data: dataToStore, signature };
  const saved = safeLocalStorageSet('lanzo_license', JSON.stringify(packageToStore));

  if (!saved) {
    Logger.warn("No se pudo persistir la licencia por falta de espacio.");
  }
};

const getLicenseFromStorage = async () => {
  if (!isLocalStorageEnabled()) return null;
  const storedString = localStorage.getItem('lanzo_license');
  if (!storedString) return null;

  try {
    const parsedPackage = JSON.parse(storedString);
    if (!parsedPackage.data || !parsedPackage.signature) {
      return null;
    }

    const expectedSignature = generateSignature(parsedPackage.data);

    if (parsedPackage.signature !== expectedSignature) {
      Logger.warn("⚠️ La firma local no coincide. Posible actualización de versión.");
      // NOTA: Esto está bien, permitimos que pase la data aunque la firma falle
      // para soportar actualizaciones donde cambia el algoritmo de firma.
      return parsedPackage.data;
    }

    return parsedPackage.data;
  } catch (e) {
    Logger.error("Error leyendo licencia local:", e);
    // === CAMBIO: NO BORRAR AQUI ===
    // localStorage.removeItem('lanzo_license'); <--- COMENTAR O BORRAR ESTA LÍNEA
    // Si borramos aquí, un error tonto de lectura desloguea al usuario.
    // Mejor retornar null y pedir login, pero los datos siguen ahí por si acaso.
    return null;
  }
};

const clearLicenseFromStorage = () => {
  if (!isLocalStorageEnabled()) return;
  localStorage.removeItem('lanzo_license');
};

export const useAppStore = create((set, get) => ({
  realtimeSubscription: null,
  _isInitializingSecurity: false,
  _securityCleanupScheduled: false,

  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,
  _isInitilizing: false,
  pendingTermsUpdate: null,

  // === initializeApp ===
  initializeApp: async () => {
    if (get()._isInitializing) {
      Logger.warn('⏳ initializeApp ya está en ejecución, saltando...');
      return;
    }

    set({ _isInitializing: true });
    Logger.log('🔄 [AppStore] Iniciando aplicación...');

    try {
      const localLicense = await getLicenseFromStorage();

      if (!localLicense?.license_key) {
        set({ appStatus: 'unauthenticated' });
        return;
      }

      const isRecentlyLoaded = sessionStorage.getItem('Lanzo_app_loaded');

      if (navigator.onLine && !isRecentlyLoaded) {
        try {
          const serverValidation = await revalidateLicense(localLicense.license_key);

          if (serverValidation?.valid !== undefined) {
            await get()._processServerValidation(serverValidation, localLicense);
            sessionStorage.setItem('lanzo_app_loaded', Date.now().toString());
            set({ _isInitializing: false });
            return;
          }
        } catch (validationError) {
          Logger.warn('⚠️ Validación falló, usando caché:', validationError);
        }
      }

      await get()._processOfflineMode(localLicense);
      set({ _isInitializing: false });

    } catch (criticalError) {
      Logger.error('💥 Error crítico inicializando:', criticalError);
      set({ appStatus: 'unauthenticated', _isInitializing: false });
    }
  },

  // === Renovar licencia ===
  renewLicense: async () => {
    const { licenseDetails } = get();
    if (!licenseDetails?.license_key) {
        return { success: false, message: 'No hay licencia para renovar' };
    }

    Logger.log("📡 Solicitando renovación de licencia...");

    // Llamamos al servicio real
    const result = await renewLicenseService(licenseDetails.license_key);

    if (result.success) {
        Logger.log("✅ Renovación exitosa. Actualizando estado local...");

        // Construimos el objeto actualizado
        const updatedLicense = {
            ...licenseDetails,
            expires_at: result.newExpiry, // Actualizamos fecha
            status: result.status,        // Actualizamos estado (active)
            valid: true,
            // Importante: Renovamos el caché offline también
            localExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };

        // 1. Actualizar estado en memoria (React reacciona aquí)
        set({
            licenseDetails: updatedLicense,
            licenseStatus: result.status, // 'active'
            appStatus: 'ready',           // Desbloquea la pantalla
            gracePeriodEnds: null         // Limpiamos cualquier gracia previa
        });

        // 2. Persistir en disco (Para que F5 no bloquee de nuevo)
        await saveLicenseToStorage(updatedLicense);

        return { success: true, message: result.message };
    } else {
        Logger.warn("⚠️ Fallo la renovación:", result.message);
        return { success: false, message: result.message };
    }
},

  // === _processServerValidation ===
  _processServerValidation: async (serverValidation, localLicense) => {
    const now = new Date();
    const graceEnd = serverValidation.grace_period_ends
      ? new Date(serverValidation.grace_period_ends)
      : null;

    const isWithinGracePeriod = graceEnd && graceEnd > now;

    if (!serverValidation.valid &&
      serverValidation.reason !== 'offline_grace' &&
      !isWithinGracePeriod) {

      // Verificamos si es un error fatal antes de borrar
      if (FATAL_REASONS.includes(serverValidation.reason)) {
        Logger.warn('🚫 [AppStore] Licencia revocada fatalmente:', serverValidation.reason);
        clearLicenseFromStorage();
        set({
          appStatus: 'unauthenticated',
          licenseDetails: null,
          licenseStatus: serverValidation.reason || 'invalid'
        });
        return;
      } 
      else if (RENEWAL_REASONS.includes(serverValidation.reason)) {
         Logger.warn('🔒 [AppStore] Licencia expirada. Bloqueando pantalla...');
         await get()._loadProfile(localLicense.license_key);
         set({
            appStatus: 'locked_renewal', 
            licenseStatus: 'expired',
            licenseDetails: { ...localLicense, valid: false, status: 'expired' } 
         });
         return;
      }
       else {
        // === FALLO SUAVE (SOFT FAIL) ===
        // Si el servidor dice "invalid" pero no es fatal (ej. error de formato tras update),
        // ignoramos al servidor y mantenemos la sesión local (Modo Offline forzado).
        Logger.warn('⚠️ [AppStore] Validación fallida (posible error post-update). Manteniendo sesión local.');

        // Tratamos la licencia como si estuviéramos offline
        await get()._processOfflineMode(localLicense);
        return;
      }
    }

    let finalStatus = serverValidation.reason || 'active';

    if (!serverValidation.valid && isWithinGracePeriod) {
      finalStatus = 'grace_period';
      Logger.log('⏰ [AppStore] Licencia en PERÍODO DE GRACIA');
    }

    if (serverValidation.legal_status?.has_update_terms) {
      Logger.log("Terminos actualizados detectados:", serverValidation.legal_status);
      set({ pendingTermsUpdate: serverValidation.legal_status });
    } else {
      set({ pendingTermsUpdate: null });
    }

    const finalLicenseData = {
      ...localLicense,
      ...serverValidation,
      valid: true,
      status: finalStatus,
      // Renovamos el periodo offline al conectar con éxito
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

  // === 🆕 HELPER: Procesar Modo Offline (CORREGIDO) ===
  _processOfflineMode: async (localLicense) => {
    const now = new Date();

    // A) Sanear/Generar localExpiry si falta (Retrocompatibilidad crítica)
    if (!localLicense.localExpiry) {
      console.log("⚠️ [AppStore] localExpiry faltante, generando basado en activación...");

      const baseDate = localLicense.activated_at
        ? new Date(localLicense.activated_at)
        : now;

      const expiryDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      localLicense.localExpiry = expiryDate.toISOString();

      await saveLicenseToStorage(localLicense);
    }

    // ✅ CORRECCIÓN: Convertir ambas fechas a milisegundos para comparación confiable
    const localExpiryTime = new Date(localLicense.localExpiry).getTime();
    const nowTime = now.getTime();

    // B) Validación Estricta de Expiración
    if (localExpiryTime <= nowTime) {
      console.warn('🕐 [AppStore] Caché local expirado (30 días sin conexión)');
      console.warn(`Fecha de expiración: ${localLicense.localExpiry}`);
      console.warn(`Fecha actual: ${now.toISOString()}`);
      clearLicenseFromStorage();
      set({ appStatus: 'unauthenticated' });
      return;
    }

    // Agregar log informativo sobre días restantes
    const daysRemaining = Math.floor((localExpiryTime - nowTime) / (1000 * 60 * 60 * 24));
    console.log(`✅ [AppStore] Modo offline válido. Días restantes: ${daysRemaining}`);

    // C) Calcular estado basado en fechas locales
    let localStatus = localLicense.status || 'active';

    // Convertir fechas de licencia también a timestamps
    const expiryDate = localLicense.expires_at
      ? new Date(localLicense.expires_at).getTime()
      : null;
    const graceDate = localLicense.grace_period_ends
      ? new Date(localLicense.grace_period_ends).getTime()
      : null;

    // D) Verificar si expiró localmente (fecha de suscripción, no de caché offline)
    if (expiryDate && expiryDate < nowTime) {
      if (graceDate && graceDate > nowTime) {
        localStatus = 'grace_period';
        console.log('⏰ [AppStore] Licencia en PERÍODO DE GRACIA (offline)');
      } else {
        console.warn('🚫 [AppStore] Licencia expirada localmente');
        clearLicenseFromStorage();
        set({ appStatus: 'unauthenticated' });
        return;
      }
    }

    // E) Licencia válida en modo offline
    const updatedLocalLicense = { ...localLicense, status: localStatus };

    set({
      licenseDetails: updatedLocalLicense,
      licenseStatus: localStatus,
      gracePeriodEnds: localLicense.grace_period_ends || null
    });

    await get()._loadProfile(null); // null = modo offline
  },

  // === _loadProfile (Sin cambios) ===
  _loadProfile: async (licenseKey) => {
    let companyData = null;

    if (licenseKey && navigator.onLine) {
      try {
        const profileResult = await getBusinessProfile(licenseKey);

        if (profileResult.success && profileResult.data) {
          companyData = {
            id: 'company',
            name: profileResult.data.business_name || profileResult.data.name,
            phone: profileResult.data.phone_number || profileResult.data.phone,
            address: profileResult.data.address,
            logo: profileResult.data.logo_url || profileResult.data.logo,
            business_type: profileResult.data.business_type
          };
          await saveData(STORES.COMPANY, companyData);
        }
      } catch (e) {
        Logger.warn('⚠️ [AppStore] Fallo carga perfil online:', e);
      }
    }

    if (!companyData) {
      try {
        companyData = await loadData(STORES.COMPANY, 'company');
      } catch (e) {
        Logger.warn('⚠️ [AppStore] Fallo carga perfil local:', e);
      }
    }

    set({ companyProfile: companyData });

    if (companyData && (companyData.name || companyData.business_name)) {
      Logger.log('✅ [AppStore] Aplicación lista (ready)');
      set({ appStatus: 'ready' });
    } else {
      Logger.log('⚙️ [AppStore] Requiere configuración inicial');
      set({ appStatus: 'setup_required' });
    }
  },

  startRealtimeSecurity: async () => {
    const state = get();

    if (state._isInitializingSecurity) {
      Logger.log('⏳ [Realtime] Ya hay inicialización en progreso');
      return;
    }

    if (!state.licenseDetails?.license_key) {
      Logger.warn('⚠️ [Realtime] No hay licencia para monitorear');
      return;
    }

    const deviceFingerprint = localStorage.getItem('lanzo_device_id');
    if (!deviceFingerprint) {
      Logger.warn('⚠️ [Realtime] No hay fingerprint del dispositivo');
      return;
    }

    set({ _isInitializingSecurity: true });

    try {
      if (state.realtimeSubscription) {
        await get().stopRealtimeSecurity();
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const channel = startLicenseListener(
        state.licenseDetails.license_key,
        deviceFingerprint,
        {
          onLicenseChanged: async (newLicenseData) => {
            Logger.log("🔔 [Realtime] Cambio en licencia detectado");
            await get().verifySessionIntegrity();
          },

          onDeviceChanged: (event) => {
                if (event.status === 'banned' || event.status === 'deleted') {
                    Logger.warn('🚫 [Realtime] Dispositivo revocado');
                    
                    showMessageModal(
                        '🚫 ACCESO REVOCADO: Tu dispositivo ha sido desactivado remotamente.',
                        async () => { // Hacemos esta función ASYNC
                            try {
                                // 1. Intentamos cerrar sesión limpiamente y ESPERAMOS
                                await get().logout(); 
                            } catch (e) {
                                console.error(e);
                            } finally {
                                // 2. Solo después de intentar, recargamos
                                window.location.reload();
                            }
                        },
                        { 
                            type: 'error', 
                            confirmButtonText: 'Entendido, salir',
                            showCancel: false, // Importante: que no puedan cancelar
                            isDismissible: false // Importante: que no puedan cerrar clicando fuera
                        }
                    );
                }
            }
        }
      );

      set({ realtimeSubscription: channel });
      Logger.log('✅ [Realtime] Seguridad iniciada');

    } catch (error) {
      Logger.error('❌ [Realtime] Error inicializando seguridad:', error);
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
      Logger.log('🔕 [Realtime] Seguridad detenida');
    } catch (err) {
      Logger.warn('⚠️ [Realtime] Error deteniendo listener:', err);
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
      if (!result.valid && (errorMsg.includes('limit') || errorMsg.includes('active') || errorMsg.includes('device'))) {

        Logger.log("⚠️ Dispositivo ya registrado. Intentando recuperar sesión...");

        const revalidate = await revalidateLicense(licenseKey);

        if (revalidate.valid) {
          Logger.log("✅ Sesión recuperada exitosamente.");

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
      Logger.error("Error en login:", error);
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

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;

    try {
      let logoUrl = null;
      if (setupData.logo instanceof File) {
        logoUrl = await uploadFile(setupData.logo, 'logo');
      }

      const profileData = { ...setupData, logo: logoUrl };
      await saveBusinessProfile(licenseKey, profileData);

      const companyData = { id: 'company', ...profileData };
      await saveData(STORES.COMPANY, companyData);

      set({ companyProfile: companyData, appStatus: 'ready' });
    } catch (error) {
      Logger.error('Error en setup:', error);
    }
  },

  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;

    try {
      if (companyData.logo instanceof File) {
        const logoUrl = await uploadFile(companyData.logo, 'logo');
        companyData.logo = logoUrl;
      }

      await saveBusinessProfile(licenseKey, companyData);
      await saveData(STORES.COMPANY, companyData);
      set({ companyProfile: companyData });
    } catch (error) {
      Logger.error('Error actualizando perfil:', error);
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

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      realtimeSubscription: null,
      _isInitializingSecurity: false,
      _securityCleanupScheduled: false
    });
  },

  verifySessionIntegrity: async () => {
    // 1. Obtenemos estado actual y funciones auxiliares
    const { licenseDetails, logout } = get();

    // 2. Validación básica: Si no hay llave, no hay sesión que verificar
    if (!licenseDetails?.license_key) return false;

    // 3. Solo verificamos con el servidor si hay conexión estable
    // (Si no hay internet, confiamos en la validación offline que se hizo al inicio)
    if (navigator.onLine) {
      try {
        Logger.log("🛡️ Verificando integridad de sesión con servidor...");
        
        // Llamada a Supabase
        const serverCheck = await revalidateLicense(licenseDetails.license_key);

        // Cálculos de fechas para periodo de gracia
        const now = new Date();
        const graceEnd = serverCheck.grace_period_ends
          ? new Date(serverCheck.grace_period_ends)
          : null;
        
        // Es válido si el servidor dice TRUE o si estamos dentro del tiempo de gracia
        const isWithinGracePeriod = graceEnd && graceEnd > now;
        const isTechnicallyValid = serverCheck.valid || isWithinGracePeriod;

        if (serverCheck.legal_status?.has_updated_terms) {
             Logger.log("📜 Nuevos términos detectados durante el uso.");
             // Esto hará que el modal aparezca inmediatamente sin recargar
             set({ pendingTermsUpdate: serverCheck.legal_status });
        } else {
             // Si ya no hay actualización pendiente (ej. aceptó en otra pestaña), limpiamos
             set({ pendingTermsUpdate: null });
        }

        // === LÓGICA DE DETECCIÓN DE PROBLEMAS ===

        // CASO A: La licencia NO es válida y NO estamos en gracia
        if (!isTechnicallyValid && serverCheck.reason !== 'offline_grace') {

          // A.1: ¿Es por falta de pago (Expirada)? -> BLOQUEAR PANTALLA
          if (RENEWAL_REASONS.includes(serverCheck.reason)) {
            Logger.log("🔒 [Integrity] Licencia expirada. Activando pantalla de renovación.");

            const expiredDetails = {
              ...licenseDetails,
              ...serverCheck,
              valid: false,
              status: 'expired'
            };

            // 1. Actualizamos estado para mostrar RenewalModal inmediatamente
            set({
              appStatus: 'locked_renewal',
              licenseStatus: 'expired',
              licenseDetails: expiredDetails,
              gracePeriodEnds: null // Se acabó la gracia
            });

            // 2. Guardamos en disco para que si recarga (F5), siga bloqueado y no vaya al Welcome
            await saveLicenseToStorage(expiredDetails);

            return false; // La sesión ya no es válida para operar
          }

          // A.2: ¿Es un motivo fatal (Ban, Robo, Dispositivo eliminado)? -> CERRAR SESIÓN
          Logger.warn("🚫 [Integrity] Fallo fatal de seguridad:", serverCheck.reason);
          await logout();
          return false;
        }

        // === CASO B: TODO CORRECTO (O en gracia) ===
        
        let newStatus = serverCheck.status || serverCheck.reason || 'active';

        // Ajuste visual para el estado de gracia
        if (isWithinGracePeriod && !serverCheck.valid) {
          newStatus = 'grace_period';
        }

        const updatedDetails = {
          ...licenseDetails,
          ...serverCheck,
          status: newStatus,
          valid: isTechnicallyValid
        };

        // Actualizamos el store y localStorage solo si cambiaron datos críticos
        // (para evitar re-renders innecesarios en React)
        const hasChanges = 
            JSON.stringify(licenseDetails.valid) !== JSON.stringify(updatedDetails.valid) ||
            licenseDetails.status !== updatedDetails.status;

        if (hasChanges) {
          Logger.log(`✅ [Integrity] Sesión actualizada. Estado: ${newStatus}`);
          set({
            licenseStatus: newStatus,
            gracePeriodEnds: serverCheck.grace_period_ends,
            licenseDetails: updatedDetails
          });
          await saveLicenseToStorage(updatedDetails);
        }

      } catch (error) {
        // Fall-back: Si falla la red o el servidor da error 500 durante la verificación,
        // NO cerramos la sesión del usuario. Asumimos que "sigue siendo válida" hasta nuevo aviso.
        Logger.warn("⚠️ Verificación de integridad falló (error red/server), manteniendo sesión:", error);
      }
    }

    return true; // La sesión se mantiene viva
  },
}));