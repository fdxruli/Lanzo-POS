import { useEffect, useRef, memo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import './ServerStatusBanner.css';

const ServerStatusBanner = () => {
  const { serverHealth, serverMessage, dismissServerAlert } = useAppStore();
  const autoCloseRef = useRef(null);

  useEffect(() => {
    // Auto-cierra después de 8s si el servidor se recupera
    if (serverHealth === 'ok' && serverMessage) {
      autoCloseRef.current = setTimeout(() => {
        dismissServerAlert();
      }, 8000);
    }

    return () => clearTimeout(autoCloseRef.current);
  }, [serverHealth, serverMessage, dismissServerAlert]);

  if (serverHealth === 'ok' || !serverMessage) return null;

  const isDegraded = serverHealth === 'degraded';

  return (
    <div 
      className={`server-status-banner ${isDegraded ? 'degraded' : 'down'}`}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="status-icon" aria-hidden="true">
        {isDegraded ? '🐢' : '🔧'}
      </div>

      <div className="status-content">
        <strong>{isDegraded ? 'Lentitud detectada' : 'Problemas de conexión'}</strong>
        <p>{serverMessage}</p>
        <small>Los datos se sincronizarán automáticamente cuando se normalice.</small>
      </div>

      <button
        className="banner-close-btn"
        onClick={dismissServerAlert}
        aria-label="Cerrar notificación"
        type="button"
      >
        ✕
      </button>
    </div>
  );
};

export default memo(ServerStatusBanner);