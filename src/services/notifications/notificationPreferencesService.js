const STORAGE_PREFIX = 'lanzo_notification_preferences:v2';

export const NOTIFICATION_CATEGORIES = ['support', 'ecommerce', 'operations', 'license', 'system'];

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  showInfoNotifications: true,
  compactMode: false,
  tickerCategories: {
    support: true,
    ecommerce: true,
    operations: true,
    license: true,
    system: false
  },
  featuredCategories: {
    support: true,
    ecommerce: true,
    operations: true,
    license: true,
    system: false
  },
  mutedCategories: {
    support: null,
    ecommerce: null,
    operations: null,
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

const stableScopeHash = (value = '') => {
  const input = String(value || '');
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
};

const getStorageKey = (scope) => (
  scope ? `${STORAGE_PREFIX}:${stableScopeHash(scope)}` : null
);

const normalizeLegacyOperationValue = (value = {}, fallback) => {
  if (value.operations !== undefined) return value.operations;
  if (value.cash === false && value.sync === false) return false;
  if (value.cash === true || value.sync === true) return true;
  return fallback;
};

const normalizeLegacyMutedOperation = (value = {}, fallback = null) => {
  if (value.operations !== undefined) return value.operations;
  const candidates = [value.cash, value.sync].filter(Boolean);
  if (candidates.length === 0) return fallback;
  return candidates.sort().at(-1) || fallback;
};

const normalizeCategoryMap = (value, fallbackMap, { muted = false } = {}) => (
  NOTIFICATION_CATEGORIES.reduce((acc, category) => {
    if (category === 'operations') {
      acc[category] = muted
        ? normalizeLegacyMutedOperation(value, fallbackMap?.[category] ?? null)
        : normalizeLegacyOperationValue(value, fallbackMap?.[category] ?? null);
      return acc;
    }

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
    mutedCategories: normalizeCategoryMap(
      preferences.mutedCategories,
      defaults.mutedCategories,
      { muted: true }
    ),
    mutedEventKeys: {
      ...defaults.mutedEventKeys,
      ...(preferences.mutedEventKeys || {})
    }
  };
}

export function getNotificationPreferences(scope = null) {
  const storageKey = getStorageKey(scope);
  if (!storageKey || !canUseLocalStorage()) {
    return cloneDefaults();
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return cloneDefaults();
    return normalizeNotificationPreferences(JSON.parse(raw));
  } catch {
    return cloneDefaults();
  }
}

export function saveNotificationPreferences(preferences, scope = null) {
  const normalized = normalizeNotificationPreferences(preferences);
  const storageKey = getStorageKey(scope);

  if (!storageKey || !canUseLocalStorage()) {
    return normalized;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  } catch {
    // La preferencia en memoria sigue funcionando aunque el navegador bloquee storage.
  }

  return normalized;
}

export function resetNotificationPreferences(scope = null) {
  const defaults = cloneDefaults();
  const storageKey = getStorageKey(scope);

  if (storageKey && canUseLocalStorage()) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // No se requiere acción adicional.
    }
  }

  return defaults;
}

export function getNotificationCategory(notification = {}) {
  const explicitCategory = notification?.category;
  if (NOTIFICATION_CATEGORIES.includes(explicitCategory)) return explicitCategory;

  const type = String(notification?.type || notification?.section || 'system').toLowerCase();
  const metadataCategory = String(notification?.metadata?.category || '').toLowerCase();

  if (type === 'support' || metadataCategory === 'support') return 'support';
  if (type === 'ecommerce' || metadataCategory === 'ecommerce') return 'ecommerce';
  if (type === 'license' || metadataCategory === 'license') return 'license';

  if (
    ['cash', 'sync', 'inventory'].includes(type)
    || ['cash', 'sync', 'inventory', 'staff', 'operation', 'operations'].includes(metadataCategory)
  ) {
    return 'operations';
  }

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

export function isCategoryMuted(category, preferences = normalizeNotificationPreferences()) {
  const normalized = normalizeNotificationPreferences(preferences);
  return isFutureDate(normalized.mutedCategories?.[category]);
}

export function isNotificationCategoryMuted(notification, preferences = normalizeNotificationPreferences()) {
  return isCategoryMuted(getNotificationCategory(notification), preferences);
}

export function muteCategory(
  category,
  durationMs,
  preferences = normalizeNotificationPreferences(),
  scope = null
) {
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
  }, scope);
}

export function unmuteCategory(
  category,
  preferences = normalizeNotificationPreferences(),
  scope = null
) {
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
  }, scope);
}

export function isNotificationHiddenByPreferences(
  notification,
  preferences = normalizeNotificationPreferences(),
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

export function shouldFeatureNotification(
  notification,
  preferences = normalizeNotificationPreferences()
) {
  const normalized = normalizeNotificationPreferences(preferences);
  const severity = notification?.severity || notification?.tone || 'info';
  const category = getNotificationCategory(notification);

  if (severity === 'critical' || category === 'support') return true;
  if (isCategoryMuted(category, normalized)) return false;
  if (severity === 'info' && normalized.showInfoNotifications === false) return false;

  return normalized.featuredCategories?.[category] !== false;
}
