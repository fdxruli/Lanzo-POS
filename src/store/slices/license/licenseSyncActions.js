// src/store/slices/license/licenseSyncActions.js

import Logger from '../../../services/Logger';

import {
  getLicenseSyncIntervalMs,
  getLicenseSyncMode,
  isCriticalLicenseValidationReason
} from './licenseGuards';

import {
  markLastLicenseValidationAttempt,
  shouldSkipRemoteValidationAfterFailure,
  shouldSkipRemoteValidationForPlan
} from './licenseValidationTimestamps';
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError
} from '../../../services/tenant/localTenantGuard';
import { getTenantRuntimeReadiness } from '../../../services/db/tenantRuntimeRouter';

let licenseSyncTimer = null;
let licenseSyncOnlineListener = null;
let licenseSyncOfflineListener = null;
let licenseSyncLastOfflineAt = 0;
let isLicenseSyncCheckRunning = false;

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

const writeStoredTimestamp = (key, value) => {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // Best effort persistence.
  }
};

const removeStoredTimestamp = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Best effort cleanup.
  }
};

const getElapsedSince = (timestamp, now = Date.now()) => (
  timestamp > 0 ? Math.max(0, now - timestamp) : 0
);

¶»§q«^