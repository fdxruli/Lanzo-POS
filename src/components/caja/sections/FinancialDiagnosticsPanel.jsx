import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { useActorRuntimeSnapshot } from '../../../services/auth/useActorRuntimeSnapshot';
import { buildFinancialDiagnosticText } from '../../../services/financial/financialIntentDiagnostics';
import {
  getFinancialDiagnosticSummary,
  getFinancialIntentDiagnostic,
  listFinancialIntentDiagnostics
} from '../../../services/financial/financialIntentObservability';
import { retryFinancialIntentProjection } from '../../../services/financial/financialProjectionRepair';
import { refreshFinancialIntentReceipt } from '../../../services/financial/financialReceiptReconciliation';
import { getCashMode } from '../../../services/cash/cashActor';
import './FinancialDiagnosticsPanel.css';

const FinancialSupportEscalation = lazy(() => import('./FinancialSupportEscalation'));

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

const FINANCIAL_UNCERTAIN_STATUSES = new Set(['DISPATCHING', 'PENDING_RECEIPT', 'CONFLICT', 'BLOCKED']);
const UNCERTAIN_RECEIPT_OUTCOMES = new Set([
  'receipt_processing', 'receipt_not_found_no_resend', 'receipt_unavailable', 'receipt_conflict', 'receipt_unrecognized'
]);

const isSupportUncertain = (diagnostic, feedback) => (
  FINANCIAL_UNCERTAIN_STATUSES.has(String(diagnostic?.financialStatus || '').toUpperCase())
  || (String(diagnostic?.financialStatus || '').toUpperCase() === 'PREPARED' && Number(diagnostic?.dispatchAttemptCount || 0) > 0)
  || (feedback?.kind === 'receipt' && UNCERTAIN_RECEIPT_OUTCOMES.has(feedback.outcome))
);

const receiptFeedback = (result, diagnostic) => {
  const outcome = result?.outcome;
  switch (outcome) {
    case 'receipt_completed': {
      if (!diagnostic) {
        return 'El recibo confirma la operación. No se pudo verificar la proyección local; actualiza el diagnóstico. No vuelvas a cobrar.';
      }
      const projectionStatus = String(diagnostic?.projectionStatus || '').toUpperCase();
      if (projectionStatus === 'APPLIED' || projectionStatus === 'NOT_REQUIRED') {
        return 'El recibo confirma la operación y la proyección local está aplicada. No se volvió a ejecutar el cobro.';
      }
      return `El recibo confirma la operación. La proyección local sigue ${projectionStatus || 'pendiente'}; usa solo la acción de actualización local si está habilitada. No vuelvas a cobrar.`;
    }
    case 'receipt_processing':
      return 'El recibo indica que la operación continúa procesándose. No la vuelvas a enviar; consulta el recibo más tarde o solicita soporte.';
    case 'receipt_not_found_no_resend':
      return 'No se encontró recibo después del intento y el resultado sigue sin determinarse. No cobres nuevamente hasta conciliarlo; solicita soporte.';
    case 'receipt_not_found_prepared_no_dispatch':
      return 'No hay recibo y la operación no se había enviado. No se confirmó un cargo.';
    case 'receipt_unavailable':
      return 'No se pudo consultar el recibo. El resultado sigue pendiente; puedes volver a consultar de forma segura o solicitar soporte.';
    case 'receipt_conflict':
      return 'El recibo presenta un conflicto de idempotencia. Mantén la operación bloqueada y solicita revisión a soporte.';
    case 'receipt_unrecognized':
      return 'La respuesta del recibo no se pudo reconocer. El resultado no está confirmado; no reenvíes la operación y solicita revisión.';
    case 'lease_held':
      return 'Ya hay una consulta segura en curso. Espera y actualiza el diagnóstico.';
    case 'terminal_skipped':
      return 'La operación está bloqueada en un estado terminal y no se consultó el recibo. Solicita revisión.';
    default:
      return 'No se confirmó el resultado del recibo. No reenvíes la operación; vuelve a consultar o solicita soporte.';
  }
};

