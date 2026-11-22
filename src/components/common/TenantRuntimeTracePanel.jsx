import { useState, useSyncExternalStore } from 'react';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { isActorSnapshotCurrent } from '../../services/auth/actorAccessPolicy';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import {
  isTenantRuntimeTraceActive,
  readTenantRuntimeTrace,
  startTenantRuntimeTrace,
  stopTenantRuntimeTrace,
  subscribeTenantRuntimeTrace
} from '../../services/diagnostics/tenantRuntimeTrace';
import { copyTextToClipboard } from '../../services/support/supportContact';

const canStartCapture = (actor) => actor?.actorType === 'admin' && isActorSnapshotCurrent(actor);
const formatTrace = () => JSON.stringify(readTenantRuntimeTrace(), null, 2);

function ActiveTraceControls() {
  const [consultation, setConsultation] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');

  const copy = async () => {
    const copied = await copyTextToClipboard(formatTrace());
    setCopyStatus(copied ? 'Traza copiada.' : 'Selecciona el texto de la traza para copiarlo.');
    setConsultation((value) => value + 1);
  };

  return (
    <>
      <p>Captura activa. Copia la traza antes de recargar o detenerla.</p>
      <div className="app-boot-recovery__actions">
        <button type="button" className="ui-button" onClick={() => setConsultation((value) => value + 1)}>
          Consultar traza
        </button>
        <button type="button" className="ui-button" onClick={copy}>Copiar traza</button>
        <button type="button" className="ui-button" onClick={stopTenantRuntimeTrace}>Detener captura</button>
      </div>
      {consultation > 0 && (
        <textarea aria-label="Traza de conexión" readOnly rows={6} value={formatTrace()} />
      )}
      {copyStatus && <p role="status">{copyStatus}</p>}
    </>
  );
}

export default function TenantRuntimeTracePanel() {
  const actor = useActorRuntimeSnapshot();
  const active = useSyncExternalStore(
    subscribeTenantRuntimeTrace, isTenantRuntimeTraceActive, () => false
  );
  if (!active && !canStartCapture(actor)) return null;

  const start = () => {
    if (canStartCapture(actorRuntimeController.getState())) startTenantRuntimeTrace();
  };

  return (
    <details className="tenant-runtime-trace">
      <summary>{active ? 'Diagnóstico de conexión · Capturando' : 'Diagnóstico de conexión'}</summary>
      {active ? <ActiveTraceControls /> : (
        <>
          <p>La captura dura hasta 10 minutos.</p>
          <button type="button" className="ui-button" onClick={start}>Iniciar captura</button>
        </>
      )}
    </details>
  );
}
