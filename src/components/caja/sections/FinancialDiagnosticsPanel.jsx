import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildFinancialDiagnosticText } from '../../../services/financial/financialIntentDiagnostics';
import { getFinancialDiagnosticSummary, listFinancialIntentDiagnostics } from '../../../services/financial/financialIntentObservability';
import { retryFinancialIntentProjection } from '../../../services/financial/financialProjectionRepair';
import { refreshFinancialIntentReceipt } from '../../../services/financial/financialReceiptReconciliation';
import { getCashMode } from '../../../services/cash/cashActor';
import './FinancialDiagnosticsPanel.css';

const FILTERS = Object.freeze([
  ['attention', 'Requiere revisión'],
  ['pending', 'Pendientes'],
  ['projection', 'Actualización local'],
  ['conflict', 'Conflictos'],
  ['blocked', 'Bloqueadas'],
  ['all', 'Todas']
]);

const HEALTH_LABELS = Object.freeze({
  HEALTHY: 'Correcta',
  PROJECTION_ATTENTION: 'Actualización local pendiente',
  PREPARED_NOT_DISPATCHED: 'Preparada sin envío',
  RECEIPT_PENDING: 'Recibo pendiente',
  RECEIPT_PENDING_PROLONGED: 'Recibo pendiente prolongado',
  CONFLICT: 'Conflicto',
  BLOCKED: 'Bloqueada'
});

const date = (value) => value ? new Date(value).toLocaleString() : 'Sin registro';
const age = (value) => {
  if (!Number.isFinite(value)) return 'Sin registro';
  const minutes = Math.floor(value / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
};

const diagnosticsOptions = (filter) => {
  if (filter === 'all') return { scope: 'all' };
  if (filter === 'pending') return { scope: 'all', statuses: ['PREPARED', 'DISPATCHING', 'PENDING_RECEIPT'] };
  if (filter === 'projection') return { scope: 'all', statuses: ['COMPLETED'] };
  if (filter === 'conflict') return { scope: 'all', statuses: ['CONFLICT'] };
  if (filter === 'blocked') return { scope: 'all', statuses: ['BLOCKED'] };
  return { scope: 'attention' };
};

const matchesFilter = (diagnostic, filter) => {
  if (filter === 'projection') return diagnostic.healthStatus === 'PROJECTION_ATTENTION';
  return true;
};

const writeClipboard = async (text) => {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  }
  if (!globalThis.document?.body) return false;
  const textarea = globalThis.document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  globalThis.document.body.appendChild(textarea);
  textarea.select();
  const copied = globalThis.document.execCommand?.('copy') === true;
  textarea.remove();
  return copied;
};

