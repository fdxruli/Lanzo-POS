import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActorAccess } from '../../../services/auth/useActorAccess';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import {
  canStaffAccessSupportCenter,
  getNotificationCapabilities,
  getSupportChannel,
  isSupportCenterEnabled
} from '../../../services/notifications/notificationCapabilities';
import {
  buildFinancialDiagnosticText,
  buildFinancialSupportTicketSummary
} from '../../../services/financial/financialIntentDiagnostics';
import {
  getFinancialDiagnosticSummary,
  getFinancialIntentDiagnostic,
  listFinancialIntentDiagnostics
} from '../../../services/financial/financialIntentObservability';
import { retryFinancialIntentProjection } from '../../../services/financial/financialProjectionRepair';
import { refreshFinancialIntentReceipt } from '../../../services/financial/financialReceiptReconciliation';
import { listSupportTickets } from '../../../services/support/supportTicketService';
import { useAppStore } from '../../../store/useAppStore';
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

const SUPPORT_TICKET_PAGE_SIZE = 100;
const SUPPORT_TICKET_MAX_PAGES = 10;
const SUPPORT_TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINANCIAL_UNCERTAIN_STATUSES = new Set(['DISPATCHING', 'PENDING_RECEIPT', 'CONFLICT', 'BLOCKED']);
const UNCERTAIN_RECEIPT_OUTCOMES = new Set([
  'receipt_processing', 'receipt_not_found_no_resend', 'receipt_unavailable', 'receipt_conflict', 'receipt_unrecognized'
]);
const DEFINITIVE_TICKET_REJECTIONS = new Set([
  'SUPPORT_CENTER_DISABLED', 'STAFF_SUPPORT_DISABLED', 'INVALID_METADATA',
  'SUBJECT_REQUIRED', 'MESSAGE_TOO_SHORT', 'MESSAGE_TOO_LONG'
]);

const isTicketId = (value) => typeof value === 'string' && SUPPORT_TICKET_ID.test(value);
const isSupportUncertain = (diagnostic, feedback) => (
  FINANCIAL_UNCERTAIN_STATUSES.has(String(diagnostic?.financialStatus || '').toUpperCase())
  || (String(diagnostic?.financialStatus || '').toUpperCase() === 'PREPARED' && Number(diagnostic?.dispatchAttemptCount || 0) > 0)
  || (feedback?.kind === 'receipt' && UNCERTAIN_RECEIPT_OUTCOMES.has(feedback.outcome))
);

const lookupSupportTicketBySubject = async ({ licenseDetails, subject, actorHandle }) => {
  for (let page = 0; page < SUPPORT_TICKET_MAX_PAGES; page += 1) {
    actorHandle.assertCurrent();
    const offset = page * SUPPORT_TICKET_PAGE_SIZE;
    let result;
    try {
      result = await listSupportTickets({
        licenseDetails,
        limit: SUPPORT_TICKET_PAGE_SIZE,
        offset,
        includeClosed: true
      });
    } catch {
      actorHandle.assertCurrent();
      return { status: 'unavailable' };
    }
    actorHandle.assertCurrent();

    if (result?.success !== true || result?.skipped) return { status: 'unavailable' };
    const match = (result.tickets || []).find((ticket) => ticket.subject === subject);
    if (match) return isTicketId(match.id) ? { status: 'found', ticket: match } : { status: 'unverified' };
    if ((result.tickets || []).length < SUPPORT_TICKET_PAGE_SIZE) return { status: 'not_found' };
  }

  return { status: 'incomplete' };
};

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

