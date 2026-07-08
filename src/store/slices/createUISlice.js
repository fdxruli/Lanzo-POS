import Logger from '../../services/Logger';
import {
  CASH_OPENING_POLICY,
  getCashOpeningPolicy,
  setCashOpeningPolicy
} from '../../services/cashOpeningPolicyService.js';
import { isCloudCashSyncEnabled } from '../../services/sync/syncConstants.js';

const BACKUP_NOTICE_DISMISSED_KEY = 'lanzo_backup_notice_dismissed';
const SHOW_ASSISTANT_BOT_KEY = 'lanzo_show_bot:v1';
const SHOW_ASSISTANT_BOT_LEGACY_KEY = 'lanzo_show_bot';
const SHOW_TICKER_KEY = 'lanzo_show_ticker:v1';
const SHOW_TICKER_LEGACY_KEY = 'lanzo_show_ticker';
const ENABLE_MULTIPLE_ORDERS_KEY = 'lanzo_enable_multiple_orders:v1';
const ENABLE_MULTIPLE_ORDERS_LEGACY_KEY = 'lanzo_enable_multiple_orders';

function readBooleanPreference(key, legacyKey, fallback) {
  try {
    const saved = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    return saved !== null ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function persistBooleanPreference(key, value, errorMessage) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    Logger.error(errorMessage);
  }
}

function readDismissedBackupNotice() {
  try {
    return sessionStorage.getItem(BACKUP_NOTICE_DISMISSED_KEY);
  } catch {
    return null;
  }
}

function persistDismissedBackupNotice(noticeKey) {
  try {
    if (noticeKey) sessionStorage.setItem(BACKUP_NOTICE_DISMISSED_KEY, noticeKey);
    else sessionStorage.removeItem(BACKUP_NOTICE_DISMISSED_KEY);
  } catch {
    // El estado en memoria sigue funcionando cuando sessionStorage no esta disponible.
  }
}

const isRealtimeLicense = (state = {}) => (
  state.licenseDetails?.features?.realtime_license_sync === true
);

const getDefaultServerMessage = (health) => {
  if (health === 'degraded') {
    return 'Supabase está respondiendo más lento de lo normal. Lanzo POS seguirá reintentando en segundo plano.';
  }

  return 'No se pudo mantener comunicación estable con Supabase. Lanzo POS seguirá reintentando en segundo plano.';
};

export const createUISlice = (set, get) => ({
  appStatus: 'loading',

  // Estado de Supabase visible solo para licencias con realtime habilitado.
  // FREE/BASIC no deben ver banners de conexión.
  serverHealth: 'ok', // ok | degraded | down
  serverMessage: null,
  serverStatusReason: null,
  serverStatusUpdatedAt: null,

  isBackupLoading: false,
  showAssistantBot: readBooleanPreference(SHOW_ASSISTANT_BOT_KEY, SHOW_ASSISTANT_BOT_LEGACY_KEY, true),
  showTicker: readBooleanPreference(SHOW_TICKER_KEY, SHOW_TICKER_LEGACY_KEY, true),

  shouldShowServerStatusBanner: () => {
    const state = get();

    return (
      isRealtimeLicense(state) &&
      state.serverHealth !== 'ok' &&
      Boolean(state.serverMessage)
    );
  },

  clearServerStatus: () => {
    set({
      serverHealth: 'ok',
      serverMessage: null,
      serverStatusReason: null,
      serverStatusUpdatedAt: null
    });
  },

  dismissServerAlert: () => {
    Logger.log('User dismissed server alert');

    set({
      serverHealth: 'ok',
      serverMessage: null,
      serverStatusReason: null,
      serverStatusUpdatedAt: null
    });
  },

  reportServerStatus: (health = 'down', message = null, reason = 'server_status') => {
    const state = get();

    // Regla principal:
    // FREE/BASIC no deben mostrar avisos de conexión.
    if (!isRealtimeLicense(state)) {
      if (state.serverHealth !== 'ok' || state.serverMessage) {
        set({
          serverHealth: 'ok',
          serverMessage: null,
          serverStatusReason: null,
          serverStatusUpdatedAt: null
        });
      }

      return false;
    }

    const normalizedHealth = health === 'degraded' ? 'degraded' : 'down';
    const nextMessage = message || getDefaultServerMessage(normalizedHealth);

    if (
      state.serverHealth === normalizedHealth &&
      state.serverMessage === nextMessage &&
      state.serverStatusReason === reason
    ) {
      return true;
    }

    set({
      serverHealth: normalizedHealth,
      serverMessage: nextMessage,
      serverStatusReason: reason,
      serverStatusUpdatedAt: Date.now()
    });

    return true;
  },

  reportServerFailure: (message, options = {}) => {
    return get().reportServerStatus(
      options.health || 'down',
      message,
      options.reason || 'server_failure'
    );
  },

  setShowAssistantBot: (value) => {
    persistBooleanPreference(SHOW_ASSISTANT_BOT_KEY, value, 'Error al guardar la preferencia del asistente:');
    set({ showAssistantBot: value });
  },

  setShowTicker: (value) => {
    persistBooleanPreference(SHOW_TICKER_KEY, value, 'Error al guardar la preferencia del ticker:');
    set({ showTicker: value });
  },

  enableMultipleOrders: readBooleanPreference(
    ENABLE_MULTIPLE_ORDERS_KEY,
    ENABLE_MULTIPLE_ORDERS_LEGACY_KEY,
    false
  ),

  setEnableMultipleOrders: (value) => {
    persistBooleanPreference(ENABLE_MULTIPLE_ORDERS_KEY, value, 'Error al guardar la preferencia de multiples ordenes:');
    set({ enableMultipleOrders: value });
  },

  cashOpeningPolicy: getCashOpeningPolicy(),

  setCashOpeningPolicy: (policy) => {
    const requestedPolicy = isCloudCashSyncEnabled(get().licenseDetails)
      ? CASH_OPENING_POLICY.MANUAL
      : policy;
    const normalized = setCashOpeningPolicy(requestedPolicy);
    set({ cashOpeningPolicy: normalized });
  },

  isAutomaticCashOpeningEnabled: () => (
    !isCloudCashSyncEnabled(get().licenseDetails) &&
    get().cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC
  ),

  setBackupLoading: (value) => {
    set({ isBackupLoading: Boolean(value) });
  },

  startBackupLoading: () => set({ isBackupLoading: true }),
  stopBackupLoading: () => set({ isBackupLoading: false }),

  // --- Estados de Interrupción y Respaldo ---
  isStorageCritical: false,
  isTransactionInProgress: false,
  isVolatileDismissed: false,
  dismissedBackupNotice: readDismissedBackupNotice(),

  setStorageCritical: (value) => set({ isStorageCritical: Boolean(value) }),
  setTransactionInProgress: (value) => set({ isTransactionInProgress: Boolean(value) }),
  setVolatileDismissed: (value) => set({ isVolatileDismissed: Boolean(value) }),
  dismissBackupNotice: (noticeKey) => {
    persistDismissedBackupNotice(noticeKey);
    set({ dismissedBackupNotice: noticeKey });
  },
  showBackupNotice: () => {
    persistDismissedBackupNotice(null);
    set({ dismissedBackupNotice: null });
  }
});
