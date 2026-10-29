import { loadBootstrapProfile } from '../../../services/bootstrap/bootstrapLifecycle';
// src/store/slices/license/licenseBackgroundValidationActions.js

import { checkInternetConnection, showMessageModal } from '../../../services/utils';
import Logger from '../../../services/Logger';
import { classifyActorAuthorityError } from '../../../services/auth/actorAuthorityErrors';
import { getActorAuthorityRecoverySnapshot, reportActorAuthorityError } from '../../../services/auth/actorAuthorityRecovery';
import { actorRuntimeController, ACTOR_RUNTIME_STATUS } from '../../../services/auth/actorRuntimeController';
import { lockActorRuntime } from '../../../services/auth/actorSessionRuntimeBridge';

import {
  revalidateLicense
} from '../../../services/supabase';

import {
  saveLicenseToStorage,
  getLicenseFromStorage
} from '../../../services/licenseStorage';

import {
  getLicenseSyncMode,
  normalizeValidationCode,
  isFatalValidationFailure,
  isStaffDeviceAuthorizationFailure,
  isLicensePlanBlockFailure
} from './licenseGuards';

import {
  markLastLicenseValidationAttempt,
  markLastLicenseValidationSuccess,
  shouldSkipRemoteValidationForPlan,
  shouldSkipRemoteValidationAfterFailure
} from './licenseValidationTimestamps';
import {
  createEffectiveLicenseValidationEvidence,
  shouldReplaceEffectiveLicenseValidationEvidence
} from '../../../utils/licenseStatusPresentation';
import {
  assertLicenseValidationContextCurrent,
  captureLicenseValidationContext,
  isLicenseValidationContextStaleError,
  persistWithinLicenseValidationContext
} from './licenseValidationContext';

