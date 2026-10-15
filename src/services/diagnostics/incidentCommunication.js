import { INCIDENT_REPORT_STATUS, formatIncidentChannelSummary } from './incidentReporter';

const REPORT_REFERENCE_PATTERN = /^IR-[A-F0-9]{16}$/;
export const MAX_INCIDENT_COMMUNICATION_CODEPOINTS = 420;

const isConfirmedReceiptForIncident = ({
  incident,
  reportStatus,
  reportReference,
  reportIncidentId,
  contextIsCurrent
} = {}) => (
  reportStatus === INCIDENT_REPORT_STATUS.SENT
  && contextIsCurrent === true
  && typeof incident?.incident_id === 'string'
  && reportIncidentId === incident.incident_id
  && typeof reportReference === 'string'
  && REPORT_REFERENCE_PATTERN.test(reportReference)
);

/**
 * Produces the only text allowed in the incident Telegram/email summary.
 * User-authored descriptions and arbitrary incident properties are ignored.
 */
export const buildIncidentCommunicationMessage = (input = {}) => {
  const {
    incident,
    reportStatus = INCIDENT_REPORT_STATUS.NOT_STARTED,
    reportReference,
    reportIncidentId,
    contextIsCurrent = false
  } = input;
  const receiptConfirmed = isConfirmedReceiptForIncident({
    incident,
    reportStatus,
    reportReference,
    reportIncidentId,
    contextIsCurrent
  });
  const summary = formatIncidentChannelSummary({
    incident,
    reportReference: receiptConfirmed ? reportReference : undefined,
    receiptConfirmed
  });
  const request = receiptConfirmed
    ? 'Solicito seguimiento de esta incidencia.'
    : 'Solicito orientación. Este diagnóstico local no es un reporte registrado.';
  const message = `Hola, soporte de Lanzo POS.\n${summary}\n${request}`;

  return Array.from(message).slice(0, MAX_INCIDENT_COMMUNICATION_CODEPOINTS).join('');
};

export const hasConfirmedIncidentReceipt = isConfirmedReceiptForIncident;
