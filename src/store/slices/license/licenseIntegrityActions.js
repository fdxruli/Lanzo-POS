// src/store/slices/license/licenseIntegrityActions.js

import Logger from '../../../services/Logger';
import { revalidateLicense } from '../../../services/supabase';
import { saveLicenseToStorage } from '../../../services/licenseStorage';
import {
    LICENSE_REMOTE_VALIDATION_COOLDOWN_MS,
    RENEWAL_REASONS
} from './licenseConstants';
import {
    assertLocalTransactionAllowed,
    isCriticalLicenseValidationReason,
    normalizeValidationCode,
    isFatalValidationFailure,
    isRecoverableValidationFailure,
    isStaffLoginRequiredFailure,
    isStaffDeviceAuthorizationFailure,
    isLicensePlanBlockFailure,
    deriveGracePeriodEnd
} from './licenseGuards';
import {
    LAST_REMOTE_LICENSE_KEY,
    LAST_REMOTE_LICENSE_VALIDATION_KEY,
    markLastLicenseValidationAttempt,
    markLastLicenseValidationSuccess
} from './licenseValidationTimestamps';
import { isLocalTenantAccessError } from '../../../services/tenant/localTenantGuard';

const normalizeOptions = (options = {}) => {
    if (typeof options === 'string') {
        return { reason: options };
    }

    return options || {};
};

const shouldSkipRemoteValidationByCooldown = ({ forceRemote, reason, licenseKey }) => {
    if (forceRemote || isCriticalLicenseValidationReason(reason)) return false;

    try {
        const lastLicenseKey = sessionStorage.getItem(LAST_REMOTE_LICENSE_KEY);
        const lastRemote = Number(sessionStorage.getItem(LAST_REMOTE_LICENSE_VALIDATION_KEY) || 0);

        return (
            l¶»§q«^