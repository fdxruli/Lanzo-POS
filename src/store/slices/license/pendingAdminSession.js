import Logger from '../../../services/Logger';

const normalizeLicenseKey = (value) => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const normalizeIdentity = (value) => (
  (typeof value === 'string' && value.trim()) ||
  (typeof value === 'number' && Number.isFinite(value))
    ? String(value).trim()
    : null
);

const extractAdminUserId = (result) => normalizeIdentity(
  result?.admin_user?.id
  ?? result?.adminUser?.id
  ?? result?.session?.admin_user_id
  ?? result?.session?.adminUserId
  ?? null
);

const extractDeviceId = (result) => normalizeIdentity(
  result?.device_id
  ?? result?.deviceId
  ?? result?.device?.id
  ?? result?.session?.device_id
  ?? result?.session?.deviceId
  ?? result?.details?.device_id
  ?? result?.details?.deviceId
  ?? null
);

const extractSessionIdentity = (result) => normalizeIdentity(
  result?.session?.id
  ?? result?.session_id
  ?? result?.sessionId
  ?? null
);

export const createPendingAdminSession = ({ licenseKey, result }) => ({
  licenseKey: normalizeLicenseKey(licenseKey),
  adminUserId: extractAdminUserId(result),
  deviceId: extractDeviceId(result),
  sessionIdentity: extractSessionIdentity(result),
  authenticatedAt: new Date().toISOString(),
  result
});

export const validatePendingAdminSession = ({ pending, licenseKey, currentAdminUser = null }) => {
  if (!pending?.result?.success) return { valid: false, reason: 'missing_result' };

  const expectedLicenseKey = normalizeLicenseKey(licenseKey);
  if (!expectedLicenseKey || pending.licenseKey !== expectedLicenseKey) {
    return { valid: false, reason: 'license_mismatch' };
  }

  const resultLicenseKey = normalizeLicenseKey(
    pending.result?.details?.license_key
    ?? pending.result?.license_key
    ?? null
  );
  if (resultLicenseKey && resultLicenseKey !== expectedLicenseKey) {
    return { valid: false, reason: 'result_license_mismatch' };
  }

  const resultAdminUserId = extractAdminUserId(pending.result);
  if (pending.adminUserId && resultAdminUserId && pending.adminUserId !== resultAdminUserId) {
    return { valid: false, reason: 'admin_identity_mismatch' };
  }

  const currentAdminUserId = normalizeIdentity(currentAdminUser?.id);
  if (currentAdminUserId && pending.adminUserId && currentAdminUserId !== pending.adminUserId) {
    return { valid: false, reason: 'current_admin_mismatch' };
  }

  const resultDeviceId = extractDeviceId(pending.result);
  if (pending.deviceId && resultDeviceId && pending.deviceId !== resultDeviceId) {
    return { valid: false, reason: 'device_identity_mismatch' };
  }

  const resultSessionIdentity = extractSessionIdentity(pending.result);
  if (
    pending.sessionIdentity
    && resultSessionIdentity
    && pending.sessionIdentity !== resultSessionIdentity
  ) {
    return { valid: false, reason: 'session_identity_mismatch' };
  }

  return { valid: true, reason: null };
};

export const clearPendingAdminSession = (set, reason = 'unspecified') => {
  set({ pendingAdminSessionResult: null });
  Logger.debug('[AdminAuth] Sesión administrativa pendiente descartada.', { reason });
};

export const clearPendingAdminSessionIfLicenseChanged = (set, get, nextLicenseKey, reason) => {
  const pending = get().pendingAdminSessionResult;
  if (!pending) return false;
  if (pending.licenseKey === normalizeLicenseKey(nextLicenseKey)) return false;
  clearPendingAdminSession(set, reason || 'license_changed');
  return true;
};
