import { useEffect, useState } from 'react';

const DISMISS_KEY = 'lanzo_install_dismissed_timestamp';
const GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000; // 15 días de silencio

const ShareIcon = () => (
  <span style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 4px' }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
      <polyline points="16 6 12 2 8 6"></polyline>
      <line x1="12" y1="2" x2="12" y2="15"></line>
    </svg>
  </span>
);

// Detección estricta: Cubre iPhones clásicos e iPads modernos (iPadOS 13+)
const checkIsIOS = () => {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/.test(userAgent) || isIPadOS;
};

const checkIsStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

const InstallPrompt = () => {
  const isIOS = checkIsIOS();
  const isStandalone = checkIsStandalone();

  const [deferredPrompt, setDeferredPrompt] = useState(window.deferredPwaPrompt);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (isStandalone) return;

    const lastDismissed = localStorage.getItem(DISMISS_KEY);
    if (lastDismissed && (Date.now() - parseInt(lastDismissed, 10)) < GRACE_PERIOD_MS) {
      return; 
    }

    const handlePromptReady = () => {
      setDeferredPrompt(window.deferredPwaPrompt);
      setShowPrompt(true);
    };

    if (window.deferredPwaPrompt) {
      handlePromptReady();
    } else if (isIOS && !isStandalone) {
      setShowPrompt(true);
    }

    window.addEventListener('lanzo-pwa-ready', handlePromptReady);
    window.addEventListener('appinstalled', () => setShowPrompt(false));

    return () => {
      window.removeEventListener('lanzo-pwa-ready', handlePromptReady);
      window.removeEventListener('appinstalled', () => setShowPrompt(false));
    };
  }, [isStandalone, isIOS]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'dismissed') {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    }

    window.deferredPwaPrompt = null;
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismissClick = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  // Estilos adaptados al index.css
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
    animation: 'slideUp 0.5s ease-out',
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
      <button style={closeBtnStyle} onClick={handleDismissClick}>✕</button>

      {isIOS ? (
        <div>
          <div style={titleStyle}>Instalar App</div>
          <div style={textStyle}>
            Para instalar esta app en tu dispositivo:
            <ol style={{ paddingLeft: 'var(--spacing-lg)', marginTop: 'var(--spacing-xs)' }}>
              <li>Toca el botón <ShareIcon /> compartir en la barra de navegación.</li>
              <li>Desliza y selecciona <strong style={{color: 'var(--text-dark)'}}>Agregar al inicio</strong>.</li>
            </ol>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: '0.8rem' }}>
            (El menú suele estar en la parte inferior)
          </div>
        </div>
      ) : (
        <div>
          <div style={titleStyle}>Instalar Aplicación</div>
          <div style={textStyle}>
            Instala nuestra app para una mejor experiencia y operación rápida.
          </div>
          <button 
            className="btn-primary" 
            style={{ width: '100%', padding: '12px' }} 
            onClick={handleInstallClick}
          >
            Instalar ahora
          </button>
        </div>
      )}
    </div>
  );
};

export default InstallPrompt;