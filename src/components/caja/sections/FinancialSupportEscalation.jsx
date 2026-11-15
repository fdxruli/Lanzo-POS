import { useEffect, useState } from 'react';
import { useActorAccess } from '../../../services/auth/useActorAccess';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import {
  canStaffAccessSupportCenter,
  getNotificationCapabilities,
  getSupportChannel,
  isSupportCenterEnabled
} from '../../../services/notifications/notificationCapabilities';
import { buildFinancialSupportTicketSummary } from '../../../services/financial/financialIntentDiagnostics';
import { listSupportTickets } from '../../../services/support/supportTicketService';
import { getCashMode } from '../../../services/cash/cashActor';
import { useAppStore } from '../../../store/useAppStore';

const SUPPORT_TICKET_PAGE_SIZE = 100;
const SUPPORT_TICKET_MAX_PAGES = 10;
const SUPPORT_TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFINITIVE_TICKET_REJECTIONS = new Set([
  'SUPPORT_CENTER_DISABLED', 'STAFF_SUPPORT_DISABLED', 'INVALID_METADATA',
  'SUBJECT_REQUIRED', 'MESSAGE_TOO_SHORT', 'MESSAGE_TOO_LONG'
]);

const isTicketId = (value) => typeof value === 'string' && SUPPORT_TICKET_ID.test(value);

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

const supportFailureMessage = (code) => {
  if (code === 'STAFF_SUPPORT_DISABLED') return 'Tu usuario Staff no tiene permiso para soporte interno. Contacta al administrador.';
  if (code === 'SUPPORT_CENTER_DISABLED') return 'Esta licencia no tiene soporte interno habilitado. Copia el diagnóstico sanitizado y contacta el canal externo de soporte.';
  return 'El servidor no confirmó la recepción del ticket.';
};

