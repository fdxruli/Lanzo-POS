// src/store/slices/license/licenseMaintenanceActions.js

import Logger from '../../../services/Logger';

import {
    saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
    renewLicenseService
} from '../../../services/licenseService';
import { assertLocalTenantSyncAccess } from '../../../services/tenant/localTenantGuard';
import { getTenantRuntimeReadiness } from '../../../services/db/tenantRuntimeRouter';

const LAST_ACTIVE_STORAGE_KEY = 'lanzo_last_active';
const LAST_OFFLINE_STORAGE_KEY = 'lanzo_last_offline';

const readStoredTimestamp = (key) => {
    try {
        const rawValue = sessionStorage.getItem(key);
        const parsedValue = rawValue ? parseInt(rawValue, 10) : 0;
        return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
    } catch {
        return 0;
    }
};

const removeStoredTimestamp = (key) => {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Best effort cleanup.
    }
};

const getPositiveDurationMs = (value) => {
    const parsedValue = Number(value || 0);
    return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
};

const getDurationFromTimestamp = (timestamp, now = Date.now()) => (
    timestamp > 0 ? Math.max(0, now - timestamp) : 0
);

const isRealtimeLicenseMode = (state = {}) => {
    if (state.licenseSyncMode && state.licenseSyncMode !== 'idle') {
        return state.licenseSyncMode === 'hybrid_realtime';
    }

    return state.licenseDetails?.features?¶»§q«^