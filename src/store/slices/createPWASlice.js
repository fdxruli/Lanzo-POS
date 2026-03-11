export const createPWASlice = (set, get) => ({
  deferredPrompt: null,
  isInstallable: false,
  isIOS: false,
  isStandalone: false,
  updateAvailable: false,
  triggerUpdate: null,
  showInstallModal: false,
  showUpdateModal: false,
  isInstalling: false,
  isUpdating: false,

  setInstallContext: ({ isIOS = false, isStandalone = false }) =>
    set((state) => {
      const deferredPrompt = state.deferredPrompt;
      const isInstallable = !isStandalone && (Boolean(deferredPrompt) || isIOS);
      const becameInstallable = isInstallable && !state.isInstallable;

      return {
        isIOS,
        isStandalone,
        isInstallable,
        showInstallModal: isInstallable ? state.showInstallModal || becameInstallable : false
      };
    }),

  setDeferredPrompt: (prompt) =>
    set((state) => {
      const deferredPrompt = prompt || null;
      const isInstallable = !state.isStandalone && (Boolean(deferredPrompt) || state.isIOS);
      const becameInstallable = isInstallable && !state.isInstallable;

      return {
        deferredPrompt,
        isInstallable,
        showInstallModal: isInstallable ? state.showInstallModal || becameInstallable : false
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

  setUpdateAvailable: (available) => {
    if (available) {
      set({ updateAvailable: true, showUpdateModal: true });
      return;
    }
    set({ updateAvailable: false, showUpdateModal: false });
  },

  setTriggerUpdate: (fn) => set({ triggerUpdate: typeof fn === 'function' ? fn : null }),

  openUpdateModal: () => {
    if (!get().updateAvailable) return;
    set({ showUpdateModal: true });
  },

  closeUpdateModal: () => set({ showUpdateModal: false }),

  runUpdate: async () => {
    const { triggerUpdate, isUpdating } = get();

    if (!triggerUpdate || isUpdating) return;

    set({ isUpdating: true });

    try {
      await triggerUpdate(true);
      set({ updateAvailable: false, showUpdateModal: false, isUpdating: false });
    } catch (error) {
      console.error('Error aplicando actualizacion del Service Worker:', error);
      set({ isUpdating: false });
    }
  }
});
