import Logger from '../../services/Logger';
import {
  CASH_OPENING_POLICY,
  getCashOpeningPolicy,
  setCashOpeningPolicy
} from '../../services/cashOpeningPolicyService.js';

const BACKUP_NOTICE_DISMISSED_KEY = 'lanzo_backup_notice_dismissed';

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
  showAssistantBot: (() => {
    try {
      const saved = localStorage.getItem('lanzo_show_bot');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  })(),
  showTicker: (() => {
    try {
      const saved = localStorage.getItem('lanzo_show_ticker');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  })(),

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
    try {
      localStorage.setItem('lanzo_show_bot', JSON.stringify(value));
    } catch {
      Logger.error('Error al guardar la preferencia del asistente:');
    }
    set({ showAssistantBot: value });
  },

  setShowTicker: (value) => {
    try {
      localStorage.setItem('lanzo_show_ticker', JSON.stringify(value));
    } catch {
      Logger.error('Error al guardar la preferencia del ticker:');
    }
    set({ showTicker: value });
  },

  enableMultipleOrders: (() => {
    try {
      const saved = localStorage.getItem('lanzo_enable_multiple_orders');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  })(),

  setEnableMultipleOrders: (value) => {
    try {
      localStorage.setItem('lanzo_enable_multiple_orders', JSON.stringify(value));
    } catch {
      Logger.error('Error al guardar la preferencia de multiples ordenes:');
    }
    set({ enableMultipleOrders: value });
  },

  cashOpeningPolicy: getCashOpeningPolicy(),

  setCashOpeningPolicy: (policy) => {
    const normalized = setCashOpeningPolicy(policy);
    set({ cashOpeningPolicy: normalized });
  },

  isAutomaticCashOpeningEnabled: () => (
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
