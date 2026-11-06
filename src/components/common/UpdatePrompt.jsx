import { useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  activateAdminServiceWorkerUpdate,
  getAdminServiceWorkerState,
  reloadAdminWebUpdate,
  subscribeAdminServiceWorker,
} from '../../pwa/adminServiceWorker';
import './UpdatePrompt.css';

const UpdatePrompt = ({ isSuppressed = false } = {}) => {
  const showUpdateModal = useAppStore((state) => state.showUpdateModal);
  const updateError = useAppStore((state) => state.updateError);
  const isUpdating = useAppStore((state) => state.isUpdating);
  const setUpdateAvailable = useAppStore((state) => state.setUpdateAvailable);
  const setTriggerUpdate = useAppStore((state) => state.setTriggerUpdate);
  const closeUpdateModal = useAppStore((state) => state.closeUpdateModal);
  const runUpdate = useAppStore((state) => state.runUpdate);

  useEffect(() => {
    setTriggerUpdate(() => {
      const state = getAdminServiceWorkerState();
      return state.waiting || state.reloadDeferred
        ? activateAdminServiceWorkerUpdate() : reloadAdminWebUpdate();
    });

    return () => {
      setTriggerUpdate(null);
    };
  }, [setTriggerUpdate]);

  useEffect(() => {
    const applyWorkerState = (workerState) => {
      if (workerState.waiting || workerState.reloadDeferred || workerState.updateId) {
        setUpdateAvailable(true, workerState.updateId);
      } else if (workerState.registered && workerState.active && !workerState.installing) {
        setUpdateAvailable(false);
      }

      if (workerState.error) console.error('No se pudo inicializar la actualización PWA.');
    };

    applyWorkerState(getAdminServiceWorkerState());
    return subscribeAdminServiceWorker(applyWorkerState);
  }, [setUpdateAvailable]);

  if (isSuppressed || !showUpdateModal) return null;

  return (
    <section className="ui-card ui-card--compact update-prompt" aria-label="Actualización de LANZO POS" aria-live="polite">
      <div className="update-prompt__header">
        <h4 className="update-prompt__title">
          Nueva actualización disponible
        </h4>
        <button
          type="button"
          className="ui-icon-button ui-icon-button--sm ui-button--ghost update-prompt__close"
          onClick={closeUpdateModal}
          aria-label="Posponer actualización"
        >
          <X size={18} />
        </button>
      </div>
      <p className="update-prompt__message">
        {updateError || 'Puedes seguir trabajando y actualizar cuando termines tu operación. La actualización seguirá disponible en el menú.'}
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
      <button type="button" className="ui-button ui-button--ghost" onClick={closeUpdateModal}>Más tarde</button>
    </section>
  );
};

export default UpdatePrompt;
