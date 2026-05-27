import Logger from '../../services/Logger';

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

  setStorageCritical: (value) => set({ isStorageCritical: Boolean(value) }),
  setTransactionInProgress: (value) => set({ isTransactionInProgress: Boolean(value) }),
  setVolatileDismissed: (value) => set({ isVolatileDismissed: Boolean(value) })
});
