const LOCAL_DEFAULT_CAPABILITIES = Object.freeze({
  ticker_enabled: true,
  ticker_mode: 'local',
  local_system_alerts: true,
  local_inventory_alerts: true,
  local_backup_alerts: true,
  notification_center: false,
  cloud_notifications: false,
  support_channel: 'email',
  support_email_enabled: true,
  support_center: false,
  support_tickets: false,
  support_ticket_history: false,
  support_realtime: false,
  commercial_messages: 'generic',
  plan_messages_personalized: false
});

const CLOUD_INFERRED_CAPABILITIES = Object.freeze({
  ...LOCAL_DEFAULT_CAPABILITIES,
  ticker_mode: 'summary',
  local_backup_alerts: false,
  notification_center: true,
  cloud_notifications: true,
  support_channel: 'in_app',
  support_center: true,
  support_tickets: true,
  support_ticket_history: true,
  support_realtime: true,
  commercial_messages: 'personalized',
  plan_messages_personalized: true
});

const NOTIFICATION_CAPABILITY_KEYS = Object.freeze([
  'ticker_enabled',
  'ticker_mode',
  'local_system_alerts',
  'local_inventory_alerts',
  'local_backup_alerts',
  'notification_center',
  'cloud_notifications',
  'support_channel',
  'support_email_enabled',
  'support_center',
  'support_tickets',
  'support_ticket_history',
  'support_realtime',
  'commercial_messages',
  'plan_messages_personalized'
]);

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const getFeatures = (licenseDetails = {}) => {
  if (isPlainObject(licenseDetails?.features)) return licenseDetails.features;
  if (isPlainObject(licenseDetails?.details?.features)) return licenseDetails.details.features;
  return {};
};

const hasAnyNotificationCapability = (features = {}) => (
  NOTIFICATION_CAPABILITY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(features, key))
);

const isTrue = (value) => value === true || value === 'true';

const toBoolean = (value, fallback = false) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
};

const normalizeTickerMode = (value, fallback = 'local') => (
  value === 'summary' ? 'summary' : fallback
);

const normalizeSupportChannel = (value, fallback = 'email') => (
  value === 'in_app' ? 'in_app' : fallback
);

const getStaffPermissions = (staffSession = {}) => (
  staffSession?.permissions ||
  staffSession?.currentStaffUser?.permissions ||
  staffSession?.staffUser?.permissions ||
  {}
);

const isStaffSession = (staffSession = {}) => (
  staffSession?.isStaff === true ||
  staffSession?.deviceRole === 'staff' ||
  staffSession?.currentDeviceRole === 'staff'
);

export function canStaffAccessNotifications(_licenseDetails = {}, staffSession = {}) {
  if (!isStaffSession(staffSession)) return true;
  return getStaffPermissions(staffSession).notifications === true;
}

export function canStaffAccessSupportCenter(_licenseDetails = {}, staffSession = {}) {
  if (!isStaffSession(staffSession)) return true;
  return getStaffPermissions(staffSession).support_center === true;
}

export function getNotificationCapabilities(licenseDetails = {}) {
  const features = getFeatures(licenseDetails);
  const shouldInferCloudPlan = isTrue(features.realtime_license_sync) && !hasAnyNotificationCapability(features);
  const defaults = shouldInferCloudPlan ? CLOUD_INFERRED_CAPABILITIES : LOCAL_DEFAULT_CAPABILITIES;
  const merged = { ...defaults, ...features };

  return {
    ticker_enabled: toBoolean(merged.ticker_enabled, defaults.ticker_enabled),
    ticker_mode: normalizeTickerMode(merged.ticker_mode, defaults.ticker_mode),
    local_system_alerts: toBoolean(merged.local_system_alerts, defaults.local_system_alerts),
    local_inventory_alerts: toBoolean(merged.local_inventory_alerts, defaults.local_inventory_alerts),
    local_backup_alerts: toBoolean(merged.local_backup_alerts, defaults.local_backup_alerts),
    notification_center: toBoolean(merged.notification_center, defaults.notification_center),
    cloud_notifications: toBoolean(merged.cloud_notifications, defaults.cloud_notifications),
    support_channel: normalizeSupportChannel(merged.support_channel, defaults.support_channel),
    support_email_enabled: toBoolean(merged.support_email_enabled, defaults.support_email_enabled),
    support_center: toBoolean(merged.support_center, defaults.support_center),
    support_tickets: toBoolean(merged.support_tickets, defaults.support_tickets),
    support_ticket_history: toBoolean(merged.support_ticket_history, defaults.support_ticket_history),
    support_realtime: toBoolean(merged.support_realtime, defaults.support_realtime),
    commercial_messages: merged.commercial_messages === 'personalized' ? 'personalized' : 'generic',
    plan_messages_personalized: toBoolean(
      merged.plan_messages_personalized,
      defaults.plan_messages_personalized
    )
  };
}

export function isNotificationCenterEnabled(licenseDetails = {}) {
  return getNotificationCapabilities(licenseDetails).notification_center;
}

export function isCloudNotificationsEnabled(licenseDetails = {}) {
  return getNotificationCapabilities(licenseDetails).cloud_notifications;
}

export function isSupportCenterEnabled(licenseDetails = {}) {
  return getNotificationCapabilities(licenseDetails).support_center;
}

export function isSupportEmailEnabled(licenseDetails = {}) {
  return getNotificationCapabilities(licenseDetails).support_email_enabled;
}

export function getSupportChannel(licenseDetails = {}) {
  return getNotificationCapabilities(licenseDetails).support_channel;
}

export function getTickerMode(licenseDetails = {}) {
  return getNotificationCapabilities(licenseDetails).ticker_mode;
}

export function shouldUseLocalTicker(licenseDetails = {}) {
  const capabilities = getNotificationCapabilities(licenseDetails);
  return capabilities.ticker_enabled && capabilities.ticker_mode === 'local';
}

export function shouldUseSummaryTicker(licenseDetails = {}) {
  const capabilities = getNotificationCapabilities(licenseDetails);
  return capabilities.ticker_enabled && capabilities.ticker_mode === 'summary';
}