/** A presentation-only consumer of the sanitized financial DTO. */
const FinancialDiagnosticsPanel = ({ enabled = false }) => {
  const [filter, setFilter] = useState('attention');
  const [diagnostics, setDiagnostics] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyIntentId, setBusyIntentId] = useState(null);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    if (!enabled || !getCashMode().cloudEnabled) return;
    setLoading(true);
    setMessage('');
    try {
      const options = diagnosticsOptions(filter);
      const [rows, nextSummary] = await Promise.all([
        listFinancialIntentDiagnostics({ ...options, limit: 50 }),
        getFinancialDiagnosticSummary({ limit: 50 })
      ]);
      setDiagnostics(rows.filter((diagnostic) => matchesFilter(diagnostic, filter)));
      setSummary(nextSummary);
    } catch (error) {
      setDiagnostics([]);
      setSummary(null);
      setMessage(error?.code || 'No se pudo leer el diagnóstico financiero.');
    } finally {
      setLoading(false);
    }
  }, [enabled, filter]);

  useEffect(() => { reload(); }, [reload]);

  const selected = useMemo(() => diagnostics.find((diagnostic) => diagnostic.intentId === selectedId) || null, [diagnostics, selectedId]);

  const withAction = async (diagnostic, action) => {
    if (!diagnostic || busyIntentId) return;
    setBusyIntentId(diagnostic.intentId);
    setMessage('');
    try {
      await action();
      await reload();
      setMessage('Actualización segura completada.');
    } catch (error) {
      setMessage(error?.code || 'No se pudo completar la acción segura.');
    } finally {
      setBusyIntentId(null);
    }
  };

  const handleReceipt = (diagnostic) => withAction(diagnostic, () => refreshFinancialIntentReceipt({
    intentId: diagnostic.intentId,
    licenseKey: getCashMode().licenseKey
  }));

  const handleProjection = (diagnostic) => withAction(diagnostic, () => retryFinancialIntentProjection({ intentId: diagnostic.intentId }));

  const handleCopy = async (diagnostic) => {
    const mode = getCashMode();
    try {
      const copied = await writeClipboard(buildFinancialDiagnosticText(diagnostic, {
        tenantOpaqueId: mode.licenseDetails?.tenant_opaque_id || null,
        appVersion: globalThis.__APP_VERSION__ || null
      }));
      if (!copied) throw new Error('CLIPBOARD_UNAVAILABLE');
      setMessage('Diagnóstico sanitizado copiado.');
    } catch {
      setMessage('No se pudo copiar el diagnóstico.');
    }
  };

  if (!enabled) return null;
  if (!getCashMode().cloudEnabled) {
    return <section className="financial-diagnostics" aria-label="Diagnóstico financiero"><p>Diagnóstico financiero no disponible para este modo.</p></section>;
  }

  return (
    <section className="financial-diagnostics" aria-labelledby="financial-diagnostics-title">
      <header className="financial-diagnostics__header">
        <div><p>Control local de reconciliación</p><h2 id="financial-diagnostics-title">Diagnóstico financiero</h2></div>
        <button type="button" onClick={reload} disabled={loading || Boolean(busyIntentId)}>Actualizar vista</button>
      </header>
      {summary && (
        <div className="financial-diagnostics__summary" aria-label="Resumen de salud financiera">
          <span><small>Requieren revisión</small><strong>{summary.requiringAttention}</strong></span>
          <span><small>Recibos pendientes</small><strong>{summary.pendingReceipt + summary.pendingProlonged}</strong></span>
          <span><small>Conflictos / bloqueadas</small><strong>{summary.conflict + summary.blocked}</strong></span>
          <span><small>Actualización local fallida</small><strong>{summary.projectionFailed}</strong></span>
        </div>
      )}
      <div className="financial-diagnostics__filters" aria-label="Filtros de diagnóstico">
        {FILTERS.map(([value, label]) => <button key={value} type="button" className={filter === value ? 'is-selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      {message && <p className="financial-diagnostics__message" role="status">{message}</p>}
      {loading && <p>Cargando diagnóstico financiero…</p>}
      {!loading && diagnostics.length === 0 && <p>No hay intents financieros relevantes en esta vista.</p>}
      <div className="financial-diagnostics__list">
        {diagnostics.map((diagnostic) => (
          <article key={diagnostic.intentId} className="financial-diagnostics__item">
            <div>
              <strong>{diagnostic.operationLabel}</strong>
              <p>{HEALTH_LABELS[diagnostic.healthStatus] || diagnostic.healthStatus}</p>
              <small>Financiero: {diagnostic.financialStatus} · Local: {diagnostic.projectionStatus}</small>
              <small>Actor: {diagnostic.originActorKey} · Edad: {age(diagnostic.ageMs)}</small>
            </div>
            <div className="financial-diagnostics__actions">
              <button type="button" onClick={() => setSelectedId(diagnostic.intentId)}>Ver detalle</button>
              <button type="button" onClick={() => handleCopy(diagnostic)}>Copiar diagnóstico</button>
              <button type="button" disabled={!diagnostic.allowedActions.refreshReceipt || Boolean(busyIntentId)} onClick={() => handleReceipt(diagnostic)}>Consultar recibo</button>
              <button type="button" disabled={!diagnostic.allowedActions.retryProjection || Boolean(busyIntentId)} onClick={() => handleProjection(diagnostic)}>Reintentar actualización local</button>
              {diagnostic.allowedActions.requiresOriginActorLogin && <small>Requiere iniciar sesión con el actor de origen.</small>}
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <section className="financial-diagnostics__detail" aria-label="Detalle de intent financiero">
          <header><h3>Detalle sanitizado</h3><button type="button" onClick={() => setSelectedId(null)}>Cerrar</button></header>
          <dl>
            <div><dt>Operación</dt><dd>{selected.operationLabel}</dd></div>
            <div><dt>Estado financiero</dt><dd>{selected.financialStatus}</dd></div>
            <div><dt>Estado local</dt><dd>{selected.projectionStatus}</dd></div>
            <div><dt>Actor de origen</dt><dd>{selected.originActorKey}</dd></div>
            <div><dt>Caja / estación</dt><dd>{selected.cashSessionId || '—'} / {selected.cashStationId || '—'}</dd></div>
            <div><dt>Creado</dt><dd>{date(selected.createdAt)}</dd></div>
            <div><dt>Último intento</dt><dd>{date(selected.lastDispatchAt)}</dd></div>
            <div><dt>Última consulta</dt><dd>{date(selected.lastRecoveryAt)}</dd></div>
            <div><dt>Intentos</dt><dd>{selected.dispatchAttemptCount} envío · {selected.recoveryAttemptCount} recuperación</dd></div>
            <div><dt>Último código</dt><dd>{selected.lastProtocolCode || selected.lastRecoveryCode || '—'}</dd></div>
            <div><dt>Lease de recuperación</dt><dd>{selected.recoveryLeaseState}{selected.recoveryLeaseUntil ? ` hasta ${date(selected.recoveryLeaseUntil)}` : ''}</dd></div>
            <div><dt>Huella K / H</dt><dd>{selected.idempotencyKeyFingerprint || '—'} / {selected.requestHashFingerprint || '—'}</dd></div>
          </dl>
        </section>
      )}
    </section>
  );
};

export default FinancialDiagnosticsPanel;
