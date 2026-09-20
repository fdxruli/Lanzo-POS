import { useAppStore } from '../../store/useAppStore';
import { assertLocalTransactionAllowed } from '../../store/slices/license/licenseGuards';
import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';

const CLOUD_FEATURE_KEYS = Object.freeze(['cloud_pos_sync', 'customerMessageTemplates']);

const parseRpcPayload = (data) => {
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return {}; }
  }
  return data || {};
};

const planCode = (licenseDetails = {}) => String(
  licenseDetails?.effective_plan_code
  || licenseDetails?.plan_code
  || licenseDetails?.details?.plan_code
  || licenseDetails?.plan?.code
  || ''
).trim().toLowerCase();

const features = (licenseDetails = {}) => ({
  ...(licenseDetails?.details?.features || {}),
  ...(licenseDetails?.features || {}),
  ...(licenseDetails?.effective_features || {})
});

const errorResult = (code, message = null, extra = {}) => ({
  ok: false,
  code,
  message,
  ...extra
});

export const isCloudCustomerMessagingEnabled = (licenseDetails = {}) => {
  const currentFeatures = features(licenseDetails);
  return Boolean(
    currentFeatures?.cloud_pos_sync === true
    && (currentFeatures?.customerMessageTemplates === true || /^pro|^nube/u.test(planCode(licenseDetails)))
  );
};

const LICENSE_LIFECYCLE_BLOCK_CODES = new Set([
  'expired',
  'administratively_blocked',
  'cancelled',
  'revoked',
  'suspended',
  'blocked'
]);

const toCloudLicenseEligibilityError = (guardResult) => {
  if (
    guardResult?.code === 'LICENSE_EXPIRED'
    || guardResult?.code === 'LICENSE_LIFECYCLE_STALE'
    || String(guardResult?.code || '').toLowerCase() === 'expired'
    || guardResult?.code === 'LOCKED_RENEWAL'
  ) {
    return {
      ok: false,
      code: guardResult.code === 'LICENSE_LIFECYCLE_STALE' ? guardResult.code : 'LICENSE_EXPIRED',
      lifecycleState: guardResult.lifecycleState || null,
      gracePeriodEnds: guardResult.gracePeriodEnds || null
    };
  }

  if (guardResult?.code === 'LICENSE_NOT_ACTIVE' || LICENSE_LIFECYCLE_BLOCK_CODES.has(String(guardResult?.code || '').toLowerCase())) {
    return {
      ok: false,
      code: 'LICENSE_NOT_ACTIVE',
      lifecycleState: guardResult.lifecycleState || null,
      gracePeriodEnds: guardResult.gracePeriodEnds || null
    };
  }

  return {
    ok: false,
    code: guardResult?.code || 'LICENSE_INVALID',
    lifecycleState: guardResult?.lifecycleState || null,
    gracePeriodEnds: guardResult?.gracePeriodEnds || null
  };
};

export const getCustomerMessagingLicenseEligibility = (
  licenseDetails = {},
  state = useAppStore.getState()
) => {
  const canonicalLifecycle = String(licenseDetails?.lifecycle_state || '').trim().toLowerCase();
  if (licenseDetails?.is_entitled === false || LICENSE_LIFECYCLE_BLOCK_CODES.has(canonicalLifecycle)) {
    return {
      ok: false,
      code: canonicalLifecycle === 'administratively_blocked' ? 'LICENSE_NOT_ACTIVE' : 'LICENSE_EXPIRED',
      lifecycleState: canonicalLifecycle || null,
      gracePeriodEnds: licenseDetails?.grace_period_ends || null
    };
  }

  if (!isCloudCustomerMessagingEnabled(licenseDetails)) {
    return errorResult('CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE');
  }

  const guardResult = assertLocalTransactionAllowed(licenseDetails, {
    appStatus: state?.appStatus,
    licenseStatus: state?.licenseStatus,
    currentDeviceRole: state?.currentDeviceRole,
    currentStaffUser: state?.currentStaffUser,
    gracePeriodEnds: state?.gracePeriodEnds
  });

  if (!guardResult.ok) return toCloudLicenseEligibilityError(guardResult);

  return {
    ok: true,
    code: null,
    lifecycleState: guardResult.lifecycleState || canonicalLifecycle || 'active',
    gracePeriodEnds: guardResult.gracePeriodEnds || licenseDetails?.grace_period_ends || null
  };
};

export const getCustomerMessagingPlanRequirement = () => 'Lanzo Nube (Pro)';

