import React, { useEffect, useState } from 'react';

const InstallPrompt = () => {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Detectar si ya está instalado (Standalone)
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    setIsStandalone(isInStandaloneMode);

    // Detectar iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    // Manejar evento de instalación para Android/Chrome
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Solo mostrar si NO está instalado
      if (!isInStandaloneMode) {
        setShowPrompt(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Mostrar prompt de iOS si es iOS y no está instalado
    if (isIosDevice && !isInStandaloneMode) {
        setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    }
  };

  if (!showPrompt || isStandalone) return null;

  // --- ESTILOS ---
  const overlayStyle = {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '90%',
    maxWidth: '400px',
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
    zIndex: 9999,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    border: '1px solid #f0f0f0',
    animation: 'slideUp 0.5s ease-out'
  };

  const titleStyle = {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '10px',
    color: '#333'
  };

  const textStyle = {
    fontSize: '14px',
    color: '#666',
    marginBottom: '15px',
    lineHeight: '1.5'
  };

  const buttonStyle = {
    backgroundColor: '#007AFF', // Azul iOS
    color: 'white',
    border: 'none',
    padding: '12px 20px',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '500',
    width: '100%',
    cursor: 'pointer'
  };

  const closeBtnStyle = {
    position: 'absolute',
    top: '10px',
    right: '15px',
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: '#999',
    cursor: 'pointer'
  };

  // Icono genérico de compartir para la UI
  const ShareIcon = () => (
    <span style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 4px' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
        <polyline points="16 6 12 2 8 6"></polyline>
        <line x1="12" y1="2" x2="12" y2="15"></line>
      </svg>
    </span>
  );

  return (
    <div style={overlayStyle}>
      <button style={closeBtnStyle} onClick={() => setShowPrompt(false)}>×</button>
      
      {isIOS ? (
        // CONTENIDO PARA IOS
        <div>
          <div style={titleStyle}>Instalar App</div>
          <div style={textStyle}>
            Para instalar esta app en tu iPhone/iPad:
            <ol style={{ paddingLeft: '20px', marginTop: '10px' }}>
              <li>Toca el botón <ShareIcon /> compartir en la barra del navegador.</li>
              <li>Desliza y selecciona <strong>"Agregar al inicio"</strong>.</li>
            </ol>
          </div>
          {/* Triángulo visual decorativo apuntando abajo (opcional, mejor quitarlo si confunde en desktop) */}
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: '12px' }}>
            (El menú suele estar abajo)
          </div>
        </div>
      ) : (
        // CONTENIDO PARA ANDROID / CHROME
        <div>
          <div style={titleStyle}>Instalar Aplicación</div>
          <div style={textStyle}>
            Instala nuestra app para una mejor experiencia y acceso rápido.
          </div>
          <button style={buttonStyle} onClick={handleInstallClick}>
            Instalar
          </button>
        </div>
      )}
    </div>
  );
};

export default InstallPrompt;