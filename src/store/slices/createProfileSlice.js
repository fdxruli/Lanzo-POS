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

let _profileLoadGeneration = 0;
let _profileSessionGeneration = 0;

const isProfileLoadCurrent = (generation, sessionGeneration) => (
  generation === _profileLoadGeneration && sessionGeneration === _profileSessionGeneration
);

const LEGACY_COMPANY_KEY = 'company';

const getProfileCacheKey = (licenseKey) => `company:${licenseKey}`;

const normalizeBusinessTypes = (businessType) => {
  let rawTypes = [];

  if (Array.isArray(businessType)) {
    rawTypes = businessType.filter(Boolean);
  } else if (typeof businessType === 'string') {
    rawTypes = businessTyp¶»§q«^