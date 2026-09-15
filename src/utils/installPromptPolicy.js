export const INSTALL_ENGAGEMENT_STORAGE_KEY = 'lanzo_install_engagement_v1';
export const LEGACY_INSTALL_DISMISSED_KEY = 'lanzo_install_dismissed';
export const INSTALL_ENGAGEMENT_THRESHOLD_MS = 5 * 60 * 1000;

const EMPTY_ENGAGEMENT = {
  activeTimeMs: 0,
  lastActiveAt: null,
  invitationEnabled: false,
  dismissedAt: null,
};

const getDefaultStorage = () => (
  typeof globalThis !== 'undefined' ? globalThis.localStorage : null
);

const toTimestamp = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

const normalizeEngagement = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_ENGAGEMENT };
  }

  const activeTimeMs = Number(value.activeTimeMs);
  const normalizedActiveTime = Number.isFinite(activeTimeMs)
    ? Math.max(0, Math.min(activeTimeMs, INSTALL_ENGAGEMENT_THRESHOLD_MS))
    : 0;

  return {
    activeTimeMs: normalizedActiveTime,
    lastActiveAt: toTimestamp(value.lastActiveAt),
    invitationEnabled: value.invitationEnabled === true
      || normalizedActiveTime >= INSTALL_ENGAGEMENT_THRESHOLD_MS,
    dismissedAt: toTimestamp(value.dismissedAt),
  };
};

export const readInstallEngagement = (storage = getDefaultStorage()) => {
  if (!storage?.getItem) return { ...EMPTY_ENGAGEMENT };

  try {
    const serialized = storage.getItem(INSTALL_ENGAGEMENT_STORAGE_KEY);
    return serialized ? normalizeEngagement(JSON.parse(serialized)) : { ...EMPTY_ENGAGEMENT };
  } catch {
    return { ...EMPTY_ENGAGEMENT };
  }
};

export const writeInstallEngagement = (engagement, storage = getDefaultStorage()) => {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(
      INSTALL_ENGAGEMENT_STORAGE_KEY,
      JSON.stringify(normalizeEngagement(engagement))
    );
    return true;
  } catch {
    return false;
  }
};

export const startActiveEngagement = (engagement, now = Date.now()) => ({
  ...normalizeEngagement(engagement),
  lastActiveAt: toTimestamp(now),
});

export const pauseActiveEngagement = (engagement, now = Date.now()) => ({
  ...flushActiveEngagement(engagement, now),
  lastActiveAt: null,
});

export const flushActiveEngagement = (engagement, now = Date.now()) => {
  const current = normalizeEngagement(engagement);
  const currentTimestamp = toTimestamp(now);
  const lastActiveAt = current.lastActiveAt;

  if (!currentTimestamp || !lastActiveAt) return current;

  const elapsed = Math.max(0, currentTimestamp - lastActiveAt);
  const activeTimeMs = Math.min(
    INSTALL_ENGAGEMENT_THRESHOLD_MS,
    current.activeTimeMs + elapsed
  );

  return {
    ...current,
    activeTimeMs,
    invitationEnabled: current.invitationEnabled
      || activeTimeMs >= INSTALL_ENGAGEMENT_THRESHOLD_MS,
    lastActiveAt: currentTimestamp,
  };
};

export const isInstallPromptDismissed = (
  engagement,
  storage = getDefaultStorage()
) => {
  if (normalizeEngagement(engagement).dismissedAt) return true;

  try {
    return storage?.getItem?.(LEGACY_INSTALL_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const dismissInstallPrompt = (engagement, now = Date.now(), storage = getDefaultStorage()) => {
  const nextEngagement = {
    ...normalizeEngagement(engagement),
    dismissedAt: toTimestamp(now),
  };

  try {
    storage?.setItem?.(LEGACY_INSTALL_DISMISSED_KEY, 'true');
  } catch {
    // El estado en memoria/local versionado sigue siendo suficiente.
  }

  writeInstallEngagement(nextEngagement, storage);
  return nextEngagement;
};

export const clearInstallPromptDismissal = (storage = getDefaultStorage()) => {
  try {
    storage?.removeItem?.(LEGACY_INSTALL_DISMISSED_KEY);
  } catch {
    // Best effort para conservar compatibilidad con navegadores restringidos.
  }

  const engagement = readInstallEngagement(storage);
  return writeInstallEngagement({ ...engagement, dismissedAt: null }, storage);
};

export const getInstallPromptEligibility = ({
  appStatus,
  isInstallable,
  isStandalone,
  isIOS,
  deferredPrompt,
  showUpdateModal,
  pendingTermsUpdate,
  isStorageCritical,
  hasBlockingModal,
  engagement,
  dismissed,
}) => {
  const normalizedEngagement = normalizeEngagement(engagement);

  return Boolean(
    appStatus === 'ready'
    && isInstallable
    && !isStandalone
    && (isIOS || deferredPrompt)
    && normalizedEngagement.invitationEnabled
    && !dismissed
    && !showUpdateModal
    && !pendingTermsUpdate
    && !isStorageCritical
    && !hasBlockingModal
  );
};

const isHiddenElement = (element) => {
  if (!element) return true;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;

  const style = typeof window !== 'undefined' && window.getComputedStyle
    ? window.getComputedStyle(element)
    : null;

  return style?.display === 'none' || style?.visibility === 'hidden';
};

const isVisibleElement = (element) => {
  for (let current = element; current; current = current.parentElement) {
    if (isHiddenElement(current)) return false;
  }

  return true;
};

export const hasBlockingModal = () => {
  if (typeof document === 'undefined') return false;

  const explicitMarkers = Array.from(
    document.querySelectorAll('[data-lanzo-blocking-modal="true"]')
  );

  // The pending DataSafety marker is intentionally hidden while its async
  // eligibility check runs, but it still reserves the notice slot.
  if (explicitMarkers.some((element) => (
    element.getAttribute('data-lanzo-notice-pending') === 'true'
      || isVisibleElement(element)
  ))) {
    return true;
  }

  return Array.from(document.querySelectorAll(
    '#business-setup-modal, .ui-modal, .modal, [role="dialog"]'
  )).some(isVisibleElement);
};
