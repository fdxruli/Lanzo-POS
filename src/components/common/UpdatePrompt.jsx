import { useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  activateAdminServiceWorkerUpdate,
  getAdminServiceWorkerState,
  subscribeAdminServiceWorker,
} from '../../pwa/adminServiceWorker';
import './UpdatePrompt.css';

const DISMISSED_KEY = 'lanzo_update_dismissed';

const readDismissedState = () => {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const persistDismissedState = () => {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // El prompt puede cerrarse aunque el almacenamiento de sesión esté restringido.
  }
};

const UpdatePrompt = () => {
  const showUpdateModal = useAppStore((state) => state.showUpdateModal);
  const isUpdating = useAppStore((state) => state.isUpdating);
  const setUpdateAvailable = useAppStore((state) => state.setUpdateAvailable);
  const setTriggerUpdate = useAppStore((state) => state.setTriggerUpdate);
  const closeUpdateModal = useAppStore((state) => state.closeUpdateModal);
  const runUpdate = useAppStore((state) => state.runUpdate);

  useEffect(() => {
    setTriggerUpdate(activateAdminServiceWorkerUpdate);

    return () => {
      setTriggerUpdate(null);
    };
  }, [setTriggerUpdate]);

  useEffect(() => {
    const applyWorkerState = (workerState) => {
      if (workerState.waiting) {
        setUpdateAvailable(true);
      } else if (workerState.registered && workerState.active && !workerState.installing) {
        setUpdateAvailable(false);
      }

      if (workerState.error) console.error('No se pudo inicializar la actualización PWA.');
    };

    applyWorkerState(getAdminServiceWorkerState());
    return subscribeAdminServiceWorker(applyWorkerState);
  }, [setUpdateAvailable]);

  const isDismissed = readDismissedState();

  const handleClose = () => {
    persistDismissedState();
    closeUpdateModal();
  };

  if (!showUpdateModal || isDismissed) return null;

  return (
    <div className="ui-card ui-card--compact update-prompt">
      <div className="update-prompt__header">
        <h4 className="update-prompt__title">
          Nueva version disponible
        </h4>
        <button
          type="button"
          className="ui-icon-button ui-icon-button--sm ui-button--ghost update-prompt__close"
          onClick={handleClose}
          aria-label="Cerrar notificacion"
        >
          <X size={18} />
        </button>
      </div>
      <p className="update-prompt__message">
        Guarda tu venta actual y actualiza para aplicar los cambios en el sistema.
      </p>

      <button
        type="button"
        className="ui-button ui-button--primary ui-button--block update-prompt__action"
        onClick={runUpdate}
        disabled={isUpdating}
      >
        <RefreshCw size={16} />
        {isUpdating ? 'Actualizando...' : 'Actualizar ahora'}
      </button>
    </div>
  );
};

export default UpdatePrompt;
