import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Send } from 'lucide-react';
import {
  formatIncidentDiagnostic,
  INCIDENT_REPORT_STATUS,
  submitIncidentReport
} from '../../services/diagnostics/incidentReporter';
import { buildIncidentCommunicationMessage } from '../../services/diagnostics/incidentCommunication';
import {
  buildSupportMailtoUrl,
  copyTextToClipboard,
  getSupportEmail
} from '../../services/support/supportContact';
import {
  buildTelegramSupportTarget,
  TELEGRAM_CHANNEL_DIRECT_MESSAGES_STATUS,
  TELEGRAM_USERNAME
} from '../../services/support/telegramContact';
import './IncidentReportForm.css';

const REPORT_REFERENCE_PATTERN = /^IR-[A-F0-9]{16}$/;

const getOnlineState = () => {
  try {
    return globalThis.navigator?.onLine !== false;
  } catch {
    return true;
  }
};

const isContextCurrent = (guard) => {
  if (typeof guard !== 'function') return true;
  try {
    return guard() === true;
  } catch {
    return false;
  }
};

const getStatusMessage = (status, code, reference) => {
  if (status === INCIDENT_REPORT_STATUS.SENDING) return 'Enviando el diagnóstico. Espera la confirmación del servidor.';
  if (status === INCIDENT_REPORT_STATUS.SENT) return `Lanzo recibió el reporte. Folio: ${reference}`;
  if (status === INCIDENT_REPORT_STATUS.OFFLINE) return 'Sin conexión. No se envió el reporte; puedes preparar y copiar un diagnóstico local.';
  if (status === INCIDENT_REPORT_STATUS.UNAVAILABLE) return 'El servicio para recibir reportes todavía no está disponible. No se registró el reporte; puedes copiarlo o contactar soporte por correo.';
  if (status === INCIDENT_REPORT_STATUS.FAILED && code === 'INCIDENT_REPORT_RATE_LIMITED') return 'Se alcanzó el límite temporal de reportes. Copia el diagnóstico e inténtalo más tarde.';
  if (status === INCIDENT_REPORT_STATUS.FAILED && code === 'INCIDENT_REPORT_AUTHORIZATION_FAILED') return 'La sesión o el dispositivo no pudo autorizar el envío. Vuelve a abrir el Centro de Recuperación y, si continúa, comparte el diagnóstico por correo.';
  if (status === INCIDENT_REPORT_STATUS.FAILED && code === 'INCIDENT_REPORT_CONTEXT_CHANGED') return 'El negocio o la sesión cambió. Este folio ya no se comparte desde el contexto actual. Abre de nuevo el reporte para continuar.';
  if (status === INCIDENT_REPORT_STATUS.FAILED) return 'No se confirmó la recepción del reporte. Puedes copiar el diagnóstico e intentarlo de nuevo.';
  return 'El diagnóstico se enviará únicamente después de tu confirmación.';
};

