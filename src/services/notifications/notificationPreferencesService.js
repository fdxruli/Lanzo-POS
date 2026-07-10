const STORAGE_KEY = 'lanzo_notification_preferences:v1';

export const NOTIFICATION_CATEGORIES = ['support', 'cash', 'sync', 'license', 'system'];

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  showInfoNotifications: true,
  compactMode: false,
  tickerCategories: {
    support: true,
    cash: true,
    sync: true,
    license: true,
    system: false
  },
  featuredCategories: {
    support: true,
    cash: true,
    sync: true,
    license: true,
    system: false
  },
  mutedCategories: {
    support: null,
    cash: null,
    sync: null,
    license: null,
    system: null
  },
  mutedEventKeys: {}
};

const canUseLocalStorage = () => (
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined'
);

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES));

const normalizeCategoryMap = (value, fallbackMap) => (
  NOTIFICATION_CATEGORIES.reduce((acc, category) => {
    acc[category] = value?.[category] ?? fallbackMap?.[category] ?? null;
    return acc;
  }, {})
);

export function normalizeNotificationPreferences(preferences = {}) {
  const defaults = cloneDefaults();

  return {
    ...defaults,
    ...preferences,
    showInfoNotifications: preferences.showInfoNotifications !== false,
    compactMode: preferences.compactMode === true,
    tickerCategories: normalizeCategoryMap(
      preferences.tickerCategories,
      defaults.tickerCategories
    ),
    featuredCategories: normalizeCategoryMap(
      preferences.featuredCategories,
      defaults.featuredCategories
    ),
    mutedCategories: normalizeCategoryMap(preferences.mutedCategories, defaults.mutedCategories),
    mutedEventKeys: {
      ...defaults.mutedEventKeys,
      ...(preferences.mutedEventKeys || {})
    }
  };
}

export function getNotificationPreferences() {
  if (!canUseLocalStorage()) {
    return cloneDefaults();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    return normalizeNotificationPreferences(JSON.parse(raw));
  } catch {
    return cloneDefaults();
  }
}

export function saveNotificationPreferences(preferences) {
  const normalized = normalizeNotificationPreferences(preferences);

  if (!canUseLocalStorage()) {
    return normalized;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // La preferencia en memoria sigue funcionando aunque el navegador bloquee storage.
  }

  return normalized;
}

export function resetNotificationPreferences() {
  const defaults = cloneDefaults();

  if (canUseLocalStorage()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No se requiere accion adicional.
    }
  }

  return defaults;
}

export function getNotificationCategory(notification = {}) {
  const type = notification?.type || notification?.section || 'system';
  const metadataCategory = notification?.metadata?.category;

  if (type === 'support') return 'support';
  if (type === 'cash' || metadataCategory === 'cash') return 'cash';
  if (type === 'sync' || metadataCategory === 'sync') return 'sync';
  if (type === 'license') return 'license';
  return 'system';
}

export function getNotificationEventKey(notification = {}) {
  return notification?.metadata?.event_key || notification?.event_key || null;
}

const isFutureDate = (value) => {
  if (!value) return false;
  const expiresAt = new Date(value).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

export function isCategoryMuted(category, preferences = getNotificationPreferences()) {
  const normalized = normalizeNotificationPreferences(preferences);
  return isFutureDate(normalized.mutedCategories?.[category]);
}

export function isNotificationCategoryMuted(notification, preferences = getNotificationPreferences()) {
  return isCategoryMuted(getNotificationCategory(notification), preferences);
}

export function muteCategory(category, durationMs, preferences = getNotificationPreferences()) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    return normalizeNotificationPreferences(preferences);
  }

  const expiresAt = new Date(Date.now() + Number(durationMs || 0)).toISOString();
  return saveNotificationPreferences({
    ...normalizeNotificationPreferences(preferences),
    mutedCategories: {
      ...normalizeNotificationPreferences(preferences).mutedCategories,
      [category]: expiresAt
    }
  });
}

export function unmuteCategory(category, preferences = getNotificationPreferences()) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    return normalizeNotificationPreferences(preferences);
  }

  const normalized = normalizeNotificationPreferences(preferences);
  return saveNotificationPreferences({
    ...normalized,
    mutedCategories: {
      ...normalized.mutedCategories,
      [category]: null
    }
  });
}

export function isNotificationHiddenByPreferences(
  notification,
  preferences = getNotificationPreferences(),
  { surface = 'center' } = {}
) {
  const normalized = normalizeNotificationPreferences(preferences);
  const severity = notification?.severity || notification?.tone || 'info';
  const category = getNotificationCategory(notification);
  const eventKey = getNotificationEventKey(notification);

  if (severity === 'critical') return false;
  if (category === 'support' && surface === 'center') return false;

  if (eventKey && isFutureDate(normalized.mutedEventKeys?.[eventKey])) {
    return surface === 'ticker';
  }

  if (surface === 'ticker' && normalized.tickerCategories?.[category] === false) {
    return true;
  }

  if (severity === 'info' && normalized.showInfoNotifications === false) {
    return surface === 'ticker';
  }

  return surface === 'ticker' && isCategoryMuted(category, normalized);
}

export function shouldFeatureNotification(notification, preferences = getNotificationPreferences()) {
  const normalized = normalizeNotificationPreferences(preferences);
  const severity = notification?.severity || notification?.tone || 'info';
  const category = getNotificationCategory(notification);

  if (severity === 'critical' || category === 'support') return true;
  if (isCategoryMuted(category, normalized)) return false;
  if (severity === 'info' && normalized.showInfoNotifications === false) return false;

  return normalized.featuredCategories?.[category] !== false;
}
