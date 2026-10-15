import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import {
  formatIncidentDiagnostic,
  INCIDENT_REPORT_STATUS,
  submitIncidentReport
} from '../../services/diagnostics/incidentReporter';
import { copyTextToClipboard } from '../../services/support/supportContact';
import './IncidentReportForm.css';

const getOnlineState = () => {
  try {
    return globalThis.navigator?.onLine !== false;
  } catch {
    return true;
  }
};

const getStatusMessage = (status, code, reference) => {
  if (status === INCIDENT_REPORT_STATUS.SENDING) return 'Enviando el diagnóstico. Espera la confirmación del servidor.';
  if (status === INCIDENT_REPORT_STATUS.SENT) return `Lanzo recibió el reporte. Folio: ${reference}`;
  if (status === INCIDENT_REPORT_STATUS.OFFLINE) return 'Necesitas conexión a internet para enviar el reporte. Puedes copiar el diagnóstico y compartirlo cuando tengas conexión.';
  if (status === INCIDENT_REPORT_STATUS.UNAVAILABLE) return 'El servicio para recibir reportes todavía no está disponible. Puedes copiar el diagnóstico o contactar soporte por correo.';
  if (status === INCIDENT_REPORT_STATUS.FAILED && code === 'INCIDENT_REPORT_RATE_LIMITED') return 'Se alcanzó el límite temporal de reportes. Copia el diagnóstico e inténtalo más tarde.';
  if (status === INCIDENT_REPORT_STATUS.FAILED && code === 'INCIDENT_REPORT_AUTHORIZATION_FAILED') return 'La sesión o el dispositivo no pudo autorizar el envío. Vuelve a iniciar sesión y, si continúa, comparte el diagnóstico por correo.';
  if (status === INCIDENT_REPORT_STATUS.FAILED && code === 'INCIDENT_REPORT_CONTEXT_CHANGED') return 'El negocio o la sesión cambió. Abre de nuevo el reporte desde el contexto actual antes de enviarlo.';
  if (status === INCIDENT_REPORT_STATUS.FAILED) return 'No se confirmó la recepción del reporte. Puedes copiar el diagnóstico e intentarlo de nuevo.';
  return 'El diagnóstico se enviará únicamente después de tu confirmación.';
};

export default function IncidentReportForm({
  incident,
  isContextCurrent = null,
  openOnMount = false,
  onClose = null
}) {
  const descriptionId = `incident-report-description-${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(openOnMount);
  const [status, setStatus] = useState(() => (openOnMount
    ? (getOnlineState() ? INCIDENT_REPORT_STATUS.READY : INCIDENT_REPORT_STATUS.OFFLINE)
    : INCIDENT_REPORT_STATUS.NOT_STARTED));
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [reportReference, setReportReference] = useState('');
  const [statusCode, setStatusCode] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const openingContextIsCurrent = useRef(null);

  const handleOpen = useCallback(async () => {
    if (typeof isContextCurrent === 'function') {
      openingContextIsCurrent.current = isContextCurrent;
    } else {
      try {
        const { createRecoveryContextGuard } = await import('../../services/diagnostics/recoveryContext');
        openingContextIsCurrent.current = createRecoveryContextGuard();
      } catch {
        openingContextIsCurrent.current = () => false;
      }
    }
    setConsent(false);
    setReportReference('');
    setStatusCode('');
    setCopyMessage('');
    setStatus(getOnlineState() ? INCIDENT_REPORT_STATUS.READY : INCIDENT_REPORT_STATUS.OFFLINE);
    setOpen(true);
  }, [isContextCurrent]);

  useEffect(() => {
    if (openOnMount) void handleOpen();
  }, [handleOpen, openOnMount]);

  if (!incident) return null;

  const handleCopy = async () => {
    setCopyMessage('');
    let message;
    try {
      message = formatIncidentDiagnostic(incident);
    } catch {
      setCopyMessage('No se pudo preparar el diagnóstico para copiar.');
      return;
    }
    const copied = await copyTextToClipboard(message);
    setCopyMessage(copied === true
      ? 'Diagnóstico copiado. Revisa su contenido antes de compartirlo.'
      : 'No se pudo copiar. Intenta desde un navegador compatible.');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (consent !== true || status === INCIDENT_REPORT_STATUS.SENDING || status === INCIDENT_REPORT_STATUS.SENT) return;
    setStatus(INCIDENT_REPORT_STATUS.SENDING);
    setStatusCode('');
    let result;
    try {
      const { useAppStore } = await import('../../store/useAppStore');
      const currentLicenseDetails = useAppStore.getState()?.licenseDetails || {};
      result = await submitIncidentReport(incident, {
        consent,
        userDescription: description,
        licenseDetails: currentLicenseDetails,
        isContextCurrent: isContextCurrent || openingContextIsCurrent.current
      });
    } catch {
      result = { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_DELIVERY_FAILED' };
    }
    setStatus(result.status || INCIDENT_REPORT_STATUS.FAILED);
    setStatusCode(result.code || '');
    setReportReference(result.status === INCIDENT_REPORT_STATUS.SENT ? result.reportReference : '');
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
            <h3>Enviar diagnóstico técnico</h3>
            <p>El reporte ayuda a identificar el problema. El envío necesita internet y tu confirmación.</p>
          </div>

          <dl className="incident-report__code">
            <div><dt>Código técnico</dt><dd>{incident.safe_code}</dd></div>
          </dl>

          <div className="incident-report__shared" aria-label="Información técnica que se compartirá">
            <p>Si confirmas, se compartirán:</p>
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
            aria-describedby="incident-report-description-help"
          />
          <p className="incident-report__hint" id="incident-report-description-help">
            {description.length}/500 caracteres. Este texto libre no se sanitiza automáticamente; revísalo antes de enviarlo.
          </p>

          <label className="incident-report__consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>Confirmo que quiero compartir el diagnóstico y, si escribí una descripción, también ese texto.</span>
          </label>

          <div className="incident-report__actions">
            <button
              type="submit"
              className="ui-button ui-button--primary"
              disabled={!consent || status === INCIDENT_REPORT_STATUS.SENDING || status === INCIDENT_REPORT_STATUS.SENT}
            >
              {status === INCIDENT_REPORT_STATUS.SENT
                ? <Check size={16} aria-hidden="true" />
                : <Send size={16} aria-hidden="true" />}
              {status === INCIDENT_REPORT_STATUS.SENDING ? 'Enviando…' : status === INCIDENT_REPORT_STATUS.SENT ? 'Recibido' : 'Enviar reporte'}
            </button>
            <button type="button" className="ui-button ui-button--ghost" onClick={handleCopy}>
              <Copy size={16} aria-hidden="true" /> Copiar diagnóstico
            </button>
            {status !== INCIDENT_REPORT_STATUS.SENT && (
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

          <p className="incident-report__status" role="status" aria-live="polite">
            {getStatusMessage(status, statusCode, reportReference)}
          </p>
          {copyMessage && <p className="incident-report__copy-status" role="status">{copyMessage}</p>}
        </form>
      )}
    </section>
  );
}
