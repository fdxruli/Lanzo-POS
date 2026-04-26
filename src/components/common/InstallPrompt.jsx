import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

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

const InstallPrompt = () => {
  const isIOS = useAppStore((state) => state.isIOS);
  const showInstallModal = useAppStore((state) => state.showInstallModal);
  const isInstalling = useAppStore((state) => state.isInstalling);
  const setInstallContext = useAppStore((state) => state.setInstallContext);
  const setDeferredPrompt = useAppStore((state) => state.setDeferredPrompt);
  const closeInstallModal = useAppStore((state) => state.closeInstallModal);
  const requestInstall = useAppStore((state) => state.requestInstall);
  const markInstalled = useAppStore((state) => state.markInstalled);

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

    syncInstallContext();
    syncPromptFromWindow();

    window.addEventListener('lanzo-pwa-ready', handlePromptReady);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('lanzo-pwa-ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [markInstalled, setDeferredPrompt, setInstallContext]);

  // Verificamos si el usuario ya decidió ocultar el banner en este dispositivo
  const isDismissed = localStorage.getItem('lanzo_install_dismissed') === 'true';

  const handleClose = () => {
    localStorage.setItem('lanzo_install_dismissed', 'true');
    closeInstallModal();
  };

  if (!showInstallModal || isDismissed) return null;

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

  return (
    <div style={overlayStyle}>
      <button style={closeBtnStyle} onClick={handleClose} aria-label="Cerrar aviso de instalacion">
        x
      </button>

      {isIOS ? (
        <div>
          <div style={titleStyle}>Instalar App</div>
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
          <div style={titleStyle}>Instalar aplicacion</div>
          <div style={textStyle}>
            Instala nuestra app para una mejor experiencia y operacion mas rapida.
          </div>
          <button
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
