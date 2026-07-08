import { useState, useEffect, useRef } from 'react';
import Logger from '../../services/Logger';
import { checkInternetConnection, showConfirmModal, showMessageModal } from '../../services/utils';
import './ReconnectionBanner.css';

const refreshActivity = () => {
  sessionStorage.setItem('lanzo_last_active', Date.now().toString());
};

export default function ReconnectionBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  const errorCountRef = useRef(0);

  useEffect(() => {
    const handleError = (event) => {
      if (event.error?.name === 'InvalidStateError' || 
          event.error?.message?.includes('database') ||
          event.error?.message?.includes('transaction') ||
          event.error?.message?.includes('closed')) {
        
        errorCountRef.current = errorCountRef.current + 1;
        Logger.warn(`⚠️ Error de conexión detectado (${errorCountRef.current})`);

        if (errorCountRef.current >= 2) {
          setShowBanner(true);
        }
      }
    };

    window.addEventListener('error', handleError);

    const checkInactivity = setInterval(() => {
      const lastActive = sessionStorage.getItem('lanzo_last_active');
      const now = Date.now();
      
      if (!lastActive) {
        refreshActivity();
        return;
      }

      if ((now - parseInt(lastActive)) > 1800000) {
        setShowBanner(prev => {
          if (!prev) Logger.log("💤 Inactividad detectada, pausando conexión...");
          return true;
        });
      }
    }, 60000);

    const handleUserActivity = () => {
        if (!showBanner) {
            refreshActivity();
        }
    };

    window.addEventListener('mousedown', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('mousedown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      clearInterval(checkInactivity);
    };
  }, [showBanner]);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    
    try {
      const isOnline = await checkInternetConnection();
      if (!isOnline) {
        showMessageModal('No se detecta conexión a internet. Verifica tu red.', null, { type: 'warning' });
        setIsReconnecting(false);
        return;
      }

      Logger.log("Intentando reconexión de base de datos...");

      const { closeDB, initDB } = await import('../../services/database');
      
      try {
          closeDB();
      } catch (e) { console.warn("Error cerrando DB:", e); }
      
      await new Promise(r => setTimeout(r, 800));
      await initDB();
      
      errorCountRef.current = 0;
      refreshActivity();
      
      setShowBanner(false);
      setIsReconnecting(false);
      Logger.log('✅ Conexión restaurada correctamente');
      
    } catch (error) {
      Logger.error('Error reconectando:', error);
      if (await showConfirmModal('La reconexión automática falló. ¿Deseas recargar la página para corregirlo?', {
        title: 'Reconexión fallida',
        confirmButtonText: 'Recargar pagina',
        cancelButtonText: 'Cancelar'
      })) {
        window.location.reload();
      }
      setIsReconnecting(false);
    }
  };

  const handleDismiss = () => {
    refreshActivity();
    errorCountRef.current = 0;
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="reconnection-banner">
      <div className="banner-content">
        <span className="banner-icon">⚠️</span>
        <div className="banner-text">
          <strong className="banner-title">Conexión en Reposo</strong>
          <span className="banner-message">
            Modo ahorro activado por inactividad.
          </span>
        </div>
      </div>

      <div className="banner-actions">
        <button type="button"
          onClick={handleReconnect}
          disabled={isReconnecting}
          className="btn-reconnect"
        >
          {isReconnecting ? (
             <>⏳ Conectando...</>
          ) : (
             <>⚡ Reactivar Sistema</>
          )}
        </button>

        <button type="button"
          onClick={handleDismiss}
          disabled={isReconnecting}
          className="btn-dismiss"
          title="Posponer aviso"
          aria-label="Cerrar aviso"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
