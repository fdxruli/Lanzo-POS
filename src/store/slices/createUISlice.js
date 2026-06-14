import Logger from '../../services/Logger';

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

export const createUISlice = (set, get) => ({
  appStatus: 'loading',
  serverHealth: 'ok',
  serverMessage: null,
  isBackupLoading: false,
  showAssistantBot: (() => {
    try {
      const saved = localStorage.getItem('lanzo_show_bot');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  })(),
  showTicker: (() => {
    try {
      const saved = localStorage.getItem('lanzo_show_ticker');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  })(),

  dismissServerAlert: () => {
    Logger.log('User dismissed server alert');
    set({ serverMessage: null });
  },

  reportServerFailure: (message) => {
    const currentMsg = get().serverMessage;
    if (!currentMsg) {
      set({
        serverHealth: 'down',
        serverMessage: message || 'Conexión interrumpida con el servidor de licencias'
      });
    }
  },

  setShowAssistantBot: (value) => {
    try {
      localStorage.setItem('lanzo_show_bot', JSON.stringify(value));
    } catch (e) {
      Logger.error('Error al guardar la preferencia del asistente:');
    }
    set({ showAssistantBot: value });
  },

  setShowTicker: (value) => {
    try {
      localStorage.setItem('lanzo_show_ticker', JSON.stringify(value));
    } catch (e) {
      Logger.error('Error al guardar la preferencia del ticker:');
    }
    set({ showTicker: value });
  },

  enableMultipleOrders: (() => {
    try {
      const saved = localStorage.getItem('lanzo_enable_multiple_orders');
      return saved !== null ? JSON.parse(saved) : false;
    } catch (e) {
      return false;
    }
  })(),

  setEnableMultipleOrders: (value) => {
    try {
      localStorage.setItem('lanzo_enable_multiple_orders', JSON.stringify(value));
    } catch (e) {
      Logger.error('Error al guardar la preferencia de multiples ordenes:');
    }
    set({ enableMultipleOrders: value });
  },

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
