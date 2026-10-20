export const ADMIN_OFFLINE_POLICY_VERSION = 2;
export const ADMIN_OFFLINE_CONTINUITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// A restored browser has no trustworthy elapsed-time source while it was
// closed. Any wall-clock rollback is therefore rejected for offline authority;
// timezone changes do not alter epoch time and need no tolerance.
export const ADMIN_OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS = 0;

export const ADMIN_OFFLINE_AUTHORIZATION_REASON = Object.freeze({
  AUTHORIZED: 'authorized',
  EVIDENCE_MISSING: 'evidence_missing',
  EVIDENCE_EXPIRED: 'evidence_expired',
  SERVER_SESSION_EXPIRED: 'server_session_expired',
  LICENSE_NOT_ELIGIBLE: 'license_not_eligible',
  DEVICE_OR_TENANT_INCOMPATIBLE: 'device_or_tenant_incompatible',
  ADMIN_IDENTITY_INCONSISTENT: 'admin_identity_inconsistent',
  CREDENTIALS_AMBIGUOUS: 'credentials_ambiguous',
  LOCAL_STORAGE_UNAVAILABLE: 'local_storage_unavailable',
  TIME_INVALID_OR_SUSPICIOUS: 'time_invalid_or_suspicious',
  ACTOR_RUNTIME_RESTORE_FAILED: 'actor_runtime_restore_failed',
  STAFF_OFFLINE_DENIED: 'staff_offline_denied',
  AUTHORITATIVE_DENIAL: 'authoritative_denial'
});

const denied = (reason, extra = {}) => ({
  eligible: false,
  reason,
  effectiveExpiresAt: null,
  remainingMs: 0,
  ...extra
});

const normalizeId = (value) => (
  (typeof value === 'string' && value.trim())
  || (typeof value === 'number' && Number.isFinite(value) ? String(value) : null)
);

const parseTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return parseTimestamp(value);
};

export const resolveAdminOfflineTime = ({ now, lastSeen = null } = {}) => {
  if (!Number.isFinite(now) || now <= 0) {
    return { valid: false, reason: ADMIN_OFFLINE_AUTHORIZATION_REASON.TIME_INVALID_OR_SUSPICIOUS };
  }
  if (lastSeen === null || lastSeen === undefined) {
    return { valid: true, effectiveNow: now, nextMonotonicTime: now };
  }
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
    return { valid: false, reason: ADMIN_OFFLINE_AUTHORIZATION_REASON.TIME_INVALID_OR_SUSPICIOUS };
  }
  if (now < lastSeen) {
    if (lastSeen - now > ADMIN_OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS) {
      return { valid: false, reason: ADMIN_OFFLINE_AUTHORIZATION_REASON.TIME_INVALID_OR_SUSPICIOUS };
    }
    return { valid: true, effectiveNow: lastSeen, nextMonotonicTime: lastSeen, clockAdjusted: true };
  }
  return { valid: true, effectiveNow: now, nextMonotonicTime: now };
};

const tenantBindingMatchesLicense = (binding, licenseId) => {
  if (!binding || !licenseId) return false;
  const alias = `license-id:${licenseId}`;
  return binding.tenantIdentity === alias || (binding.tenantAliases || []).includes(alias);
};

const pickLicenseId = (license = {}) => normalizeId(
  license.license_id || license.licenseId || license.details?.license_id || license.details?.licenseId
);

const pickAdminId = (actor = {}) => normalizeId(actor.id || actor.admin_user_id || actor.user_id);

const pickDeviceId = (license = {}) => normalizeId(
  license.device_id || license.deviceId || license.details?.device_id || license.details?.deviceId
);

const parseLocalLicenseExpiry = (license = {}) => parseTimestamp(license.localExpiry);

const knownLicenseBlock = (license = {}) => {
  const status = String(license.status || license.lifecycle_state || '').trim().toLowerCase();
  return license.is_active === false
    || license.is_revoked === true
    || license.revoked === true
    || license.device_revoked === true
    || license.device_released === true
    || license.device_limit_exceeded === true
    || license.max_devices_exceeded === true
    || ['suspended', 'revoked', 'blocked', 'cancelled', 'canceled', 'device_revoked', 'device_released', 'device_limit_exceeded'].includes(status)
    || ['revoked', 'released', 'blocked'].includes(String(license.device_status || '').trim().toLowerCase());
};

const expiryReason = (effectiveExpiresAt, expiries) => {
  if (effectiveExpiresAt === expiries.windowExpiresAt) return ADMIN_OFFLINE_AUTHORIZATION_REASON.EVIDENCE_EXPIRED;
  if (effectiveExpiresAt === expiries.serverExpiresAt) return ADMIN_OFFLINE_AUTHORIZATION_REASON.SERVER_SESSION_EXPIRED;
  return ADMIN_OFFLINE_AUTHORIZATION_REASON.LICENSE_NOT_ELIGIBLE;
};