export const createLicenseBackgroundValidationActions = ({
  set,
  get,
  clearLocalLicenseSession,
  hasStaffValidationContext
}) => ({
  _validateInBackground: (licenseKey, options = {}) => {
    const lifecycle = options?.lifecycle;
    const validate = async () => {
    const loadBackgroundProfile = (key, profileOptions) => loadBootstrapProfile(
      get()._loadProfile, key, profileOptions, lifecycle, 'background_profile_nested_work'
    );
    let validationContext = null;
    let timeoutId;
    const assertCurrentContext = () => {
      lifecycle?.assertCurrent();
      if (validationContext) assertLicenseValidationContextCurrent(validationContext, get());
    };
    const { refreshProfile = false, reason = 'background' } = options || {};
    const initialState = get();
    const requestActorState = actorRuntimeController.getState();
    const requestLicenseKey = initialState.licenseDetails?.license_key;
    const validationContextChanged = () => (
      get().appStatus !== 'ready' ||
      get().licenseDetails?.license_key !== requestLicenseKey ||
      (requestActorState.status === ACTOR_RUNTIME_STATUS.GRANTED &&
        requestActorState.generation !== actorRuntimeController.getState().generation)
    );

    const clearRejectedLicense = async (validation) => {
      lockActorRuntime('license_validation_fatal');
      const invalidationContext = captureLicenseValidationContext(get(), licenseKey);
      try { await clearLocalLicenseSession(); } catch {
        Logger.warn('[Background] No se pudo completar la salida; el acceso permanece bloqueado.');
      }
      assertLicenseValidationContextCurrent(invalidationContext, get());
      set({
        appStatus: 'unauthenticated', licenseDetails: null,
        licenseStatus: normalizeValidationCode(validation) || 'invalid',
        companyProfile: null, profileImportCandidate: null, pendingTermsUpdate: null
      });
      Logger.error('[Background] Licencia remota no disponible:', normalizeValidationCode(validation));
      showMessageModal(
        'LICENCIA NO DISPONIBLE\n\nLa licencia local ya no existe o fue desactivada en el servidor. Ingresa una licencia valida para continuar.',
        null,
        { type: 'error', confirmButtonText: 'Entendido', showCancel: false, isDismissible: false }
      );
    };

    const denyHardAuthority = async (error, classification) => {
      reportActorAuthorityError(error, { operation: reason });
      await clearRejectedLicense({ reason: classification.code });
    };

    try {
      if (initialState.appStatus !== 'ready' || getActorAuthorityRecoverySnapshot()) {
        Logger.log('[Background] La sesión no está lista; se conserva la pantalla actual.');
        return;
      }

      validationContext = captureLicenseValidationContext(initialState, licenseKey);
      assertCurrentContext();

      const localLicenseBeforeValidation = await getLicenseFromStorage();
      if (validationContextChanged()) return;

      assertCurrentContext();
      if (get().appStatus !== 'ready') return;
      const licenseDetails = initialState.licenseDetails || localLicenseBeforeValidation || {
        license_key: licenseKey
      };
      const mode = initialState.licenseSyncMode || getLicenseSyncMode(licenseDetails);

      if (shouldSkipRemoteValidationForPlan({ licenseDetails, licenseStatus: initialState.licenseStatus, mode, reason })) {
        Logger.log(`[Background] Validación remota omitida por TTL exitoso de plan (${reason}).`);

        if (!get().companyProfile) {
          await loadBackgroundProfile(licenseKey, {
            refreshProfile: false,
            profileLoadMode: 'background',
            reason: `background_cached_${reason}`
          });
        }

        return;
      }

      if (shouldSkipRemoteValidationAfterFailure({ licenseDetails, reason })) {
        Logger.log(`[Background] Validación remota omitida por cooldown corto de error (${reason}).`);

        if (!get().companyProfile) {
          await loadBackgroundProfile(licenseKey, {
            refreshProfile: false,
            profileLoadMode: 'background',
            reason: `background_error_cooldown_${reason}`
          });
        }

        return;
      }

      assertCurrentContext();
      Logger.log(`[Background] Iniciando validación silenciosa (${reason})...`);

      markLastLicenseValidationAttempt(licenseKey);

      const BACKGROUND_TIMEOUT = 8000;
      const startValidation = () => revalidateLicense(licenseKey, {
        beforePersist: assertCurrentContext,
        bootstrapLifecycle: lifecycle
      });
      const validationPromise = lifecycle ? lifecycle.track(startValidation) : startValidation();
      const timeoutPromise = new Promise((_, reject) =>
        { timeoutId = setTimeout(() => reject(new Error('BACKGROUND_TIMEOUT')), BACKGROUND_TIMEOUT); }
      );

      const serverValidation = await Promise.race([
        validationPromise,
        timeoutPromise
      ]);
      assertCurrentContext();
      if (get().appStatus !== 'ready') return;
      if (validationContextChanged()) return;

      const authorityFailure = classifyActorAuthorityError(serverValidation);
      if (authorityFailure?.kind === 'device_blocked' || authorityFailure?.kind === 'cloning_detected') {
        await denyHardAuthority(serverValidation, authorityFailure);
        return;
      }
      if (authorityFailure?.requiresReauthentication) {
        if (get()._requireActorAuthorityRecovery) {
          await get()._requireActorAuthorityRecovery(serverValidation, { operation: reason });
        } else {
          reportActorAuthorityError(serverValidation, { operation: reason });
        }
        return;
      }

      if (!serverValidation?.valid && serverValidation?.valid !== false) {
        Logger.warn('[Background] Respuesta inválida del servidor; no se marca success.');
        return;
      }

      // An offline cache is useful to preserve operations, but it is not a new
      // server confirmation and must not replace lifecycle evidence or refresh
      // the remote-validation TTL.
      if (serverValidation.is_fallback === true) {
        Logger.log('[Background] Respuesta fallback; se conserva la evidencia confirmada anterior.');
        return;
      }

      const localLicense = localLicenseBeforeValidation || await getLicenseFromStorage();
      if (validationContextChanged()) return;
      assertCurrentContext();
      const activeLicenseKey = get().licenseDetails?.license_key;
      if (
        (localLicense?.license_key &&
          String(localLicense.license_key).trim() !== String(licenseKey || '').trim()) ||
        String(activeLicenseKey || '').trim() !== String(licenseKey || '').trim() ||
        (serverValidation.license_key &&
          String(serverValidation.license_key).trim() !== String(licenseKey).trim()) ||
        (serverValidation.license_id && localLicense.license_id &&
          String(serverValidation.license_id).trim().toLowerCase() !== String(localLicense.license_id).trim().toLowerCase())
      ) {
        Logger.warn('[Background] Respuesta descartada; la identidad de licencia cambió durante la validación.');
        return;
      }

      markLastLicenseValidationSuccess(licenseKey);

      const sourceLicense = localLicense || get().licenseDetails || {
        license_key: licenseKey
      };

      if (isLicensePlanBlockFailure(serverValidation)) {
        assertCurrentContext();
        await get()._requireLicenseChange(sourceLicense, serverValidation);
        return;
      }

      if (!localLicense) {
        Logger.warn('[Background] No hay licencia local para comparar.');
        return;
      }

      if (get().appStatus !== 'ready') {
        Logger.log('[Background] La sesión cambió tras validar; no se fuerza salida.');
        return;
      }

      assertCurrentContext();
      const storeLicenseStatus = get().licenseStatus;
      const serverLifecycleStatus = serverValidation.lifecycle_state ||
        serverValidation.status || serverValidation.reason || 'active';
      const storedLifecycleEvidence = localLicense?.effective_lifecycle_validation;
      const currentLifecycleEvidence = get().licenseDetails?.effective_lifecycle_validation;
      const nextLifecycleEvidence = createEffectiveLicenseValidationEvidence(
        serverValidation,
        { effectiveStatus: serverLifecycleStatus }
      );
      const effectiveEvidenceChanged =
        shouldReplaceEffectiveLicenseValidationEvidence(storedLifecycleEvidence, nextLifecycleEvidence) ||
        shouldReplaceEffectiveLicenseValidationEvidence(currentLifecycleEvidence, nextLifecycleEvidence);

      const criticalChanges = {
        validityChanged: serverValidation.valid !== localLicense.valid,
        statusChanged: serverLifecycleStatus !== localLicense.status,
        storeStatusChanged: storeLicenseStatus !== serverLifecycleStatus,
        effectiveEvidenceChanged,
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
        if (isStaffDeviceAuthorizationFailure(serverValidation)) {
          const requiresStaffLogin = await hasStaffValidationContext(get(), localLicense);
          assertCurrentContext();
          if (requiresStaffLogin) {
            await get()._requireStaffLogin(localLicense, serverValidation);
            return;
          }
        }

        assertCurrentContext();
        lockActorRuntime('license_validation_fatal');
        const invalidationContext = captureLicenseValidationContext(get(), licenseKey);
        await clearLocalLicenseSession();
        assertLicenseValidationContextCurrent(invalidationContext, get());

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
        Logger.warn('[Background] Fin de gracia detectado; esperando confirmación del handoff a Lanzo Local');

        const expiredEvidence = createEffectiveLicenseValidationEvidence(
          { ...serverValidation, valid: false },
          { effectiveStatus: 'expired' }
        );
        const expiredDetails = {
          ...localLicense,
          ...serverValidation,
          valid: false,
          status: 'expired',
          ...(expiredEvidence ? { effective_lifecycle_validation: expiredEvidence } : {})
        };

        assertCurrentContext();
        lockActorRuntime('license_renewal_required');
        const renewalContext = captureLicenseValidationContext(get(), licenseKey);
        await persistWithinLicenseValidationContext(
          renewalContext,
          get,
          () => saveLicenseToStorage(expiredDetails)
        );
        assertLicenseValidationContextCurrent(renewalContext, get());

        set({
          appStatus: 'locked_renewal',
          licenseStatus: 'expired',
          licenseDetails: expiredDetails,
          gracePeriodEnds: null
        });

        showMessageModal(
          'Tu período de gracia terminó.\n\nEstamos confirmando la actualización a Lanzo Local. Si el servidor no responde, podrás reintentar sin borrar tus datos locales.',
          null,
          { type: 'warning' }
        );

        return;
      }

      if (
        criticalChanges.validityChanged ||
        criticalChanges.statusChanged ||
        criticalChanges.storeStatusChanged ||
        criticalChanges.effectiveEvidenceChanged ||
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
        assertCurrentContext();
        Logger.log('[Background] Cambios detectados en licencia, actualizando...');
        await get()._processServerValidation(serverValidation, localLicense, {
          refreshProfile,
          reason: `background_${reason}`,
          validationContext,
          lifecycle,
          isContextCurrent: () => {
            try {
              assertCurrentContext();
              return true;
            } catch {
              return false;
            }
          },
          persistWithinContext: (operation) => persistWithinLicenseValidationContext(
            validationContext,
            get,
            operation
          )
        });
      } else {
        Logger.log('[Background] Licencia validada sin cambios. No se refresca perfil.');

        if (refreshProfile || !get().companyProfile) {
          await loadBackgroundProfile(localLicense.license_key, {
            refreshProfile,
            profileLoadMode: 'background',
            reason: `background_${reason}`
          });
        }
      }

      assertCurrentContext();
      sessionStorage.setItem('Lanzo_app_loaded', Date.now().toString());
      get().clearServerStatus?.();
    } catch (error) {
      if (isLicenseValidationContextStaleError(error)) {
        Logger.log('[Background] Resultado descartado; cambió el tenant o la sesión del actor.');
        return;
      }
      // A timeout/error continuation also belongs to its captured actor/tenant.
      // In particular, connectivity probing must not report into a new login.
      try { assertCurrentContext(); } catch { return; }
      if (validationContextChanged()) return;
      const authorityFailure = classifyActorAuthorityError(error);
      if (authorityFailure?.kind === 'device_blocked' || authorityFailure?.kind === 'cloning_detected') {
        await denyHardAuthority(error, authorityFailure);
        return;
      }
      if (authorityFailure?.requiresReauthentication) {
        if (get()._requireActorAuthorityRecovery) {
          await get()._requireActorAuthorityRecovery(error, { operation: reason });
        } else {
          reportActorAuthorityError(error, { operation: reason });
        }
        return;
      }
      const isOnlineNow = await checkInternetConnection();
      try { assertCurrentContext(); } catch { return; }

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
    } finally {
      clearTimeout(timeoutId);
    }
    };
    let task;
    try { task = lifecycle ? lifecycle.track(validate) : validate(); }
    catch (error) { task = Promise.reject(error); }
    // Callers intentionally detach validation from login. Observe even failed
    // admission; callers that await it still receive the original rejection.
    task.catch(() => {});
    return task;
  }
});
