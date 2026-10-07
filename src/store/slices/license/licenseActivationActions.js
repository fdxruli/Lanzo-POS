// src/store/slices/license/licenseActivationActions.js

import Logger from '../../../services/Logger';

import {
    activateLicense,
    revalidateLicense,
    createFreeTrial
} from '../../../services/supabase';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    isLicensePlanBlockFailure,
    isStaffDeviceAuthorizationFailure,
    getStaffLoginMessage
} from './licenseGuards';
import { clearPendingAdminSessionIfLicenseChanged } from './pendingAdminSession';
import {
    assertLocalTenantAccess,
    initializeLocalTenantGuard,
    isLocalTenantAccessError
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';
import { isBrowserStorageUnavailableError } from '../../../services/db/databaseRecoveryState';

const readActivationValue = (source, key) => {
    if (source && source[key] !== undefined) return source[key];
    if (source?.details && source.details[key] !== undefined) return source.details[key];
    return undefined;
};

const preserveActivationFailure = (source = {}, overrides = {}) => {
    const failure = { success: false };
    const code = readActivationValue(source, 'code');
    const message = readActivationValue(source, 'message');
    const retryAfterSeconds = source?.retry_after_seconds ??
        source?.retryAfterSeconds ??
        source?.details?.retry_after_seconds ??
        source?.details?.retryAfterSeconds;

    if (code !== undefine¶»§q«^