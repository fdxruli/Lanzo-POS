import { loadData, saveData, STORES } from '../../services/database';
import Logger from '../../services/Logger';
import {
  getBusinessProfile,
  revalidateLicense,
  saveBusinessProfile
} from '../../services/supabase';
import { saveLicenseToStorage } from '../../services/licenseStorage';
import {
  IMAGE_UPLOAD_PURPOSES,
  uploadImageFile
} from '../../services/storage/imageUploadService';
import { normalizeBusinessTypes as normalizeCanonicalBusinessTypes } from '../../utils/businessType';
import {
  PROFILE_LAST_LICENSE_KEY,
  PROFILE_LAST_LOAD_KEY,
  PROFILE_REFRESH_TTL_MS
} from './license/licenseConstants';
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError
} from '../../services/tenant/localTenantGuard';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import {
  getTenantRuntimeReadiness,
  isTenantRuntimeError
} from '../../services/db/tenantRuntimeRouter';

const LEGACY_COMPANY_KEY = 'company';

const getProfileCacheKey = (licenseKey) => `company:${licenseKey}`;

const normalizeBusinessTypes = (businessType) => {
  let rawTypes = [];

  if (Array.isArray(businessType)) {
    rawTypes = businessType.filter(Boolean);
  } else if (typeof businessType === 'string') {
    rawTypes = businessType
      .replace(/[{}"]+/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return rawTypes.length > 0 ? normalizeCanonicalBusinessTypes(rawTypes) : [];
};

const hasUsableProfile = (profile) => {
  const name = profile?.name || profile?.business_name || '';
  return name.trim().length > 0 && normalizeBusinessTypes(profile?.business_type).length > 0;
};

const buildCompanyData = (rawProfile, licenseKey, id = getProfileCacheKey(licenseKey)) => ({
  id,
  profile_id: rawProfile?.profile_id || rawProfile?.id || null,
  license_key: rawProfile?.license_key || licenseKey,
  name: rawProfile?.business_name || rawProfile?.name || '',
  phone: rawProfile?.phone_number || rawProfile?.phone || '',
  address: rawProfile?.address || '',
  logo: rawProfile?.logo_url || rawProfile?.logo || '',
  business_type: normalizeBusinessTypes(rawProfile?.business_type)
});

const getLastProfileLoadMeta = (licenseKey) => {
  try {
    const lastLoad = Number(localStorage.getItem(PROFILE_LAST_LOAD_KEY) || 0);
    const lastLicenseKey = localStorage.getItem(PROFILE_LAST_LICENSE_KEY) || null;

    return {
      lastLoad: Number.isFinite(lastLoad) ? lastLoad : 0,
      lastLicenseKey,
      isFresh:
        lastLicenseKey === licenseKey &&
        lastLoad > 0 &&
        Date.now() - lastLoad < PROFILE_REFRESH_TTL_MS
    };
  } catch {
    return { lastLoad: 0, lastLicenseKey: null, isFresh: false };
  }
};

const markProfileLoaded = (licenseKey) => {
  try {
    localStorage.setItem(PROFILE_LAST_LOAD_KEY, Date.now().toString());
    localStorage.setItem(PROFILE_LAST_LICENSE_KEY, licenseKey || '');
  } catch {
    // Best effort: el TTL solo optimiza llamadas, no debe romper el flujo.
  }
};

const saveProfileCache = async (licenseKey, companyData, { beforeWrite = null } = {}) => {
  const scopedProfile = {
    ...companyData,
    id: getProfileCacheKey(licenseKey),
    license_key: licenseKey
  };

  beforeWrite?.();
  await saveData(STORES.COMPANY, scopedProfile);
  beforeWrite?.();
  await saveData(STORES.COMPANY, {
    ...scopedProfile,
    id: LEGACY_COMPANY_KEY
  });

  beforeWrite?.();
  markProfileLoaded(licenseKey);

  return scopedProfile;
};

const isAuthoritativeLicenseValidation = (validation) => (
  validation?.valid === true
  && validation?.reason !== 'offline_grace'
  && validation?.is_fallback !== true
  && validation?.features
  && typeof validation.features === 'object'
  && !Array.isArray(validation.features)
);

const refreshLicenseBeforeReady = async ({ licenseKey, actorHandle, set, get }) => {
  Logger.log('[License] Revalidando capacidades autorizadas antes de finalizar onboarding.');
  const validation = await revalidateLicense(licenseKey);

  actorHandle.assertCurrent('settings');
  if (!isAuthoritativeLicenseValidation(validation)) {
    const error = new Error(
      validation?.details
      || validation?.reason
      || 'No se pudo confirmar la licencia para finalizar la configuración.'
    );
    error.code = validation?.reason || 'LICENSE_REVALIDATION_REQUIRED';
    throw error;
  }

  await assertLocalTenantSyncAccess(validation, {
    reason: 'onboarding_license_revalidation_response'
  });

  const currentLicense = get().licenseDetails || {};
  const authoritativeLicense = {
    ...currentLicense,
    ...validation,
    license_key: validation.license_key || licenseKey,
    valid: true,
    features: validation.features,
    details: {
      ...(currentLicense.details || {}),
      ...(validation.details || {}),
      ...validation,
      license_key: validation.license_key || licenseKey,
      features: validation.features
    },
    device_role: validation.device_role
      || currentLicense.device_role
      || get().currentDeviceRole
      || 'admin'
  };

  actorHandle.assertCurrent('settings');
  await saveLicenseToStorage(authoritativeLicense);
  actorHandle.assertCurrent('settings');
  set({ licenseDetails: authoritativeLicense });

  return authoritativeLicense;
};

const applyProfileState = (set, get, companyData, profileImportCandidate) => {
  set({ companyProfile: companyData, profileImportCandidate });

  if (hasUsableProfile(companyData)) {
    Logger.log('[AppStore] Aplicacion lista (ready)');
    set({ appStatus: 'ready' });
  } else if (get().currentDeviceRole === 'staff') {
    Logger.warn('[Profile] Staff sin perfil local/remoto usable; se permite entrada sin Setup.');
    set({ appStatus: 'ready' });
  } else {
    Logger.log('[AppStore] Requiere configuracion inicial');
    set({ appStatus: 'setup_required' });
  }
};

export const createProfileSlice = (set, get) => {
  let _profileLoadGeneration = 0;
  let _profileSessionGeneration = 0;
  const isProfileLoadCurrent = (generation, sessionGeneration) => (
    generation === _profileLoadGeneration && sessionGeneration === _profileSessionGeneration
  );
  const loadProfile = async (licenseKey, options = {}) => {
    const lifecycle = options?.lifecycle;
    const sessionGeneration = _profileSessionGeneration;
    const generation = ++_profileLoadGeneration;
    const stateAtRequest = { ...get() };
    const tenantAtRequest = getTenantRuntimeReadiness().runtime;
    const actorBinding = () => {
      const actor = actorRuntimeController.getState?.();
      return JSON.stringify(actor && {
        status: actor.status, generation: actor.generation, actorType: actor.actorType,
        actorId: actor.actorId, actorKey: actor.actorKey, sessionId: actor.sessionId,
        tenant: actor.tenant, deviceRef: actor.deviceRef
      });
    };
    const actorAtRequest = actorBinding();
    const run = async () => {
    const {
      forceRemote = false,
      refreshProfile = false,
      reason = 'manual',
      allowSetupTransition = false,
      profileLoadMode = 'foreground',
      assertCurrent = null,
      onPrepared = null
    } = options || {};
    const actorHandle = actorRuntimeController.getState?.()?.status === 'granted'
      ? actorRuntimeController.capture() : null;
    const assertLoadContext = () => {
      lifecycle?.assertCurrent();
      assertCurrent?.();
      actorHandle?.assertCurrent();
      const tenant = getTenantRuntimeReadiness().runtime;
      const currentLicense = get().licenseDetails?.license_key;
      if (actorBinding() !== actorAtRequest
        || get().currentDeviceRole !== stateAtRequest.currentDeviceRole
        || (get().currentAdminUser?.id || null) !== (stateAtRequest.currentAdminUser?.id || null)
        || (get().currentStaffUser?.id || null) !== (stateAtRequest.currentStaffUser?.id || null)
        || !isProfileLoadCurrent(generation, sessionGeneration)
        || (stateAtRequest.licenseDetails?.license_key && currentLicense !== licenseKey)
        || (currentLicense && currentLicense !== licenseKey)
        || tenant?.opaqueId !== tenantAtRequest?.opaqueId
        || tenant?.generation !== tenantAtRequest?.generation
        || tenant?.databaseName !== tenantAtRequest?.databaseName) {
        const error = new Error('La carga del perfil pertenece a una sesión anterior.');
        error.code = 'ACTOR_CONTEXT_STALE';
        throw error;
      }
    };
    const publishPreparedProfile = (companyData, importCandidate) => {
      assertLoadContext();
      applyProfileState(set, get, companyData, importCandidate);
      const continuation = onPrepared?.(get().appStatus);
      if (continuation && typeof continuation.then === 'function') {
        // The callback may synchronously quiesce/invalidate its scope before
        // returning. Observe rejection before any admission check can throw.
        const task = Promise.resolve(continuation);
        task.catch(error => Logger.warn('[Profile] Callback auxiliar falló:', error));
        lifecycle?.markUnobservable('profile_async_onPrepared');
        if (lifecycle) lifecycle.observe(task);
      }
    };

    if (!licenseKey) return null;
    assertLoadContext();

    if (profileLoadMode === 'background' && !getTenantRuntimeReadiness().ready) {
      Logger.warn('[Profile] Se omite carga de fondo (' + reason + '): TenantRuntime no está listo.');
      const currentProfile = stateAtRequest.companyProfile;
      return currentProfile?.license_key === licenseKey ? currentProfile : null;
}

    await assertLocalTenantSyncAccess(
      { license_key: licenseKey },
      { reason: `profile_${reason}` }
    );
    if (sessionGeneration !== _profileSessionGeneration) return null;

    if (!getTenantRuntimeReadiness().ready) {
      Logger.warn('[Profile] Se omite carga (' + reason + '): TenantRuntime no está listo.');
      const currentProfile = get().companyProfile;
      return currentProfile?.license_key === licenseKey ? currentProfile : null;
}

    assertLoadContext();

    // These production providers are synchronous local reads, not Google RPCs.
    // A substituted async provider is observed but cannot promise guarded effects.
    for (const name of ['refreshTenantUiPreferences', 'refreshDriveSession']) {
      assertLoadContext();
      const result = get()[name]?.();
      if (result && typeof result.then === 'function') {
        const task = Promise.resolve(result);
        task.catch(error => Logger.warn('[Profile] Refresh auxiliar falló:', error));
        lifecycle?.markUnobservable(`profile_async_${name}`);
        if (lifecycle) lifecycle.observe(task);
      }
      assertLoadContext();
    }

    const stateAtLoad = get();
    const isAuthenticatedStaffTransition =
      stateAtLoad.currentDeviceRole === 'staff' &&
      Boolean(stateAtLoad.currentStaffUser) &&
      stateAtLoad.appStatus === 'staff_login_required';
    const shouldForceRemote = Boolean(
      forceRemote || refreshProfile || isAuthenticatedStaffTransition
    );
    const cacheMeta = getLastProfileLoadMeta(licenseKey);
    const currentProfile = stateAtLoad.companyProfile;

    let companyData = null;
    let profileMissingRemotely = false;
    let profileImportCandidate = null;
    let profileStorageReadFailed = false;

    if (
      !shouldForceRemote &&
      cacheMeta.isFresh &&
      currentProfile?.license_key === licenseKey &&
      hasUsableProfile(currentProfile)
    ) {
      Logger.log(`[Profile] Usando perfil en memoria; TTL vigente (${reason}).`);
      if (profileLoadMode === 'foreground') publishPreparedProfile(currentProfile, null);
      return currentProfile;
    }

    try {
      const cachedProfile = await loadData(STORES.COMPANY, getProfileCacheKey(licenseKey));

      if (!isProfileLoadCurrent(generation, sessionGeneration)) {
        Logger.log(`[Profile] Carga #${generation} descartada tras leer IndexedDB`);
        return null;
      }

      if (cachedProfile?.license_key === licenseKey) {
        companyData = buildCompanyData(cachedProfile, licenseKey);

        if (!shouldForceRemote && cacheMeta.isFresh && hasUsableProfile(companyData)) {
          Logger.log(`[Profile] Usando perfil local; TTL vigente (${reason}).`);
          assertLoadContext();
          publishPreparedProfile(companyData, null);
          return companyData;
        }
      }
    } catch (error) {
      if (isLocalTenantAccessError(error) || isTenantRuntimeError(error) || error?.code?.startsWith('ACTOR_') || error?.message?.startsWith('BOOTSTRAP_LIFECYCLE_')) throw error;
      profileStorageReadFailed = true;
      Logger.warn('[AppStore] Fallo carga perfil local:', error);
    }

    if (licenseKey && navigator.onLine && (!companyData || shouldForceRemote || !cacheMeta.isFresh)) {
      try {
        Logger.log(`[Profile] Refrescando perfil remoto (${reason}).`);
        const profileResult = await (lifecycle
          ? getBusinessProfile(licenseKey, { lifecycle, assertCurrent: assertLoadContext })
          : getBusinessProfile(licenseKey));

        if (!isProfileLoadCurrent(generation, sessionGeneration)) {
          Logger.log(`[Profile] Carga #${generation} descartada`);
          return null;
        }

        if (profileResult?.success && profileResult.data) {
          const responseIdentity = profileResult.data;
          if (
            responseIdentity.license_key
            || responseIdentity.licenseKey
            || responseIdentity.license_id
            || responseIdentity.licenseId
            || responseIdentity.details?.license_key
            || responseIdentity.details?.licenseKey
            || responseIdentity.details?.license_id
            || responseIdentity.details?.licenseId
          ) {
            await assertLocalTenantSyncAccess(responseIdentity, {
              reason: 'profile_remote_response_identity'
            });
          }
          assertLoadContext();
          companyData = buildCompanyData(profileResult.data, licenseKey);
          companyData = await saveProfileCache(licenseKey, companyData, { beforeWrite: assertLoadContext });

          if (!isProfileLoadCurrent(generation, sessionGeneration)) {
            Logger.log(`[Profile] Carga #${generation} descartada tras guardar local`);
            return null;
          }
        } else if (
          profileResult?.code === 'PROFILE_NOT_FOUND' ||
          profileResult?.reason === 'PROFILE_NOT_FOUND'
        ) {
          profileMissingRemotely = true;
        }
      } catch (error) {
        if (isLocalTenantAccessError(error) || isTenantRuntimeError(error) || error?.code?.startsWith('ACTOR_') || error?.message?.startsWith('BOOTSTRAP_LIFECYCLE_')) throw error;
        Logger.warn('[AppStore] Fallo carga perfil online:', error);
      }
    }

    if (!companyData && licenseKey && !profileMissingRemotely) {
      try {
        const cachedProfile = await loadData(STORES.COMPANY, getProfileCacheKey(licenseKey));

        if (!isProfileLoadCurrent(generation, sessionGeneration)) {
          Logger.log(`[Profile] Carga #${generation} descartada tras leer IndexedDB`);
          return null;
        }

        if (cachedProfile?.license_key === licenseKey) {
          companyData = buildCompanyData(cachedProfile, licenseKey);
        }
      } catch (error) {
        if (isLocalTenantAccessError(error) || isTenantRuntimeError(error)) throw error;
        profileStorageReadFailed = true;
        Logger.warn('[AppStore] Fallo carga perfil local:', error);
      }
    }

    if (!companyData) {
      try {
        const legacyProfile = await loadData(STORES.COMPANY, LEGACY_COMPANY_KEY);
        const belongsToCurrentLicense = legacyProfile?.license_key === licenseKey;

        if (!belongsToCurrentLicense && hasUsableProfile(legacyProfile)) {
          profileImportCandidate = buildCompanyData(
            legacyProfile,
            legacyProfile.license_key || 'legacy',
            'profile-import-candidate'
          );
        }
      } catch (error) {
        if (isLocalTenantAccessError(error) || isTenantRuntimeError(error)) throw error;
        profileStorageReadFailed = true;
        Logger.warn('[AppStore] Fallo leyendo perfil legado:', error);
      }
    }

    if (!isProfileLoadCurrent(generation, sessionGeneration)) {
      Logger.log(`[Profile] Carga #${generation} descartada antes de publicar estado`);
      return null;
    }

    const currentProfileAtPublish = get().companyProfile;
    assertLoadContext();
    if (
      hasUsableProfile(currentProfileAtPublish) &&
      currentProfileAtPublish?.license_key === licenseKey &&
      !hasUsableProfile(companyData)
    ) {
      Logger.warn('[Profile] Se conserva el perfil en memoria tras una carga incompleta (' + reason + ').');
      if (profileLoadMode === 'foreground') publishPreparedProfile(currentProfileAtPublish, null);
      return currentProfileAtPublish;
    }

    if (!hasUsableProfile(companyData)) {
      if (profileStorageReadFailed) {
        Logger.warn('[Profile] No se decide ausencia del perfil tras un fallo local (' + reason + ').');
        return null;
      }

      const mayEnterSetup = allowSetupTransition === true && profileMissingRemotely;
      if (!mayEnterSetup) {
        Logger.warn('[Profile] No se confirmó onboarding; se conserva el estado actual (' + reason + ').');
        return null;
      }
    }

    publishPreparedProfile(companyData, profileImportCandidate);
    return companyData;
    };
    return lifecycle ? lifecycle.track(run) : run();
  };
  loadProfile.bootstrapLifecycleVersion = 1;
  return {
    companyProfile: null,
    profileImportCandidate: null,
    _invalidateProfileLoads: () => { _profileSessionGeneration += 1; },
    _loadProfile: loadProfile,

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;
    const actorHandle = actorRuntimeController.capture('settings');
    const sessionGeneration = _profileSessionGeneration;

    try {
      let logoUrl = setupData.logo_url || setupData.logo || null;

      if (setupData.logo instanceof File) {
        const uploadResult = await uploadImageFile({
          file: setupData.logo,
          licenseKey,
          purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO
        });
        logoUrl = uploadResult.publicUrl;
      }

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      const profileData = {
        ...setupData,
        logo: logoUrl,
        business_type: normalizeBusinessTypes(setupData.business_type)
      };

      const saveResult = await saveBusinessProfile(licenseKey, profileData, { actorHandle });
      if (!saveResult?.success) {
        throw new Error(
          saveResult?.message ||
          saveResult?.error ||
          'No se pudo guardar el perfil del negocio.'
        );
      }

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      const companyData = await saveProfileCache(
        licenseKey,
        buildCompanyData(profileData, licenseKey),
        { beforeWrite: () => actorHandle.assertCurrent('settings') }
      );

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      await refreshLicenseBeforeReady({
        licenseKey,
        actorHandle,
        set,
        get
      });

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      set({
        companyProfile: companyData,
        profileImportCandidate: null,
        ownerEnrollmentContext: null,
        appStatus: 'ready'
      });
    } catch (error) {
      Logger.error('Error en setup:', error);
      throw error;
    }
  },

  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;
    const actorHandle = actorRuntimeController.capture('settings');
    const sessionGeneration = _profileSessionGeneration;

    try {
      const nextCompanyData = { ...companyData };

      if (nextCompanyData.logo instanceof File) {
        const uploadResult = await uploadImageFile({
          file: nextCompanyData.logo,
          licenseKey,
          purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO
        });
        nextCompanyData.logo = uploadResult.publicUrl;
      }

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      nextCompanyData.business_type = normalizeBusinessTypes(nextCompanyData.business_type);

      const saveResult = await saveBusinessProfile(licenseKey, nextCompanyData, { actorHandle });
      if (!saveResult?.success) {
        throw new Error(
          saveResult?.message ||
          saveResult?.error ||
          'No se pudo guardar el perfil del negocio.'
        );
      }

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      const scopedCompanyData = await saveProfileCache(
        licenseKey,
        buildCompanyData(nextCompanyData, licenseKey),
        { beforeWrite: () => actorHandle.assertCurrent('settings') }
      );

      actorHandle.assertCurrent('settings');
      if (sessionGeneration !== _profileSessionGeneration) return null;

      set({ companyProfile: scopedCompanyData });
    } catch (error) {
      Logger.error('Error actualizando perfil:', error);
      throw error;
    }
  },

  dismissProfileImportCandidate: () => {
    set({ profileImportCandidate: null });
  }
  };
};
