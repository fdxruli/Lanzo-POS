import { notifyPosCatalogSessionReset } from '../../../services/products/posCatalogSessionEvents';
import {
  activateLicense,
  adminLoginOnDevice,
  adminLogoutSession,
  adminTakeoverFreeDevice,
  clearAdminSessionCache,
  clearStaffSessionCache,
  enrollAdminOwnerOnDevice
} from '../../../services/supabase';
import {
  beginActorRuntimeAuthentication,
  grantAuthenticatedActorRuntime,
  lockActorRuntime
} from '../../../services/auth/actorSessionRuntimeBridge';
import { saveLicenseToStorage } from '../../../services/licenseStorage';
import { ensureLocalDatabaseReady } from '../../../services/db/databaseRuntime';
import {
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  createDatabaseRecoveryError,
  getDatabaseRecoveryState,
  isStructuralDatabaseError,
  setDatabaseRecoveryState
} from '../../../services/db/databaseRecoveryState';
import Logger from '../../../services/Logger';
import {
  assertLocalTenantAccess,
  initializeLocalTenantGuard,
  isLocalTenantAccessError,
  lockLocalTenantAccess
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';
import {
  hasModernAdminIdentityEvidence,
  requiresAdminIdentity
} from './licenseGuards';
import {
  clearPendingAdminSession,
  clearPendingAdminSessionIfLicenseChanged,
  createPendingAdminSession,
  validatePendingAdminSession
} from './pendingAdminSession';

const completeAdminSession = async (set, get, licenseKey, result, reason) => {
  co¶»§q«^