const supportFailureMessage = (code) => {
  if (code === 'STAFF_SUPPORT_DISABLED') return 'Tu usuario Staff no tiene permiso para soporte interno. Contacta al administrador.';
  if (code === 'SUPPORT_CENTER_DISABLED') return 'Esta licencia no tiene soporte interno habilitado. Copia el diagnóstico sanitizado y contacta el canal externo de soporte.';
  return 'El servidor no confirmó la recepción del ticket.';
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
  const actorAccess = useActorAccess();
  const isStaff = Boolean(cashMode.actor?.isStaff) || actorAccess.actorType === 'staff';
  const supportLicenseDetails = useAppStore((state) => state.licenseDetails);
  const notificationsAccessDenied = useAppStore((state) => state.notificationsAccessDenied);
  const createTicket = useAppStore((state) => state.createTicket);
  const openNotificationCenter = useAppStore((state) => state.openNotificationCenter);
  const supportCapabilities = getNotificationCapabilities(supportLicenseDetails);
  const staffSupportPermission = canStaffAccessSupportCenter(supportLicenseDetails, actorAccess.permissionSession);
  const supportPlanEnabled = isSupportCenterEnabled(supportLicenseDetails)
    && getSupportChannel(supportLicenseDetails) === 'in_app'
    && supportCapabilities.support_tickets === true;
  const supportEnabled = actorAccess.isAuthorizedActor
    && !notificationsAccessDenied
    && supportPlanEnabled
    && staffSupportPermission;
  const supportContextKey = [
    actorAccess.actorType || 'unknown',
    actorAccess.actorId || 'unknown',
    actorAccess.runtimeSnapshot?.generation ?? 'unknown',
    actorAccess.runtimeSnapshot?.sessionId || 'unknown',
    supportLicenseDetails?.tenant_opaque_id || 'unknown',
    supportLicenseDetails?.tenant_database_name || supportLicenseDetails?.database_name || 'unknown',
    supportPlanEnabled ? 'support-enabled' : 'support-disabled',
    staffSupportPermission ? 'staff-authorized' : 'staff-denied',
    notificationsAccessDenied ? 'notifications-denied' : 'notifications-allowed'
  ].join(':');
  const [filter, setFilter] = useState('attention');
  const [diagnostics, setDiagnostics] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyIntentId, setBusyIntentId] = useState(null);
  const [message, setMessage] = useState('');
  const [actionFeedback, setActionFeedback] = useState({});
  const [supportFeedback, setSupportFeedback] = useState({});
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
    setSupportFeedback({});
    setMessage('');
  }, [supportContextKey]);

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

  const setSupportState = (intentId, token, state) => {
    if (activeActionRef.current !== token) return;
    setSupportFeedback((current) => ({ ...current, [intentId]: state }));
  };

  const openTicketInSupportCenter = (ticketId, actorHandle) => {
    if (!isTicketId(ticketId)) return;
    try {
      actorHandle.assertCurrent();
      openNotificationCenter?.({ tab: 'support', ticketId });
    } catch {
      // Ticket receipt remains confirmed even if the optional drawer cannot open.
    }
  };

  const findTicket = async (summary, actorHandle) => lookupSupportTicketBySubject({
    licenseDetails: supportLicenseDetails,
    subject: summary.subject,
    actorHandle
  });

  const showConfirmedTicket = (diagnostic, summary, ticket, token, actorHandle) => {
    actorHandle.assertCurrent();
    if (activeActionRef.current !== token || !isTicketId(ticket?.id)) return;
    setSupportState(diagnostic.intentId, token, {
      status: 'confirmed',
      correlationId: summary.correlationId,
      ticketId: ticket.id,
      text: `El servidor confirmó la recepción. Folio: ${ticket.id}.`
    });
    openTicketInSupportCenter(ticket.id, actorHandle);
  };

  const handleSupportLookup = async (diagnostic) => {
    const token = beginAction(diagnostic);
    if (!token) return;
    const actorHandle = captureActionHandle();
    if (!actorHandle) {
      setSupportState(diagnostic.intentId, token, {
        status: 'lookup_unavailable',
        text: 'La sesión autorizada cambió. No se consultó ni reenvió ningún ticket.'
      });
      finishAction(token);
      return;
    }
    const summary = buildFinancialSupportTicketSummary(diagnostic, { appVersion: globalThis.__APP_VERSION__ || null });
    if (!summary) {
      setSupportState(diagnostic.intentId, token, {
        status: 'lookup_unavailable',
        text: 'No se puede construir una referencia financiera segura. Copia el diagnóstico y contacta al administrador.'
      });
      finishAction(token);
      return;
    }
    setSupportState(diagnostic.intentId, token, {
      status: 'checking',
      correlationId: summary.correlationId,
      text: 'Consultando el historial autorizado de tickets…'
    });
    try {
      const found = await findTicket(summary, actorHandle);
      actorHandle.assertCurrent();
      if (found.status === 'found') {
        showConfirmedTicket(diagnostic, summary, found.ticket, token, actorHandle);
      } else {
        setSupportState(diagnostic.intentId, token, {
          status: 'uncertain',
          correlationId: summary.correlationId,
          text: found.status === 'not_found'
            ? 'No se encontró un ticket con esta referencia. El envío anterior sigue sin confirmarse; no se creó otro ticket automáticamente. Busca la referencia en el Centro de soporte o contacta al administrador.'
            : 'No se pudo completar la consulta de tickets. El envío anterior sigue sin confirmarse; no se creó otro ticket.'
        });
      }
    } catch {
      try {
        actorHandle.assertCurrent();
      } catch {
        return;
      }
      setSupportState(diagnostic.intentId, token, {
        status: 'uncertain',
        correlationId: summary.correlationId,
        text: 'No se pudo consultar el ticket. El envío anterior sigue sin confirmarse; no se creó otro ticket.'
      });
    } finally {
      finishAction(token);
    }
  };

  const handleSupportRequest = async (diagnostic) => {
    const token = beginAction(diagnostic);
    if (!token) return;
    const actorHandle = captureActionHandle();
    if (!actorHandle) {
      setSupportState(diagnostic.intentId, token, {
        status: 'lookup_unavailable',
        text: 'La sesión autorizada cambió. No se envió ningún ticket; vuelve a validar el actor.'
      });
      finishAction(token);
      return;
    }
    const summary = buildFinancialSupportTicketSummary(diagnostic, { appVersion: globalThis.__APP_VERSION__ || null });
    if (!summary) {
      setSupportState(diagnostic.intentId, token, {
        status: 'lookup_unavailable',
        text: 'No se puede construir una referencia financiera segura. Copia el diagnóstico y contacta al administrador.'
      });
      finishAction(token);
      return;
    }

    setSupportState(diagnostic.intentId, token, {
      status: 'checking',
      correlationId: summary.correlationId,
      text: 'Comprobando si ya existe un ticket para esta operación…'
    });

    try {
      actorHandle.assertCurrent();
      const existing = await findTicket(summary, actorHandle);
      actorHandle.assertCurrent();
      if (existing.status === 'found') {
        showConfirmedTicket(diagnostic, summary, existing.ticket, token, actorHandle);
        return;
      }
      if (existing.status !== 'not_found') {
        setSupportState(diagnostic.intentId, token, {
          status: 'lookup_failed',
          correlationId: summary.correlationId,
          text: 'No se envió una solicitud porque no se pudo comprobar el historial de tickets. Intenta consultar de nuevo o usa el Centro de soporte.'
        });
        return;
      }

      const result = await createTicket?.({
        subject: summary.subject,
        category: 'cash',
        priority: 'normal',
        message: summary.message,
        metadata: { source: 'financial_diagnostics' }
      });
      actorHandle.assertCurrent();

      if (result?.success === true && isTicketId(result?.ticket?.id)) {
        showConfirmedTicket(diagnostic, summary, result.ticket, token, actorHandle);
        return;
      }

      if (result?.success === false && DEFINITIVE_TICKET_REJECTIONS.has(result?.code)) {
        setSupportState(diagnostic.intentId, token, {
          status: 'rejected',
          correlationId: summary.correlationId,
          text: supportFailureMessage(result.code)
        });
        return;
      }

      setSupportState(diagnostic.intentId, token, {
        status: 'uncertain',
        correlationId: summary.correlationId,
        text: 'No llegó una confirmación válida del servidor. El ticket podría haberse creado; no enviaremos otro automáticamente.'
      });

      const recovered = await findTicket(summary, actorHandle);
      actorHandle.assertCurrent();
      if (recovered.status === 'found') {
        showConfirmedTicket(diagnostic, summary, recovered.ticket, token, actorHandle);
      } else {
        setSupportState(diagnostic.intentId, token, {
          status: 'uncertain',
          correlationId: summary.correlationId,
          text: recovered.status === 'not_found'
            ? 'No llegó una confirmación válida y el historial no muestra un ticket con esta referencia. El resultado sigue incierto; no se reenvió. Consulta el Centro de soporte manualmente antes de continuar.'
            : 'No llegó una confirmación válida y no se pudo comprobar el historial. El resultado sigue incierto; no se reenvió.'
        });
      }
    } catch {
      try {
        actorHandle.assertCurrent();
      } catch {
        return;
      }
      setSupportState(diagnostic.intentId, token, {
        status: 'uncertain',
        correlationId: summary.correlationId,
        text: 'No se recibió una confirmación del servidor. El ticket podría haberse creado; no enviaremos otro automáticamente.'
      });
      try {
        const recovered = await findTicket(summary, actorHandle);
        actorHandle.assertCurrent();
        if (recovered.status === 'found') {
          showConfirmedTicket(diagnostic, summary, recovered.ticket, token, actorHandle);
        } else if (activeActionRef.current === token) {
          setSupportState(diagnostic.intentId, token, {
            status: 'uncertain',
            correlationId: summary.correlationId,
            text: recovered.status === 'not_found'
              ? 'No se encontró el ticket en el historial consultado. El resultado sigue incierto; no se reenvió. Busca la referencia en el Centro de soporte o contacta al administrador.'
              : 'No se pudo verificar el historial de tickets. El resultado sigue incierto; no se reenvió.'
          });
        }
      } catch {
        try {
          actorHandle.assertCurrent();
        } catch {
          return;
        }
      }
    } finally {
      finishAction(token);
    }
  };

  const openSupportCenter = (diagnostic) => {
    try {
      const actorHandle = actorRuntimeController.capture();
      actorHandle.assertCurrent();
      openNotificationCenter?.({ tab: 'support' });
    } catch {
      setSupportFeedback((current) => ({
        ...current,
        [diagnostic.intentId]: { ...current[diagnostic.intentId], text: 'La sesión cambió. Inicia sesión con el actor autorizado y vuelve a abrir Soporte.' }
      }));
    }
  };

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
          const supportState = supportFeedback[diagnostic.intentId];
          const needsSupport = isSupportUncertain(diagnostic, feedback);
          const staffDenied = isStaff && !staffSupportPermission;
          const supportUnavailable = !supportPlanEnabled || notificationsAccessDenied || !actorAccess.isAuthorizedActor;
          return (
            <article key={diagnostic.intentId} className="financial-diagnostics__item">
              <div>
                <strong>{diagnostic.operationLabel}</strong>
                <p>{HEALTH_LABELS[diagnostic.healthStatus] || diagnostic.healthStatus}</p>
                <small>Financiero: {diagnostic.financialStatus} · Local: {diagnostic.projectionStatus}</small>
                <small>Actor: {diagnostic.originActorKey} · Edad: {age(diagnostic.ageMs)}</small>
                {feedback?.text && feedback.text !== message && <p className="financial-diagnostics__item-feedback" role="status">{feedback.text}</p>}
                {needsSupport && (
                  <div className="financial-diagnostics__support" aria-label="Escalamiento de operación financiera">
                    <strong>Solicitar revisión de soporte</strong>
                    {supportState?.text && <p role="status">{supportState.text}</p>}
                    {supportState?.status === 'confirmed' ? (
                      <button type="button" onClick={() => openSupportCenter(diagnostic)} disabled={Boolean(busyIntentId)}>
                        Abrir folio en Centro de soporte
                      </button>
                    ) : supportEnabled ? (
                      supportState?.status === 'uncertain' || supportState?.status === 'lookup_failed' ? (
                        <div className="financial-diagnostics__support-actions">
                          <button type="button" onClick={() => handleSupportLookup(diagnostic)} disabled={Boolean(busyIntentId)}>
                            Consultar tickets
                          </button>
                          <button type="button" onClick={() => openSupportCenter(diagnostic)} disabled={Boolean(busyIntentId)}>
                            Abrir Centro de soporte
                          </button>
                        </div>
                      ) : supportState?.status === 'rejected' || supportState?.status === 'lookup_unavailable' ? (
                        <button type="button" onClick={() => openSupportCenter(diagnostic)} disabled={Boolean(busyIntentId)}>
                          Abrir Centro de soporte
                        </button>
                      ) : (
                        <button type="button" onClick={() => handleSupportRequest(diagnostic)} disabled={Boolean(busyIntentId)}>
                          {supportState?.status === 'checking' ? 'Comprobando soporte…' : 'Solicitar soporte'}
                        </button>
                      )
                    ) : staffDenied ? (
                      <p>Tu usuario Staff no tiene permiso para soporte interno. Contacta al administrador; puedes copiar el diagnóstico sanitizado.</p>
                    ) : supportPlanEnabled && notificationsAccessDenied ? (
                      <p>No se pudo validar el acceso al Centro de soporte. Contacta al administrador; puedes copiar el diagnóstico sanitizado.</p>
                    ) : !actorAccess.isAuthorizedActor ? (
                      <p>Valida una sesión autorizada antes de solicitar soporte. No se envió ningún ticket.</p>
                    ) : supportUnavailable ? (
                      <p>Esta licencia no tiene tickets internos habilitados. Usa «Copiar diagnóstico» y contacta el canal externo de soporte.</p>
                    ) : null}
                    {(supportState?.status === 'uncertain' || supportState?.status === 'lookup_failed') && (
                      <small>La RPC actual no deduplica tickets por operación. El resultado incierto no se reenvía automáticamente.</small>
                    )}
                  </div>
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