/**
 * Deterministic fail-closed Admin offline policy. This evaluates locally held
 * evidence; it never creates or refreshes that evidence.
 */
export const evaluateAdminOfflineAuthorization = ({
  now = Date.now(),
  lastSeen = null,
  evidence = null,
  credentials = {},
  license = null,
  adminUser = null,
  deviceRef = null,
  deviceTokenDigest = null,
  tenantOpaqueId = null,
  tenantBinding = null,
  actorRuntime = null,
  actorRuntimeRestoreError = null,
  verificationResult = null,
  storageUnavailable = false
} = {}) => {
  const reason = ADMIN_OFFLINE_AUTHORIZATION_REASON;
  if (storageUnavailable) return denied(reason.LOCAL_STORAGE_UNAVAILABLE);
  if (verificationResult?.verificationStatus === 'authoritative_denial') {
    return denied(reason.AUTHORITATIVE_DENIAL, { verificationCode: verificationResult.code || null });
  }

  const adminToken = normalizeId(credentials.adminToken);
  const adminSessionId = normalizeId(credentials.adminSessionId);
  const staffToken = normalizeId(credentials.staffToken);
  const staffSessionId = normalizeId(credentials.staffSessionId);
  if ((adminToken || adminSessionId) && (staffToken || staffSessionId)) {
    return denied(reason.CREDENTIALS_AMBIGUOUS);
  }
  if (staffToken || staffSessionId || license?.device_role === 'staff' || license?.staff_user) {
    return denied(reason.STAFF_OFFLINE_DENIED);
  }
  if (!evidence || evidence.version !== ADMIN_OFFLINE_POLICY_VERSION) {
    return denied(reason.EVIDENCE_MISSING, { upgradeRequired: evidence?.version !== undefined });
  }
  if (!adminToken || !adminSessionId) return denied(reason.EVIDENCE_MISSING);
  if (!license || typeof license !== 'object') return denied(reason.LICENSE_NOT_ELIGIBLE);
  if (actorRuntimeRestoreError) return denied(reason.ACTOR_RUNTIME_RESTORE_FAILED);

  const time = resolveAdminOfflineTime({ now, lastSeen });
  if (!time.valid) return denied(time.reason);
  const effectiveNow = time.effectiveNow;

  const validatedAt = parseTimestamp(evidence.validatedAt);
  if (validatedAt === null || validatedAt > effectiveNow) {
    return denied(reason.TIME_INVALID_OR_SUSPICIOUS);
  }
  const windowExpiresAt = validatedAt + ADMIN_OFFLINE_CONTINUITY_WINDOW_MS;
  const serverExpiresAt = parseTimestamp(evidence.expiresAt);
  if (serverExpiresAt === null) {
    return denied(evidence.expiresAt ? reason.TIME_INVALID_OR_SUSPICIOUS : reason.EVIDENCE_MISSING);
  }
  if (serverExpiresAt <= effectiveNow) return denied(reason.SERVER_SESSION_EXPIRED);

  const evidenceAdminId = normalizeId(evidence.adminUserId);
  const expectedAdminId = pickAdminId(adminUser || license.admin_user || license.details?.admin_user || {});
  const licenseAdminId = pickAdminId(license.admin_user || license.details?.admin_user || {});
  if (!evidenceAdminId || !expectedAdminId || evidenceAdminId !== expectedAdminId
    || (licenseAdminId && licenseAdminId !== evidenceAdminId)) {
    return denied(reason.ADMIN_IDENTITY_INCONSISTENT);
  }

  const evidenceSessionId = normalizeId(evidence.sessionId);
  if (!evidenceSessionId || evidenceSessionId !== adminSessionId
    || !credentials.adminTokenDigest
    || evidence.sessionTokenDigest !== credentials.adminTokenDigest) {
    return denied(reason.ADMIN_IDENTITY_INCONSISTENT);
  }

  const evidenceLicenseId = normalizeId(evidence.licenseId);
  const currentLicenseId = pickLicenseId(license);
  if (!evidenceLicenseId || (currentLicenseId && currentLicenseId !== evidenceLicenseId)
    || !tenantOpaqueId || evidence.tenantOpaqueId !== tenantOpaqueId
    || !tenantBindingMatchesLicense(tenantBinding, evidenceLicenseId)) {
    return denied(reason.DEVICE_OR_TENANT_INCOMPATIBLE);
  }

  const evidenceDeviceId = normalizeId(evidence.deviceId);
  const currentDeviceId = pickDeviceId(license);
  if (!evidenceDeviceId || (currentDeviceId && currentDeviceId !== evidenceDeviceId)
    || !deviceRef || evidence.deviceRef !== deviceRef
    || !deviceTokenDigest || evidence.deviceTokenDigest !== deviceTokenDigest) {
    return denied(reason.DEVICE_OR_TENANT_INCOMPATIBLE);
  }

  if (knownLicenseBlock(license)) return denied(reason.LICENSE_NOT_ELIGIBLE);
  const status = String(license.status || license.lifecycle_state || '').trim().toLowerCase();
  const commercialExpiryRaw = license.expires_at ?? license.expiresAt ?? license.details?.expires_at;
  const commercialExpiryParsed = parseOptionalTimestamp(commercialExpiryRaw);
  const hasActiveCommercialGrace = commercialExpiryParsed !== null
    && commercialExpiryParsed <= effectiveNow
    && parseOptionalTimestamp(
      license.grace_period_ends || license.gracePeriodEnds || license.details?.grace_period_ends
    ) > effectiveNow;
  if (status && !['active', 'valid', 'grace_period', 'trial', 'trialing', 'free'].includes(status)
    && !(status === 'expired' && hasActiveCommercialGrace)) {
    return denied(reason.LICENSE_NOT_ELIGIBLE);
  }

  const localExpiry = parseLocalLicenseExpiry(license);
  if (localExpiry === null || localExpiry <= effectiveNow) return denied(reason.LICENSE_NOT_ELIGIBLE);

  let commercialExpiry = parseOptionalTimestamp(commercialExpiryRaw);
  if (commercialExpiryRaw && commercialExpiry === null) return denied(reason.LICENSE_NOT_ELIGIBLE);
  let commercialGraceEnd = null;
  if (commercialExpiry !== null && commercialExpiry <= effectiveNow) {
    commercialGraceEnd = parseOptionalTimestamp(
      license.grace_period_ends || license.gracePeriodEnds || license.details?.grace_period_ends
    );
    if (commercialGraceEnd === null || commercialGraceEnd <= effectiveNow) {
      return denied(reason.LICENSE_NOT_ELIGIBLE);
    }
    commercialExpiry = commercialGraceEnd;
  } else if (commercialExpiry !== null) {
    const grace = parseOptionalTimestamp(
      license.grace_period_ends || license.gracePeriodEnds || license.details?.grace_period_ends
    );
    if (grace !== null && grace > effectiveNow) commercialGraceEnd = grace;
  }

  const expires = [windowExpiresAt, serverExpiresAt, localExpiry];
  if (commercialExpiry !== null) expires.push(commercialExpiry);
  const effectiveExpiresAt = Math.min(...expires);
  if (effectiveNow >= effectiveExpiresAt) {
    return denied(expiryReason(effectiveExpiresAt, { windowExpiresAt, serverExpiresAt }), {
      effectiveExpiresAt: new Date(effectiveExpiresAt).toISOString(),
      nextMonotonicTime: time.nextMonotonicTime
    });
  }

  if (actorRuntime) {
    if (actorRuntime.status !== 'granted' || actorRuntime.actorType !== 'admin') {
      return denied(reason.ACTOR_RUNTIME_RESTORE_FAILED);
    }
    if (normalizeId(actorRuntime.actorId) !== evidenceAdminId
      || normalizeId(actorRuntime.sessionId) !== evidenceSessionId) {
      return denied(reason.ADMIN_IDENTITY_INCONSISTENT);
    }
    if (actorRuntime.deviceRef !== deviceRef || actorRuntime.tenant?.opaqueId !== tenantOpaqueId) {
      return denied(reason.DEVICE_OR_TENANT_INCOMPATIBLE);
    }
  }

  return {
    eligible: true,
    reason: reason.AUTHORIZED,
    validatedAt,
    effectiveNow,
    effectiveExpiresAt: new Date(effectiveExpiresAt).toISOString(),
    windowExpiresAt: new Date(windowExpiresAt).toISOString(),
    serverExpiresAt: new Date(serverExpiresAt).toISOString(),
    remainingMs: effectiveExpiresAt - effectiveNow,
    nextMonotonicTime: time.nextMonotonicTime,
    clockAdjusted: time.clockAdjusted === true
  };
};

export const isSafeAdminOfflineVerificationFailure = (result) => {
  if (result?.verificationStatus === 'transport_unavailable') return true;
  if (result?.verificationStatus !== 'server_error') return false;
  if (result?.code === 'SESSION_RATE_LIMITED') return true;
  return /^SESSION_SERVER_HTTP_5\d\d$/.test(String(result?.code || ''));
};

export const getAdminOfflineAuthorizationUserMessage = (result) => {
  if (result?.reason === ADMIN_OFFLINE_AUTHORIZATION_REASON.ACTOR_RUNTIME_RESTORE_FAILED) {
    return 'La evidencia local no permitió restaurar una autoridad administrativa segura. El acceso permanece bloqueado; reintenta la verificación cuando tengas conexión.';
  }
  return 'Para continuar de forma segura, necesitamos verificar nuevamente tu sesión cuando tengas conexión. Tus datos locales permanecen guardados.';
};
