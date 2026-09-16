import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  clearInstallPromptDismissal,
  dismissInstallPrompt,
  flushActiveEngagement,
  getInstallPromptEligibility,
  hasBlockingModal,
  isInstallPromptDismissed,
  pauseActiveEngagement,
  readInstallEngagement,
  startActiveEngagement,
  writeInstallEngagement,
} from '../../utils/installPromptPolicy';

const ShareIcon = () => (
  <span style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 4px' }}>
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--primary-color)' }}
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  </span>
);

const checkIsIOS = () => {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIPadOS = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/.test(userAgent) || isIPadOS;
};

const checkIsStandalone = () => {
  if (typeof window === 'undefined') return false;

  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
};

const overlayStyle = {
  position: 'fixed',
  bottom: '20px',
  left: '50%',
  transform: 'translateX(-50%)',
  width: '90%',
  maxWidth: '400px',
  backgroundColor: 'var(--card-background-color)',
  borderRadius: 'var(--border-radius)',
  padding: 'var(--spacing-lg)',
  boxShadow: 'var(--box-shadow-lg)',
  zIndex: 'var(--z-toast)',
  border: '1px solid var(--border-color)',
  animation: 'slideUp 0.5s ease-out'
};

const titleStyle = {
  fontSize: '1.1rem',
  fontWeight: '700',
  marginBottom: 'var(--spacing-xs)',
  color: 'var(--text-dark)'
};

const textStyle = {
  fontSize: '0.95rem',
  color: 'var(--text-color)',
  marginBottom: 'var(--spacing-md)',
  lineHeight: '1.5'
};

const closeBtnStyle = {
  position: 'absolute',
  top: '12px',
  right: '15px',
  background: 'none',
  border: 'none',
  fontSize: '18px',
  color: 'var(--text-light)',
  cursor: 'pointer',
  padding: '4px'
};

