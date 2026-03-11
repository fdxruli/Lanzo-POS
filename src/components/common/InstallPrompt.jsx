import { useEffect, useState } from 'react';

const DISMISS_KEY = 'lanzo_install_dismissed_timestamp';
const GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000; // 15 días de silencio

const ShareIcon = () => (
  <span style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 4px' }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    // Si ya está instalada, abortar renderizado inmediatamente
    if (isStandalone) return;

    // Control de hostigamiento: ¿El usuario lo rechazó recientemente?
    const lastDismissed = localStorage.getItem(DISMISS_KEY);
    if (lastDismissed && (Date.now() - parseInt(lastDismissed, 10)) < GRACE_PERIOD_MS) {
      return; 
    }

    const handlePromptReady = () => {
      setDeferredPrompt(window.deferredPwaPrompt);
      setShowPrompt(true);
    };

    // Evaluación inicial
    if (window.deferredPwaPrompt) {
      handlePromptReady();
    } else if (isIOS && !isStandalone) {
      // iOS no emite beforeinstallprompt, forzamos mostrar las instrucciones
      setShowPrompt(true);
    }

    // Suscripciones a los eventos globales
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
      // Castigar la UI si el usuario le dio "Cancelar" al prompt nativo de Chrome/Android
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    }

    // Destrucción del objeto para evitar llamadas dobles que arrojarían error en consola
    window.deferredPwaPrompt = null;
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismissClick = () => {
    // Si el usuario cierra el modal manual (la 'X')
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  // Estilos limpios y encapsulados
  const overlayStyle = {
    position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
    width: '90%', maxWidth: '400px', backgroundColor: 'white', borderRadius: '16px',
    padding: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', zIndex: 9999,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    border: '1px solid #f0f0f0', animation: 'slideUp 0.5s ease-out',
  };

  const titleStyle = { fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' };
  const textStyle = { fontSize: '14px', color: '#666', marginBottom: '15px', lineHeight: '1.5' };
  const buttonStyle = {
    backgroundColor: '#007AFF', color: 'white', border: 'none', padding: '12px 20px',
    borderRadius: '10px', fontSize: '16px', fontWeight: '500', width: '100%', cursor: 'pointer',
  };
  const closeBtnStyle = {
    position: 'absolute', top: '10px', right: '15px', background: 'none',
    border: 'none', fontSize: '20px', color: '#999', cursor: 'pointer',
  };

  return (
    <div style={overlayStyle}>
      <button style={closeBtnStyle} onClick={handleDismissClick}>x</button>

      {isIOS ? (
        <div>
          <div style={titleStyle}>Instalar App</div>
          <div style={textStyle}>
            Para instalar esta app en tu dispositivo:
            <ol style={{ paddingLeft: '20px', marginTop: '10px' }}>
              <li>Toca el botón <ShareIcon /> compartir en la barra de navegación.</li>
              <li>Desliza y selecciona <strong>Agregar al inicio</strong>.</li>
            </ol>
          </div>
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: '12px' }}>
            (El menú suele estar en la parte inferior)
          </div>
        </div>
      ) : (
        <div>
          <div style={titleStyle}>Instalar Aplicación</div>
          <div style={textStyle}>
            Instala nuestra app para una mejor experiencia y operación rápida.
          </div>
          <button style={buttonStyle} onClick={handleInstallClick}>
            Instalar ahora
          </button>
        </div>
      )}
    </div>
  );
};

export default InstallPrompt;