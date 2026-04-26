import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const UpdatePrompt = () => {
  const intervalRef = useRef(null);

  const showUpdateModal = useAppStore((state) => state.showUpdateModal);
  const isUpdating = useAppStore((state) => state.isUpdating);
  const setUpdateAvailable = useAppStore((state) => state.setUpdateAvailable);
  const setTriggerUpdate = useAppStore((state) => state.setTriggerUpdate);
  const closeUpdateModal = useAppStore((state) => state.closeUpdateModal);
  const runUpdate = useAppStore((state) => state.runUpdate);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegistered(registration) {
      if (!registration) return;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = window.setInterval(() => {
        if (!navigator.onLine) return;

        registration.update().catch((error) => {
          console.error('Fallo al buscar actualizacion PWA:', error);
        });
      }, CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.error('Fallo critico en registro de SW:', error);
    }
  });

  useEffect(() => {
    setTriggerUpdate(updateServiceWorker);

    return () => {
      setTriggerUpdate(null);
    };
  }, [setTriggerUpdate, updateServiceWorker]);

  useEffect(() => {
    if (!needRefresh) return;

    setUpdateAvailable(true);
    setNeedRefresh(false);
  }, [needRefresh, setNeedRefresh, setUpdateAvailable]);

  useEffect(() => {
    return () => {
      if (!intervalRef.current) return;

      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, []);

  // Verificamos si el usuario ya descartó el banner en esta sesión
  const isDismissed = sessionStorage.getItem('lanzo_update_dismissed') === 'true';

  const handleClose = () => {
    sessionStorage.setItem('lanzo_update_dismissed', 'true');
    closeUpdateModal();
  };

  if (!showUpdateModal || isDismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 'var(--z-toast)',
        backgroundColor: 'var(--card-background-color)',
        color: 'var(--text-color)',
        padding: 'var(--spacing-md)',
        borderRadius: 'var(--border-radius)',
        boxShadow: 'var(--box-shadow-lg)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-sm)',
        maxWidth: '300px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h4
          style={{
            margin: 0,
            fontSize: '1rem',
            color: 'var(--text-dark)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          Nueva version disponible
        </h4>
        <button
        onClick={handleClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-light)',
            cursor: 'pointer',
            padding: '2px'
          }}
          aria-label="Cerrar notificacion"
        >
          <X size={18} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-color)' }}>
        Guarda tu venta actual y actualiza para aplicar los cambios en el sistema.
      </p>

      <button
        className="btn-primary"
        onClick={runUpdate}
        disabled={isUpdating}
        style={{ marginTop: 'var(--spacing-xs)' }}
      >
        <RefreshCw size={16} />
        {isUpdating ? 'Actualizando...' : 'Actualizar ahora'}
      </button>
    </div>
  );
};

export default UpdatePrompt;
