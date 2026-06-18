import { useEffect, useRef, memo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import './ServerStatusBanner.css';

const STATUS_COPY = {
  degraded: {
    icon: '🐢',
    title: 'Supabase está lento',
    detail: 'Lanzo POS seguirá reintentando automáticamente.'
  },
  down: {
    icon: '🔌',
    title: 'Conexión con Supabase interrumpida',
    detail: 'Puedes seguir usando Lanzo POS. El sistema intentará reconectar en segundo plano.'
  }
};

const ServerStatusBanner = () => {
  const serverHealth = useAppStore((state) => state.serverHealth);
  const serverMessage = useAppStore((state) => state.serverMessage);
  const shouldShowServerStatusBanner = useAppStore((state) =>
    state.shouldShowServerStatusBanner?.() ?? false
  );
  const dismissServerAlert = useAppStore((state) => state.dismissServerAlert);
  const clearServerStatus = useAppStore((state) => state.clearServerStatus);
  const autoCloseRef = useRef(null);

  useEffect(() => {
    if (serverHealth === 'ok' && serverMessage) {
      autoCloseRef.current = setTimeout(() => {
        clearServerStatus?.();
      }, 3000);
    }

    return () => {
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
      }
    };
  }, [serverHealth, serverMessage, clearServerStatus]);

  if (!shouldShowServerStatusBanner) return null;

  const statusCopy = STATUS_COPY[serverHealth] || STATUS_COPY.down;

  return (
    <div
      className={`server-status-banner ${serverHealth}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="status-icon" aria-hidden="true">
        {statusCopy.icon}
      </div>

      <div className="status-content">
        <strong>{statusCopy.title}</strong>
        <p>{serverMessage}</p>
        <small>{statusCopy.detail}</small>
      </div>

      <button
        className="banner-close-btn"
        onClick={dismissServerAlert}
        aria-label="Cerrar aviso de Supabase"
        type="button"
      >
        ✕
      </button>
    </div>
  );
};

export default memo(ServerStatusBanner);