const contextArgs = async (licenseDetails, actorType = null) => {
  const eligibility = getCustomerMessagingLicenseEligibility(licenseDetails);
  if (!eligibility.ok) return eligibility;
  if (!supabaseClient) return errorResult('SUPABASE_UNAVAILABLE');
  const licenseKey = licenseDetails?.license_key || licenseDetails?.details?.license_key;
  if (!licenseKey) return errorResult('LICENSE_MISSING');
  try {
    const context = await buildPosSyncAuthContext({ licenseKey, deviceRole: actorType });
    if (!context.deviceFingerprint || !context.securityToken || !context.staffSessionToken) {
      return errorResult('CUSTOMER_MESSAGE_AUTH_CONTEXT_MISSING');
    }
    return {
      ok: true,
      args: {
        p_license_key: context.licenseKey,
        p_device_fingerprint: context.deviceFingerprint,
        p_security_token: context.securityToken,
        p_staff_session_token: context.staffSessionToken
      }
    };
  } catch (error) {
    return errorResult(error?.code || 'CUSTOMER_MESSAGE_AUTH_CONTEXT_FAILED');
  }
};

const rpc = async (name, args) => {
  try {
    const { data, error } = await supabaseClient.rpc(name, args);
    if (error) return errorResult(error.code || 'CUSTOMER_MESSAGE_RPC_FAILED', error.message);
    const payload = parseRpcPayload(data);
    return payload?.success === false
      ? errorResult(payload.code || 'CUSTOMER_MESSAGE_RPC_FAILED', payload.message, payload)
      : { ok: true, ...payload };
  } catch (error) {
    return errorResult(error?.code || 'CUSTOMER_MESSAGE_RPC_FAILED', error?.message);
  }
};

export const createCustomerMessageCloudRepository = ({ getLicenseDetails = () => useAppStore.getState().licenseDetails } = {}) => ({
  async upsert(record, { actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails() } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return context;
    return rpc('upsert_customer_message_outbox', {
      ...context.args,
      p_idempotency_key: record.idempotencyKey,
      p_event_type: record.eventType,
      p_payload_snapshot: record.payloadSnapshot,
      p_human_reference: record.humanReference || null,
      p_template_snapshot: record.templateSnapshot || null,
      p_template_revision: Number(record.templateRevision || 0),
      p_template_source: record.templateSource || 'default',
      p_status: record.cloudStatus || 'preparado',
      p_max_attempts: Number(record.retryPolicy?.maxAttempts || 3),
      p_expires_at: record.expiresAt || null
    });
  },

  async list({ actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails(), limit = 100 } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return { ...context, records: [] };
    return rpc('list_customer_message_outbox', { ...context.args, p_limit: limit });
  },

  async transition(record, status, { actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails() } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return context;
    return rpc('transition_customer_message_outbox', {
      ...context.args,
      p_idempotency_key: record.idempotencyKey,
      p_status: status,
      p_expected_updated_at: record.cloudUpdatedAt || null,
      p_attempt_count: Number(record.attemptCount || 0),
      p_share_attempt_count: Number(record.shareAttemptCount || 0),
      p_last_error_code: record.lastErrorCode || null,
      p_next_retry_at: record.nextRetryAt || null,
      p_last_attempt_at: record.lastAttemptAt || null
    });
  },

  async listReminders({ actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails(), limit = 100 } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return { ...context, reminders: [], config: null };
    return rpc('list_customer_message_reminders', { ...context.args, p_limit: limit });
  },

  async saveReminderConfig({ enabled, timeZone, localTime, maxAttempts, backoffMinutes, actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails() } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return context;
    return rpc('save_customer_message_reminder_config', {
      ...context.args,
      p_enabled: Boolean(enabled),
      p_time_zone: timeZone,
      p_local_time: localTime,
      p_max_attempts: maxAttempts,
      p_backoff_minutes: backoffMinutes
    });
  },

  async scheduleReminder(customerId, { actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails() } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return context;
    return rpc('schedule_customer_message_reminder', { ...context.args, p_customer_id: customerId });
  },

  async cancelReminder(reminderId, { actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails() } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return context;
    return rpc('cancel_customer_message_reminder', { ...context.args, p_reminder_id: reminderId });
  },

  async rescheduleReminder(reminderId, scheduledFor, { actorType = useAppStore.getState().currentDeviceRole, licenseDetails = getLicenseDetails() } = {}) {
    const context = await contextArgs(licenseDetails, actorType);
    if (!context.ok) return context;
    return rpc('reschedule_customer_message_reminder', {
      ...context.args,
      p_reminder_id: reminderId,
      p_scheduled_for: scheduledFor
    });
  }
});

export const customerMessageCloudRepository = createCustomerMessageCloudRepository();

export const CUSTOMER_MESSAGE_CLOUD_FEATURE_KEYS = CLOUD_FEATURE_KEYS;

export default customerMessageCloudRepository;
