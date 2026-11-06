export const createPWASlice = (set, get) => {
  // Mantener fuera del estado evita no-serializables en Zustand.
  let triggerUpdateRef = null;

  return {
    deferredPrompt: null,
    isInstallable: false,
    isIOS: false,
    isStandalone: false,
    updateAvailable: false,
    showInstallModal: false,
    showUpdateModal: false,
    isInstalling: false,
    isUpdating: false,
    updateError: null,
    updateId: null,

  setInstallContext: ({ isIOS = false, isStandalone = false }) =>
    set((state) => {
      const deferredPrompt = state.deferredPrompt;
      const isInstallable = !isStandalone && (Boolean(deferredPrompt) || isIOS);

      return {
        isIOS,
        isStandalone,
        isInstallable,
        // La invitación automática se gobierna por engagement visible en
        // InstallPrompt; volverse instalable no debe abrirla durante onboarding.
        showInstallModal: isInstallable ? state.showInstallModal : false
      };
    }),

  setDeferredPrompt: (prompt) =>
    set((state) => {
      const deferredPrompt = prompt || null;
      const isInstallable = !state.isStandalone && (Boolean(deferredPrompt) || state.isIOS);

      return {
        deferredPrompt,
        isInstallable,
        showInstallModal: isInstallable ? state.showInstallModal : false
      };
    }),

  openInstallModal: () => {
    if (!get().isInstallable) return;
    set({ showInstallModal: true });
  },

  closeInstallModal: () => set({ showInstallModal: false }),

  markInstalled: () => {
    set({
      deferredPrompt: null,
      isInstallable: false,
      isStandalone: true,
      showInstallModal: false
    });
  },

  requestInstall: async () => {
    const { isInstalling, isIOS, isStandalone, deferredPrompt } = get();

    if (isInstalling || isStandalone) return;

    if (isIOS) {
      set({ showInstallModal: true });
      return;
    }

    if (!deferredPrompt) return;

    set({ isInstalling: true });

    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (error) {
      console.error('Error consumiendo deferredPrompt:', error);
    } finally {
      if (typeof window !== 'undefined') {
        window.deferredPwaPrompt = null;
      }

      set({
        deferredPrompt: null,
        isInstallable: false,
        showInstallModal: false,
        isInstalling: false
      });
    }
  },

  setUpdateAvailable: (available, updateId = null) => {
    const current = get();
    if (available) {
      const isNew = !current.updateAvailable || (updateId && current.updateId && current.updateId !== updateId);
      set({ updateAvailable: true, updateId: updateId || current.updateId,
        showUpdateModal: isNew || current.showUpdateModal });
      return;
    }
    set({ updateAvailable: false, showUpdateModal: false, updateId: null });
  },

    setTriggerUpdate: (fn) => {
      triggerUpdateRef = typeof fn === 'function' ? fn : null;
    },

  openUpdateModal: () => {
    if (!get().updateAvailable) return;
    set({ showUpdateModal: true });
  },

  closeUpdateModal: () => set({ showUpdateModal: false }),

    runUpdate: async () => {
      const { isUpdating } = get();

      if (!triggerUpdateRef || isUpdating) return;

      set({ isUpdating: true, updateError: null });

      try {
        const reloaded = await triggerUpdateRef(true);
        if (reloaded === false) {
          set({ updateAvailable: true, showUpdateModal: true, isUpdating: false });
          return;
        }
        // Reload requested is not proof of completion (beforeunload can cancel).
        // Only a document running the target build may report completion.
        set({ isUpdating: false, updateAvailable: true, updateError: 'Actualización pendiente de completar.' });
      } catch (error) {
        console.error('Error aplicando actualizacion del Service Worker:', error);
        set({ isUpdating: false, updateAvailable: true, showUpdateModal: true,
          updateError: error?.message || 'No pudimos aplicar la actualización. Inténtalo de nuevo.' });
      }
    }
  };
};