const InstallPrompt = () => {
  const appStatus = useAppStore((state) => state.appStatus);
  const isIOS = useAppStore((state) => state.isIOS);
  const isStandalone = useAppStore((state) => state.isStandalone);
  const showInstallModal = useAppStore((state) => state.showInstallModal);
  const isInstalling = useAppStore((state) => state.isInstalling);
  const isInstallable = useAppStore((state) => state.isInstallable);
  const deferredPrompt = useAppStore((state) => state.deferredPrompt);
  const setInstallContext = useAppStore((state) => state.setInstallContext);
  const setDeferredPrompt = useAppStore((state) => state.setDeferredPrompt);
  const openInstallModal = useAppStore((state) => state.openInstallModal);
  const closeInstallModal = useAppStore((state) => state.closeInstallModal);
  const requestInstall = useAppStore((state) => state.requestInstall);
  const markInstalled = useAppStore((state) => state.markInstalled);
  const showUpdateModal = useAppStore((state) => state.showUpdateModal);
  const pendingTermsUpdate = useAppStore((state) => state.pendingTermsUpdate);
  const isStorageCritical = useAppStore((state) => state.isStorageCritical);

  const engagementRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncInstallContext = () => {
      setInstallContext({
        isIOS: checkIsIOS(),
        isStandalone: checkIsStandalone()
      });
    };

    const syncPromptFromWindow = () => {
      setDeferredPrompt(window.deferredPwaPrompt || null);
    };

    const handlePromptReady = () => {
      syncInstallContext();
      syncPromptFromWindow();
    };

    const handleInstalled = () => {
      window.deferredPwaPrompt = null;
      markInstalled();
    };

    // 🔧 NUEVA FUNCIONALIDAD: Limpiar localStorage cuando se desinstale la app
    const handleUninstalled = () => {
      clearInstallPromptDismissal();
      // Resincronizar para que vuelva a mostrar el prompt
      syncInstallContext();
      syncPromptFromWindow();
    };

    const handleDisplayModeChange = (e) => {
      if (e.matches) {
        setInstallContext({
          isIOS: checkIsIOS(),
          isStandalone: true
        });
      }
    };

    syncInstallContext();
    syncPromptFromWindow();

    window.addEventListener('lanzo-pwa-ready', handlePromptReady);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('appuninstalled', handleUninstalled); // ← Nuevo listener

    const mql = window.matchMedia('(display-mode: standalone)');
    mql.addEventListener('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('lanzo-pwa-ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('appuninstalled', handleUninstalled); // ← Limpiar listener
      mql.removeEventListener('change', handleDisplayModeChange);
    };
  }, [markInstalled, setDeferredPrompt, setInstallContext]);

  useEffect(() => {
    if (appStatus !== 'ready') {
      if (showInstallModal) closeInstallModal();
      return undefined;
    }

    const storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    let engagement = readInstallEngagement(storage);
    engagementRef.current = engagement;

    const isVisible = () => (
      typeof document === 'undefined' || document.visibilityState !== 'hidden'
    );

    const getEligibility = (currentEngagement) => getInstallPromptEligibility({
      appStatus,
      isInstallable,
      isStandalone,
      isIOS,
      deferredPrompt,
      showUpdateModal,
      pendingTermsUpdate,
      isStorageCritical,
      hasBlockingModal: hasBlockingModal(),
      engagement: currentEngagement,
      dismissed: isInstallPromptDismissed(currentEngagement, storage),
    });

    const syncInvitation = () => {
      const eligible = getEligibility(engagement);
      if (eligible) {
        if (!showInstallModal) openInstallModal();
        return;
      }

      const shouldClose = showInstallModal && (
        hasBlockingModal()
        || showUpdateModal
        || Boolean(pendingTermsUpdate)
        || isStorageCritical
        || !isInstallable
        || isStandalone
      );
      if (shouldClose) closeInstallModal();
    };

    const persistCurrentEngagement = (nextEngagement) => {
      engagement = nextEngagement;
      engagementRef.current = nextEngagement;
      writeInstallEngagement(nextEngagement, storage);
      syncInvitation();
    };

    if (isVisible()) {
      persistCurrentEngagement(startActiveEngagement(engagement));
    } else {
      persistCurrentEngagement(pauseActiveEngagement(engagement));
    }

    const handleVisibilityChange = () => {
      persistCurrentEngagement(
        isVisible()
          ? startActiveEngagement(engagement)
          : pauseActiveEngagement(engagement)
      );
    };

    const handleActivityTick = () => {
      persistCurrentEngagement(
        isVisible()
          ? flushActiveEngagement(engagement)
          : pauseActiveEngagement(engagement)
      );
    };

    const intervalId = window.setInterval(handleActivityTick, 1000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const observer = typeof MutationObserver !== 'undefined' && document.body
      ? new MutationObserver(syncInvitation)
      : null;
    observer?.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer?.disconnect();

      const finalEngagement = isVisible()
        ? flushActiveEngagement(engagement)
        : pauseActiveEngagement(engagement);
      writeInstallEngagement(finalEngagement, storage);
      engagementRef.current = finalEngagement;
    };
  }, [
    appStatus,
    closeInstallModal,
    deferredPrompt,
    isIOS,
    isInstallable,
    isStandalone,
    isStorageCritical,
    pendingTermsUpdate,
    showInstallModal,
    showUpdateModal,
    openInstallModal,
  ]);

  const handleClose = () => {
    const storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    dismissInstallPrompt(
      engagementRef.current || readInstallEngagement(storage),
      Date.now(),
      storage
    );
    closeInstallModal();
  };

  // Priorizamos el modal de actualización para no saturar al usuario,
  // y verificamos si ya se descartó este modal.
  const isDismissed = isInstallPromptDismissed(readInstallEngagement());

  if (!showInstallModal || isDismissed || showUpdateModal || appStatus !== 'ready') return null;

  return (
    <div style={overlayStyle} data-testid="install-prompt" aria-labelledby="install-prompt-title">
      <button type="button" style={closeBtnStyle} onClick={handleClose} aria-label="Cerrar aviso de instalacion">
        x
      </button>

      {isIOS ? (
        <div>
          <div id="install-prompt-title" style={titleStyle}>Instalar App</div>
          <div style={textStyle}>
            Para instalar esta app en tu dispositivo:
            <ol style={{ paddingLeft: 'var(--spacing-lg)', marginTop: 'var(--spacing-xs)' }}>
              <li>
                Toca el boton <ShareIcon /> compartir en la barra de navegacion.
              </li>
              <li>
                Desliza y selecciona <strong style={{ color: 'var(--text-dark)' }}>Agregar al inicio</strong>.
              </li>
            </ol>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: '0.8rem' }}>
            (El menu suele estar en la parte inferior)
          </div>
        </div>
      ) : (
        <div>
          <div id="install-prompt-title" style={titleStyle}>Instalar aplicacion</div>
          <div style={textStyle}>
            Instala nuestra app para una mejor experiencia y operacion mas rapida.
          </div>
          <button type="button"
            className="btn-primary"
            style={{ width: '100%', padding: '12px' }}
            onClick={requestInstall}
            disabled={isInstalling}
          >
            {isInstalling ? 'Instalando...' : 'Instalar ahora'}
          </button>
        </div>
      )}
    </div>
  );
};

export default InstallPrompt;
