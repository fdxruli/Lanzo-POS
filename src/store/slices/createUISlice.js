import Logger from '../../services/Logger';

export const createUISlice = (set, get) => ({
  appStatus: 'loading',
  serverHealth: 'ok',
  serverMessage: null,
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
  }
});