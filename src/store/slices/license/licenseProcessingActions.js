// src/store/slices/license/licenseProcessingActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    RENEWAL_REASONS
} from './licenseConstants';

import {
    normalizeValidationCode,
    isFatalValidationFailure,
    isStaffLoginRequiredFailure,
    isStaffDeviceAuthorizationFailure,
    isLicensePlanBlockFailure,
    deriveGracePeriodEnd,
    deriveLocalGracePeriodEnd,
    requiresAdminIdentity
} from './licenseGuards';

import {
    clearAdminSessionCache,
    clearStaffSessionCache,
    hasAdminSessionToken,
    verifyAdminSession
} from '../../../services/supabase';
import {
    beginActorRuntimeAuthentication,
    grantAuthenticatedActorRuntime,
    lockActorRuntime
} from '../../../services/auth/actorSessionRuntimeBridge';
import { assertLocalTenantSyncAccess } from '../../../services/tenant/localTenantGuard';

const shouldLoadProfileForLicense = (state = {}, licenseKey, refreshProfile = false) => (
    refreshProfile ||
    !state.companyProfile ||
    state.companyProfile?.license_key !== licenseKey
);

export const createLicenseProcessingActions = ({
    set,
    get,
    clearLocalLicenseSession,
    hasStaffValidationContext
}) => ({
    _processServerValidation: async (serverValidation, localLicense, options = {}) => {
        const { refreshProfile = false, reason = 'server_validation' } = options || {};
        await assertLocalTenantSyncAccess(
            { ...loca¶»§q«^