const projectionFeedback = (result) => {
  if (result?.outcome === 'projection_applied') {
    return 'La proyección local se actualizó. No se ejecutó una operación financiera.';
  }
  if (result?.outcome === 'projection_failed') {
    return 'La proyección local sigue pendiente. El resultado financiero no se volvió a ejecutar; revisa el código operativo y solicita ayuda si persiste.';
  }
  return 'No se confirmó la actualización local. El estado financiero no se reenvió; revisa el diagnóstico antes de continuar.';
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
const FinancialDiagnosticsPanel = ({ enabled = false, initiallyExpanded = false }) => {
  const cashMode = getCashMode();
  const runtimeSnapshot = useActorRuntimeSnapshot();
  const isStaff = Boolean(cashMode.actor?.isStaff);
  const actionContextKey = [
    cashMode.actor?.actorKey || 'unknown',
    runtimeSnapshot.status || 'unknown',
    runtimeSnapshot.actorType || 'unknown',
    runtimeSnapshot.actorId || 'unknown',
    runtimeSnapshot.generation ?? 'unknown',
    runtimeSnapshot.sessionId || 'unknown',
    runtimeSnapshot.tenant?.opaqueId || 'unknown',
    runtimeSnapshot.tenant?.databaseName || 'unknown',
    runtimeSnapshot.tenant?.generation ?? 'unknown'
  ].join(':');
  const [filter, setFilter] = useState('attention');
  const [diagnostics, setDiagnostics] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyIntentId, setBusyIntentId] = useState(null);
  const [message, setMessage] = useState('');
  const [actionFeedback, setActionFeedback] = useState({});
  const [expanded, setExpanded] = useState(() => Boolean(initiallyExpanded && !isStaff));
  const actionLockRef = useRef(false);
  const activeActionRef = useRef(null);

  const reload = useCallback(async () => {
    if (!enabled || !getCashMode().cloudEnabled) return [];
    setLoading(true);
    setMessage('');
    try {
      const options = diagnosticsOptions(filter);
      const [rows, nextSummary] = await Promise.all([
        listFinancialIntentDiagnostics({ ...options, limit: 50 }),
        getFinancialDiagnosticSummary({ limit: 50 })
      ]);
      const visible = rows.filter((diagnostic) => matchesFilter(diagnostic, filter));
      setDiagnostics(visible);
      setSummary(nextSummary);
      return visible;
    } catch (error) {
      setDiagnostics([]);
      setSummary(null);
      setMessage(error?.code || 'No se pudo leer el diagnóstico financiero.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled, filter]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    setExpanded(Boolean(initiallyExpanded && !isStaff));
    setSelectedId(null);
  }, [cashMode.actor?.actorKey, initiallyExpanded, isStaff]);

  useEffect(() => {
    activeActionRef.current = null;
    actionLockRef.current = false;
    setBusyIntentId(null);
    setActionFeedback({});
    setMessage('');
  }, [actionContextKey]);

  const selected = useMemo(() => diagnostics.find((diagnostic) => diagnostic.intentId === selectedId) || null, [diagnostics, selectedId]);

  const beginAction = (diagnostic) => {
    if (!diagnostic || actionLockRef.current) return null;
    actionLockRef.current = true;
    const token = Symbol('financial-diagnostics-action');
    activeActionRef.current = token;
    setBusyIntentId(diagnostic.intentId);
    setMessage('');
    return token;
  };

  const finishAction = (token) => {
    if (activeActionRef.current !== token) return;
    activeActionRef.current = null;
    actionLockRef.current = false;
    setBusyIntentId(null);
  };

  const isActionCurrent = (token) => activeActionRef.current === token;

  const captureActionHandle = () => {
    try {
      const actorHandle = actorRuntimeController.capture();
      actorHandle.assertCurrent();
      return actorHandle;
    } catch {
      return null;
    }
  };

  const withFinancialAction = async (diagnostic, action, kind) => {
    const token = beginAction(diagnostic);
    if (!token) return;
    const actorHandle = captureActionHandle();
    if (!actorHandle) {
      const text = 'La sesión autorizada cambió. No se consultó ni modificó la operación; vuelve a validar el actor de origen.';
      setActionFeedback((current) => ({ ...current, [diagnostic.intentId]: { kind, outcome: 'actor_changed', text } }));
      setMessage(text);
      finishAction(token);
      return;
    }
    try {
      const result = await action();
      actorHandle.assertCurrent();
      const nextDiagnostics = await reload();
      actorHandle.assertCurrent();
      if (activeActionRef.current !== token) return;
      let updated = nextDiagnostics.find((item) => item.intentId === diagnostic.intentId) || null;
      if (kind === 'receipt') {
        try {
          updated = await getFinancialIntentDiagnostic({ intentId: diagnostic.intentId }) || updated;
          actorHandle.assertCurrent();
        } catch {
          actorHandle.assertCurrent();
          updated = null;
        }
      }
      actorHandle.assertCurrent();
      if (activeActionRef.current !== token) return;
      const text = kind === 'receipt'
        ? receiptFeedback(result, updated)
        : projectionFeedback(result);
      setActionFeedback((current) => ({ ...current, [diagnostic.intentId]: { kind, outcome: result?.outcome || null, text } }));
      setMessage(nextDiagnostics.some((item) => item.intentId === diagnostic.intentId) ? '' : text);
    } catch {
      try {
        actorHandle.assertCurrent();
      } catch {
        return;
      }
      if (activeActionRef.current === token) {
        const text = kind === 'receipt'
          ? 'No se pudo confirmar la consulta del recibo. No reenvíes la operación; vuelve a consultar de forma segura.'
          : 'No se confirmó la actualización local. No se ejecutó otra operación financiera.';
        setActionFeedback((current) => ({
          ...current,
          [diagnostic.intentId]: { kind, outcome: 'error', text }
        }));
        setMessage(text);
      }
    } finally {
      finishAction(token);
    }
  };

  const handleReceipt = (diagnostic) => withFinancialAction(diagnostic, () => refreshFinancialIntentReceipt({
    intentId: diagnostic.intentId,
    licenseKey: getCashMode().licenseKey
  }), 'receipt');

  const handleProjection = (diagnostic) => withFinancialAction(
    diagnostic,
    () => retryFinancialIntentProjection({ intentId: diagnostic.intentId }),
    'projection'
  );

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
  if (!cashMode.cloudEnabled) {
    return <section className="financial-diagnostics" aria-label="Diagnóstico financiero"><p>Diagnóstico financiero no disponible para este modo.</p></section>;
  }

  const attentionCount = Number(summary?.requiringAttention || 0);
  const staffStatusUnavailable = !loading && !summary;
  if (!expanded) {
    return (
      <section className="financial-diagnostics financial-diagnostics--compact" aria-label="Verificación financiera">
        <div className="financial-diagnostics__compact-copy">
          <span className={`financial-diagnostics__compact-indicator${attentionCount > 0 || staffStatusUnavailable ? ' is-attention' : ''}`} aria-hidden="true" />
          <div>
            <strong>
              {loading
                ? 'Verificando operaciones financieras…'
                : staffStatusUnavailable
                  ? 'No se pudo verificar el estado financiero'
                  : attentionCount > 0
                    ? attentionCount === 1 ? 'Hay una operación pendiente de verificar' : `Hay ${attentionCount} operaciones pendientes de verificar`
                    : 'Operaciones financieras al día'}
            </strong>
            <p>
              {attentionCount > 0
                ? 'Revisa el detalle antes de continuar con una operación relacionada.'
                : staffStatusUnavailable
                  ? 'Abre el detalle para actualizar o revisar el diagnóstico.'
                  : 'No hay operaciones propias que requieran atención.'}
            </p>
          </div>
        </div>
        <button type="button" aria-expanded="false" onClick={() => setExpanded(true)}>
          {attentionCount > 0 || staffStatusUnavailable ? 'Revisar detalles' : 'Ver diagnóstico'}
        </button>
      </section>
    );
  }

  return (
    <section className={`financial-diagnostics${isStaff ? ' financial-diagnostics--staff-expanded' : ''}`} aria-labelledby="financial-diagnostics-title">
      <header className="financial-diagnostics__header">
        <div><p>Control local de reconciliación</p><h2 id="financial-diagnostics-title">Diagnóstico financiero</h2></div>
        <div className="financial-diagnostics__header-actions">
          <button type="button" onClick={reload} disabled={loading || Boolean(busyIntentId)}>Actualizar vista</button>
          <button type="button" aria-expanded="true" onClick={() => setExpanded(false)}>Ocultar detalles</button>
        </div>
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
        {diagnostics.map((diagnostic) => {
          const feedback = actionFeedback[diagnostic.intentId];
          const needsSupport = isSupportUncertain(diagnostic, feedback);
          return (
            <article key={diagnostic.intentId} className="financial-diagnostics__item">
              <div>
                <strong>{diagnostic.operationLabel}</strong>
                <p>{HEALTH_LABELS[diagnostic.healthStatus] || diagnostic.healthStatus}</p>
                <small>Financiero: {diagnostic.financialStatus} · Local: {diagnostic.projectionStatus}</small>
                <small>Actor: {diagnostic.originActorKey} · Edad: {age(diagnostic.ageMs)}</small>
                {feedback?.text && feedback.text !== message && <p className="financial-diagnostics__item-feedback" role="status">{feedback.text}</p>}
                {needsSupport && (
                  <Suspense fallback={<p className="financial-diagnostics__message" role="status">Preparando opciones de soporte…</p>}>
                    <FinancialSupportEscalation
                      diagnostic={diagnostic}
                      contextKey={actionContextKey}
                      busy={Boolean(busyIntentId)}
                      beginAction={beginAction}
                      finishAction={finishAction}
                      isActionCurrent={isActionCurrent}
                    />
                  </Suspense>
                )}
              </div>
              <div className="financial-diagnostics__actions">
                <button type="button" onClick={() => setSelectedId(diagnostic.intentId)}>Ver detalle</button>
                <button type="button" onClick={() => handleCopy(diagnostic)}>Copiar diagnóstico</button>
                <button type="button" disabled={!diagnostic.allowedActions.refreshReceipt || Boolean(busyIntentId)} onClick={() => handleReceipt(diagnostic)}>Consultar recibo</button>
                <button type="button" disabled={!diagnostic.allowedActions.retryProjection || Boolean(busyIntentId)} onClick={() => handleProjection(diagnostic)}>Reintentar actualización local</button>
                {diagnostic.allowedActions.requiresOriginActorLogin && <small>Requiere iniciar sesión con el actor de origen.</small>}
              </div>
            </article>
          );
        })}
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