const FinancialSupportEscalation = ({
  diagnostic,
  contextKey,
  busy = false,
  beginAction,
  finishAction,
  isActionCurrent
}) => {
  const actorAccess = useActorAccess();
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
  const isStaff = Boolean(getCashMode().actor?.isStaff) || actorAccess.actorType === 'staff';
  const currentContextKey = [
    contextKey,
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
  const [supportState, setSupportState] = useState(null);

  useEffect(() => {
    setSupportState(null);
  }, [currentContextKey, diagnostic.intentId]);

  const setActionState = (token, nextState) => {
    if (!isActionCurrent(token)) return;
    setSupportState(nextState);
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

  const findTicket = async (summary, actorHandle) => lookupSupportTicketBySubject({
    licenseDetails: supportLicenseDetails,
    subject: summary.subject,
    actorHandle
  });

  const openTicketInSupportCenter = (ticketId, actorHandle) => {
    if (!isTicketId(ticketId)) return;
    try {
      actorHandle.assertCurrent();
      openNotificationCenter?.({ tab: 'support', ticketId });
    } catch {
      // Ticket receipt remains confirmed even if the optional drawer cannot open.
    }
  };

  const showConfirmedTicket = (summary, ticket, token, actorHandle) => {
    actorHandle.assertCurrent();
    if (!isActionCurrent(token) || !isTicketId(ticket?.id)) return;
    setActionState(token, {
      status: 'confirmed',
      correlationId: summary.correlationId,
      ticketId: ticket.id,
      text: `El servidor confirmó la recepción. Folio: ${ticket.id}.`
    });
    openTicketInSupportCenter(ticket.id, actorHandle);
  };

  const openSupportCenter = () => {
    try {
      const actorHandle = actorRuntimeController.capture();
      actorHandle.assertCurrent();
      openNotificationCenter?.({ tab: 'support' });
    } catch {
      setSupportState((current) => ({
        ...current,
        text: 'La sesión cambió. Inicia sesión con el actor autorizado y vuelve a abrir Soporte.'
      }));
    }
  };

  const handleSupportLookup = async () => {
    const token = beginAction(diagnostic);
    if (!token) return;
    const actorHandle = captureActionHandle();
    if (!actorHandle) {
      setActionState(token, {
        status: 'lookup_unavailable',
        text: 'La sesión autorizada cambió. No se consultó ni reenvió ningún ticket.'
      });
      finishAction(token);
      return;
    }
    const summary = buildFinancialSupportTicketSummary(diagnostic, { appVersion: globalThis.__APP_VERSION__ || null });
    if (!summary) {
      setActionState(token, {
        status: 'lookup_unavailable',
        text: 'No se puede construir una referencia financiera segura. Copia el diagnóstico y contacta al administrador.'
      });
      finishAction(token);
      return;
    }
    setActionState(token, {
      status: 'checking',
      correlationId: summary.correlationId,
      text: 'Consultando el historial autorizado de tickets…'
    });
    try {
      const found = await findTicket(summary, actorHandle);
      actorHandle.assertCurrent();
      if (found.status === 'found') {
        showConfirmedTicket(summary, found.ticket, token, actorHandle);
      } else {
        setActionState(token, {
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
      setActionState(token, {
        status: 'uncertain',
        correlationId: summary.correlationId,
        text: 'No se pudo consultar el ticket. El envío anterior sigue sin confirmarse; no se creó otro ticket.'
      });
    } finally {
      finishAction(token);
    }
  };

  const handleSupportRequest = async () => {
    const token = beginAction(diagnostic);
    if (!token) return;
    const actorHandle = captureActionHandle();
    if (!actorHandle) {
      setActionState(token, {
        status: 'lookup_unavailable',
        text: 'La sesión autorizada cambió. No se envió ningún ticket; vuelve a validar el actor.'
      });
      finishAction(token);
      return;
    }
    const summary = buildFinancialSupportTicketSummary(diagnostic, { appVersion: globalThis.__APP_VERSION__ || null });
    if (!summary) {
      setActionState(token, {
        status: 'lookup_unavailable',
        text: 'No se puede construir una referencia financiera segura. Copia el diagnóstico y contacta al administrador.'
      });
      finishAction(token);
      return;
    }

    setActionState(token, {
      status: 'checking',
      correlationId: summary.correlationId,
      text: 'Comprobando si ya existe un ticket para esta operación…'
    });

    try {
      actorHandle.assertCurrent();
      const existing = await findTicket(summary, actorHandle);
      actorHandle.assertCurrent();
      if (existing.status === 'found') {
        showConfirmedTicket(summary, existing.ticket, token, actorHandle);
        return;
      }
      if (existing.status !== 'not_found') {
        setActionState(token, {
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
        showConfirmedTicket(summary, result.ticket, token, actorHandle);
        return;
      }

      if (result?.success === false && DEFINITIVE_TICKET_REJECTIONS.has(result?.code)) {
        setActionState(token, {
          status: 'rejected',
          correlationId: summary.correlationId,
          text: supportFailureMessage(result.code)
        });
        return;
      }

      setActionState(token, {
        status: 'uncertain',
        correlationId: summary.correlationId,
        text: 'No llegó una confirmación válida del servidor. El ticket podría haberse creado; no enviaremos otro automáticamente.'
      });

      const recovered = await findTicket(summary, actorHandle);
      actorHandle.assertCurrent();
      if (recovered.status === 'found') {
        showConfirmedTicket(summary, recovered.ticket, token, actorHandle);
      } else {
        setActionState(token, {
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
      setActionState(token, {
        status: 'uncertain',
        correlationId: summary.correlationId,
        text: 'No se recibió una confirmación del servidor. El ticket podría haberse creado; no enviaremos otro automáticamente.'
      });
      try {
        const recovered = await findTicket(summary, actorHandle);
        actorHandle.assertCurrent();
        if (recovered.status === 'found') {
          showConfirmedTicket(summary, recovered.ticket, token, actorHandle);
        } else if (isActionCurrent(token)) {
          setActionState(token, {
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

  return (
    <div className="financial-diagnostics__support" aria-label="Escalamiento de operación financiera">
      <strong>Solicitar revisión de soporte</strong>
      {supportState?.text && <p role="status">{supportState.text}</p>}
      {supportState?.status === 'confirmed' ? (
        <button type="button" onClick={openSupportCenter} disabled={busy}>
          Abrir folio en Centro de soporte
        </button>
      ) : supportEnabled ? (
        supportState?.status === 'uncertain' || supportState?.status === 'lookup_failed' ? (
          <div className="financial-diagnostics__support-actions">
            <button type="button" onClick={handleSupportLookup} disabled={busy}>Consultar tickets</button>
            <button type="button" onClick={openSupportCenter} disabled={busy}>Abrir Centro de soporte</button>
          </div>
        ) : supportState?.status === 'rejected' || supportState?.status === 'lookup_unavailable' ? (
          <button type="button" onClick={openSupportCenter} disabled={busy}>Abrir Centro de soporte</button>
        ) : (
          <button type="button" onClick={handleSupportRequest} disabled={busy}>
            {supportState?.status === 'checking' ? 'Comprobando soporte…' : 'Solicitar soporte'}
          </button>
        )
      ) : isStaff && !staffSupportPermission ? (
        <p>Tu usuario Staff no tiene permiso para soporte interno. Contacta al administrador; puedes copiar el diagnóstico sanitizado.</p>
      ) : !actorAccess.isAuthorizedActor ? (
        <p>Valida una sesión autorizada antes de solicitar soporte. No se envió ningún ticket.</p>
      ) : supportPlanEnabled && notificationsAccessDenied ? (
        <p>No se pudo validar el acceso al Centro de soporte. Contacta al administrador; puedes copiar el diagnóstico sanitizado.</p>
      ) : (
        <p>Esta licencia no tiene tickets internos habilitados. Usa «Copiar diagnóstico» y contacta el canal externo de soporte.</p>
      )}
      {(supportState?.status === 'uncertain' || supportState?.status === 'lookup_failed') && (
        <small>La RPC actual no deduplica tickets por operación. El resultado incierto no se reenvía automáticamente.</small>
      )}
    </div>
  );
};

export default FinancialSupportEscalation;
