import './UpdateControls.css';
import { useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  getAdminUpdateCheckState,
  requestAdminServiceWorkerUpdateCheck,
  subscribeAdminUpdateCheck,
} from '../../pwa/adminServiceWorkerUpdateMonitor';

const messages = {
  checking: 'Buscando actualizaciones…',
  current: 'Tu aplicación está actualizada.',
  available: 'Nueva actualización disponible.',
  offline: 'No hay conexión para comprobar.',
  error: 'No pudimos comprobar las actualizaciones.',
  pending: 'Actualización pendiente de completar.',
};

export default function UpdateControls({ showApply = false } = {}) {
  const check = useSyncExternalStore(subscribeAdminUpdateCheck, getAdminUpdateCheckState);
  const available = useAppStore(state => state.updateAvailable);
  const updating = useAppStore(state => state.isUpdating);
  const error = useAppStore(state => state.updateError);
  const runUpdate = useAppStore(state => state.runUpdate);
  const checking = check.status === 'checking';
  return (
    <div className="update-controls">
      <button type="button" className="ui-button ui-button--secondary"
        disabled={checking || updating}
        onClick={() => {
          useAppStore.setState({ updateError: null });
          requestAdminServiceWorkerUpdateCheck({ force: true });
        }}>
        <RefreshCw size={16} aria-hidden="true" /> Buscar actualizaciones
      </button>
      <p aria-live="polite">
        {check.completed && check.status === 'current' ? 'Actualización completada. ' : ''}
        {error || (available && check.status === 'current'
          ? messages.pending : messages[check.status])}
      </p>
      {showApply && available && (
        <button type="button" className="ui-button ui-button--primary" disabled={updating} onClick={runUpdate}>
          {updating ? 'Completando actualización…' : 'Actualizar ahora'}
        </button>
      )}
      {check.publishedBuild && check.status !== 'checking' && (
        <small>Última comprobación correcta: {new Date(check.checkedAt).toLocaleString()}<br />
          Publicada en este sitio: {check.publishedBuild.version} · {check.publishedBuild.commit}
        </small>
      )}
    </div>
  );
}