export default function IncidentReportForm({
  incident,
  services = null,
  isContextCurrent: isContextCurrentProp = null,
  openOnMount = false,
  onClose = null
}) {
  const onlineState = services?.getOnlineState || getOnlineState;
  const copyText = services?.copyText || copyTextToClipboard;
  const id = useId().replace(/:/g, '');
  const descriptionId = `incident-report-description-${id}`;
  const communicationMessageId = `incident-communication-message-${id}`;
  const communicationHelpId = `incident-communication-help-${id}`;
  const [open, setOpen] = useState(openOnMount);
  const [reportStatus, setReportStatus] = useState(() => (openOnMount
    ? (onlineState() ? INCIDENT_REPORT_STATUS.READY : INCIDENT_REPORT_STATUS.OFFLINE)
    : INCIDENT_REPORT_STATUS.NOT_STARTED));
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [reportCode, setReportCode] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [diagnosticCopyStatus, setDiagnosticCopyStatus] = useState('');
  const [preparedCommunication, setPreparedCommunication] = useState(null);
  const [communicationStatus, setCommunicationStatus] = useState('');
  const [communicationFeedback, setCommunicationFeedback] = useState('');
  const headingRef = useRef(null);
  const openingContextGuard = useRef(null);
  const messageField = useRef(null);
  const submitInFlight = useRef(false);
  const currentIncidentId = incident?.incident_id || '';
  const currentIncidentIdRef = useRef(currentIncidentId);
  currentIncidentIdRef.current = currentIncidentId;

  const getContextGuard = useCallback(() => (
    typeof isContextCurrentProp === 'function'
      ? isContextCurrentProp
      : openingContextGuard.current
  ), [isContextCurrentProp]);

  const currentGuard = getContextGuard();
  const contextIsCurrent = isContextCurrent(currentGuard);
  const currentReceipt = reportStatus === INCIDENT_REPORT_STATUS.SENT && receipt
    && receipt.incidentId === currentIncidentId
    && REPORT_REFERENCE_PATTERN.test(receipt.reportReference)
    && isContextCurrent(receipt.guard)
    && contextIsCurrent
    ? receipt
    : null;
  const currentPreparedCommunication = preparedCommunication
    && preparedCommunication.incidentId === currentIncidentId
    && isContextCurrent(preparedCommunication.guard)
    && contextIsCurrent
    ? preparedCommunication
    : null;
  const visibleReportStatus = reportStatus === INCIDENT_REPORT_STATUS.SENT && !currentReceipt
    ? INCIDENT_REPORT_STATUS.FAILED
    : reportStatus;
  const visibleReportCode = reportStatus === INCIDENT_REPORT_STATUS.SENT && !currentReceipt
    ? 'INCIDENT_REPORT_CONTEXT_CHANGED'
    : reportCode;
  const telegramSupportTarget = buildTelegramSupportTarget();
  const telegramUrl = currentPreparedCommunication
    ? telegramSupportTarget.url
    : '';
  const supportEmail = services?.supportEmail || getSupportEmail();
  const emailUrl = currentPreparedCommunication
    ? buildSupportMailtoUrl({
      to: supportEmail,
      subject: 'Seguimiento de incidencia técnica en Lanzo POS',
      body: currentPreparedCommunication.message
    })
    : '';

  useEffect(() => {
    setReportStatus(onlineState() ? INCIDENT_REPORT_STATUS.READY : INCIDENT_REPORT_STATUS.OFFLINE);
    setDescription('');
    setConsent(false);
    setReportCode('');
    setReceipt(null);
    setDiagnosticCopyStatus('');
    setPreparedCommunication(null);
    setCommunicationStatus('');
    setCommunicationFeedback('');
  }, [currentIncidentId, onlineState]);

  const handleOpen = useCallback(async () => {
    if (typeof isContextCurrentProp === 'function') {
      openingContextGuard.current = isContextCurrentProp;
    } else {
      try {
        const { createRecoveryContextGuard } = await import('../../services/diagnostics/recoveryContext');
        openingContextGuard.current = createRecoveryContextGuard();
      } catch {
        openingContextGuard.current = () => false;
      }
    }
    setConsent(false);
    setReceipt(null);
    setReportCode('');
    setDiagnosticCopyStatus('');
    setPreparedCommunication(null);
    setCommunicationStatus('');
    setCommunicationFeedback('');
    setReportStatus(onlineState() ? INCIDENT_REPORT_STATUS.READY : INCIDENT_REPORT_STATUS.OFFLINE);
    setOpen(true);
  }, [isContextCurrentProp, onlineState]);

  useEffect(() => {
    if (openOnMount) void handleOpen();
  }, [handleOpen, openOnMount]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  if (!incident) return null;

  const handleCopyDiagnostic = async () => {
    setDiagnosticCopyStatus('');
    try {
      if (!isContextCurrent(getContextGuard())) {
        setDiagnosticCopyStatus('El contexto cambió. Abre de nuevo la incidencia para copiar el diagnóstico.');
        return;
      }
      // The optional free-text description is deliberately omitted.
      const diagnostic = formatIncidentDiagnostic(incident);
      const copied = await copyText(diagnostic);
      setDiagnosticCopyStatus(copied === true
        ? 'Diagnóstico local copiado. Revísalo antes de compartirlo.'
        : 'No se pudo copiar automáticamente. Puedes volver a intentarlo o usar el correo de soporte.');
    } catch {
      setDiagnosticCopyStatus('No se pudo copiar automáticamente. Puedes volver a intentarlo o usar el correo de soporte.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (
      consent !== true
      || submitInFlight.current
      || reportStatus === INCIDENT_REPORT_STATUS.SENDING
      || currentReceipt
    ) return;

    const guard = getContextGuard();
    if (!isContextCurrent(guard)) {
      setReceipt(null);
      setReportStatus(INCIDENT_REPORT_STATUS.FAILED);
      setReportCode('INCIDENT_REPORT_CONTEXT_CHANGED');
      return;
    }

    const submittingIncidentId = currentIncidentId;
    submitInFlight.current = true;
    setReportStatus(INCIDENT_REPORT_STATUS.SENDING);
    setReportCode('');
    setReceipt(null);

    try {
      let currentLicenseDetails = {};
      if (!services) {
        const { useAppStore } = await import('../../store/useAppStore');
        currentLicenseDetails = useAppStore.getState()?.licenseDetails || {};
      }
      const submit = services ? services.submit : submitIncidentReport;
      // An injected service without a transport fails closed; no production fallback.
      if (typeof submit !== 'function') throw new Error('REPORT_TRANSPORT_UNAVAILABLE');
      const result = await submit(incident, {
        consent,
        userDescription: description,
        licenseDetails: currentLicenseDetails,
        isContextCurrent: guard
      });
      const contextStillMatches = (
        currentIncidentIdRef.current === submittingIncidentId
        && isContextCurrent(guard)
        && isContextCurrent(getContextGuard())
      );
      if (!contextStillMatches) {
        if (currentIncidentIdRef.current === submittingIncidentId) {
          setReceipt(null);
          setReportStatus(INCIDENT_REPORT_STATUS.FAILED);
          setReportCode('INCIDENT_REPORT_CONTEXT_CHANGED');
          setPreparedCommunication(null);
          setCommunicationStatus('error');
          setCommunicationFeedback('El contexto del negocio o la sesión cambió. Abre de nuevo la incidencia antes de compartirla.');
        }
        return;
      }

      if (
        result?.status === INCIDENT_REPORT_STATUS.SENT
        && REPORT_REFERENCE_PATTERN.test(result.reportReference || '')
      ) {
        setReceipt({
          incidentId: submittingIncidentId,
          reportReference: result.reportReference,
          guard
        });
        setReportStatus(INCIDENT_REPORT_STATUS.SENT);
        setReportCode('');
      } else {
        setReceipt(null);
        setReportStatus(result?.status || INCIDENT_REPORT_STATUS.FAILED);
        setReportCode(result?.code || '');
      }
    } catch {
      if (currentIncidentIdRef.current === submittingIncidentId) {
        setReceipt(null);
        setReportStatus(INCIDENT_REPORT_STATUS.FAILED);
        setReportCode(isContextCurrent(guard)
          ? 'INCIDENT_REPORT_DELIVERY_FAILED'
          : 'INCIDENT_REPORT_CONTEXT_CHANGED');
      }
    } finally {
      submitInFlight.current = false;
    }
  };

  const handlePrepareCommunication = () => {
    const guard = getContextGuard();
    if (!isContextCurrent(guard)) {
      setReceipt(null);
      setPreparedCommunication(null);
      setReportStatus(INCIDENT_REPORT_STATUS.FAILED);
      setReportCode('INCIDENT_REPORT_CONTEXT_CHANGED');
      setCommunicationStatus('error');
      setCommunicationFeedback('No se preparó el mensaje. Vuelve a abrir la incidencia desde el contexto actual.');
      return;
    }

    const useReceipt = currentReceipt && currentReceipt.incidentId === currentIncidentId;
    const message = (services?.buildCommunication || buildIncidentCommunicationMessage)({
      incident,
      reportStatus: useReceipt ? INCIDENT_REPORT_STATUS.SENT : visibleReportStatus,
      reportReference: useReceipt?.reportReference,
      reportIncidentId: useReceipt?.incidentId,
      contextIsCurrent: useReceipt ? isContextCurrent(useReceipt.guard) && isContextCurrent(guard) : false
    });
    const messageState = {
      incidentId: currentIncidentId,
      message,
      guard,
      receiptConfirmed: Boolean(useReceipt)
    };
    setPreparedCommunication(messageState);
    setCommunicationStatus('prepared');
    setCommunicationFeedback(useReceipt
      ? 'Mensaje preparado con el folio que confirmó el servidor. Revísalo, cópialo y envíalo manualmente.'
      : 'Diagnóstico local preparado. Lanzo no ha confirmado su recepción y el mensaje no incluye un folio.');
  };

  const handleCopyCommunication = async () => {
    if (!currentPreparedCommunication || !isContextCurrent(currentPreparedCommunication.guard)) {
      setCommunicationStatus('error');
      setCommunicationFeedback('El contexto cambió. Vuelve a preparar el mensaje antes de compartirlo.');
      return;
    }

    let copied = false;
    try {
      copied = await copyText(currentPreparedCommunication.message) === true;
    } catch {
      copied = false;
    }

    if (!isContextCurrent(currentPreparedCommunication.guard) || !isContextCurrent(getContextGuard())) {
      setPreparedCommunication(null);
      setCommunicationStatus('error');
      setCommunicationFeedback('El contexto cambió durante la copia. No compartas el texto anterior; prepara un mensaje nuevo.');
      return;
    }

    if (copied) {
      setCommunicationStatus('copied');
      setCommunicationFeedback('Mensaje copiado. Revísalo y compártelo manualmente; todavía no se ha enviado.');
      return;
    }

    setCommunicationStatus('copy_failed');
    setCommunicationFeedback('No se pudo copiar automáticamente. Selecciona el texto del campo y cópialo manualmente.');
    messageField.current?.focus();
    messageField.current?.select();
  };

  const handleTelegramClick = (event) => {
    if (!currentPreparedCommunication || !isContextCurrent(currentPreparedCommunication.guard) || !isContextCurrent(getContextGuard())) {
      event.preventDefault();
      setPreparedCommunication(null);
      setCommunicationStatus('error');
      setCommunicationFeedback('El contexto cambió. Vuelve a preparar el mensaje antes de abrir Telegram.');
      return;
    }

    setCommunicationStatus('telegram_channel_open_requested');
    setCommunicationFeedback('Se abrirá el canal público de Lanzo como referencia. Copiar o abrirlo no entrega el diagnóstico; usa correo electrónico para contactar a soporte.');
  };

  const handleEmailClick = (event) => {
    if (!currentPreparedCommunication || !isContextCurrent(currentPreparedCommunication.guard) || !isContextCurrent(getContextGuard())) {
      event.preventDefault();
      setPreparedCommunication(null);
      setCommunicationStatus('error');
      setCommunicationFeedback('El contexto cambió. Vuelve a preparar el mensaje antes de abrir el correo.');
      return;
    }

    if (services?.inspectEmail) {
      event.preventDefault();
      services.inspectEmail(emailUrl);
      setCommunicationFeedback('Borrador inspeccionado localmente. No se abrió ni envió correo.');
      return;
    }
    setCommunicationStatus('email_open_requested');
    setCommunicationFeedback('Se abrió o intentó abrir un borrador de correo. Revisa el contenido y envíalo manualmente; esto no registra el reporte.');
  };

  return (
    <section className="incident-report" aria-label="Reporte técnico de incidencia">
      {!open ? (
        <button
          type="button"
          className="ui-button ui-button--ghost incident-report__open"
          onClick={handleOpen}
        >
          <Send size={16} aria-hidden="true" />
          Reportar problema
        </button>
      ) : (
        <form className="incident-report__form" onSubmit={handleSubmit}>
          <div className="incident-report__heading">
            <h3 ref={headingRef} tabIndex={-1}>Enviar diagnóstico técnico</h3>
            <p>El reporte requiere internet y tu confirmación. El folio solo aparece cuando el servidor confirma la recepción.</p>
          </div>

          <dl className="incident-report__code">
            <div><dt>Código técnico</dt><dd>{incident.safe_code}</dd></div>
          </dl>

          <div className="incident-report__shared" aria-label="Información técnica que se compartirá al enviar el reporte">
            <p>Si confirmas el reporte, se compartirán:</p>
            <ul>
              <li>código, categoría, gravedad y sección normalizada</li>
              <li>versión, commit, familia de navegador, plataforma y conexión</li>
              <li>estado de recuperación, fecha e identificadores técnicos opacos</li>
            </ul>
            <p className="incident-report__excluded">
              No se incluyen licencias, tokens, cookies, datos de clientes, ventas, pagos, caja, almacenamiento local ni trazas técnicas completas.
            </p>
          </div>

          <label className="incident-report__description-label" htmlFor={descriptionId}>
            Describe qué ocurrió (opcional)
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
            placeholder="Escribe solo lo que quieras compartir. Evita datos personales, ventas, pagos o credenciales."
            aria-describedby={`${descriptionId}-help`}
          />
          <p className="incident-report__hint" id={`${descriptionId}-help`}>
            {description.length}/500 caracteres. Este texto libre no se sanitiza automáticamente; revísalo antes de enviarlo. No se adjunta a Telegram ni al correo de seguimiento.
          </p>

          <label className="incident-report__consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>Confirmo que quiero compartir el diagnóstico y, si escribí una descripción, también ese texto con el servicio técnico de Lanzo.</span>
          </label>

          <div className="incident-report__actions">
            <button
              type="submit"
              className="ui-button ui-button--primary"
              disabled={!consent || reportStatus === INCIDENT_REPORT_STATUS.SENDING || Boolean(currentReceipt) || !contextIsCurrent}
            >
              {visibleReportStatus === INCIDENT_REPORT_STATUS.SENT
                ? <Check size={16} aria-hidden="true" />
                : <Send size={16} aria-hidden="true" />}
              {visibleReportStatus === INCIDENT_REPORT_STATUS.SENDING ? 'Enviando…' : visibleReportStatus === INCIDENT_REPORT_STATUS.SENT ? 'Recibido' : 'Enviar reporte'}
            </button>
            <button type="button" className="ui-button ui-button--ghost" onClick={handleCopyDiagnostic}>
              <Copy size={16} aria-hidden="true" /> Copiar diagnóstico
            </button>
            {visibleReportStatus !== INCIDENT_REPORT_STATUS.SENT && (
              <button
                type="button"
                className="ui-button ui-button--ghost"
                onClick={() => {
                  setOpen(false);
                  onClose?.();
                }}
              >
                Cerrar
              </button>
            )}
          </div>

          <p className="incident-report__status" role="status" aria-live="polite" aria-atomic="true">
            {(services?.describeStatus || getStatusMessage)(visibleReportStatus, visibleReportCode, currentReceipt?.reportReference || '')}
          </p>
          {diagnosticCopyStatus && <p className="incident-report__copy-status" role="status" aria-live="polite">{diagnosticCopyStatus}</p>}

          <section className="incident-report__communication" aria-label="Preparar comunicación con soporte">
            <div className="incident-report__heading">
              <h3>Continuar comunicación</h3>
      <p>Prepara un resumen seguro y revísalo antes de copiarlo o abrir una aplicación. Copiarlo o abrir un destino no confirma que Lanzo lo haya recibido.</p>
            </div>

            <div className="incident-report__communication-actions">
              <button type="button" className="ui-button ui-button--ghost" onClick={handlePrepareCommunication}>
                <MessageCircle size={16} aria-hidden="true" /> Preparar mensaje
              </button>
              {currentPreparedCommunication && (
                <>
                  <button type="button" className="ui-button ui-button--ghost" onClick={handleCopyCommunication}>
                    <Copy size={16} aria-hidden="true" /> Copiar mensaje
                  </button>
                  <a
                    className="ui-button ui-button--ghost incident-report__external-link"
                    href={telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleTelegramClick}
                  >
                    <MessageCircle size={16} aria-hidden="true" /> Abrir canal oficial
                  </a>
                  <a
                    className="ui-button ui-button--ghost incident-report__external-link"
                    href={emailUrl}
                    onClick={handleEmailClick}
                  >
                    <Mail size={16} aria-hidden="true" /> {services?.inspectEmail ? 'Inspeccionar borrador local' : 'Abrir correo de soporte'}
                  </a>
                </>
              )}
            </div>

            {currentPreparedCommunication && (
              <>
                <label className="incident-report__description-label" htmlFor={communicationMessageId}>
                  Mensaje preparado para revisar y copiar
                </label>
                <textarea
                  id={communicationMessageId}
                  ref={messageField}
                  className="incident-report__message"
                  value={currentPreparedCommunication.message}
                  readOnly
                  rows={4}
                  spellCheck="false"
                  aria-describedby={communicationHelpId}
                />
                <p className="incident-report__hint" id={communicationHelpId}>
                  {currentPreparedCommunication.receiptConfirmed
                    ? 'Incluye el folio que confirmó el backend para esta incidencia.'
                    : 'Diagnóstico local sin folio: el backend no ha confirmado que Lanzo recibió un reporte.'}
                </p>
              </>
            )}

            <p className="incident-report__channel-note">
              @{TELEGRAM_USERNAME} es un canal público de referencia. Sus mensajes directos están {TELEGRAM_CHANNEL_DIRECT_MESSAGES_STATUS === 'unverified' ? 'no verificados' : 'verificados'}; no se ha verificado un chat privado de soporte. Copiar o abrir el canal no entrega el diagnóstico; para enviar el resumen a soporte, utiliza correo electrónico.
              {' '}El canal es una referencia pública, no un chat de recepción verificado.
            </p>
            <p className="incident-report__hint">Si Telegram no está disponible, puedes usar el correo de soporte: {supportEmail}. Revisa y envía el borrador manualmente.</p>
            {communicationFeedback && (
              <p
                className={communicationStatus === 'error' || communicationStatus === 'copy_failed'
                  ? 'incident-report__communication-status incident-report__communication-status--warning'
                  : 'incident-report__communication-status'}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {communicationFeedback}
              </p>
            )}
          </section>
        </form>
      )}
    </section>
  );
}
