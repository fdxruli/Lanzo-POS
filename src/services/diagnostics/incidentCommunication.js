import { INCIDENT_REPORT_STATUS, formatIncidentChannelSummary } from './incidentReporter';
import { getSafeIncidentMetadata } from './incidentDiagnostics';

const REPORT_REFERENCE_PATTERN = /^IR-[A-F0-9]{16}$/;
export const MAX_INCIDENT_COMMUNICATION_CODEPOINTS = 420;
export const MAX_INCIDENT_SUPPORT_MESSAGE_CODEPOINTS = 1200;
export const MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS = 500;

export const getSafeIncidentSupportDetails = (incident = {}) => {
  const hasSafeRoute = typeof incident?.safe_route === 'string';
  const metadata = getSafeIncidentMetadata({
    code: incident?.safe_code,
    category: incident?.category,
    severity: incident?.severity
  }, {
    ...(hasSafeRoute ? { pathname: incident.safe_route } : { section: 'unknown' }),
    appVersion: incident?.app_version
  });
  const connection = incident?.network_status === 'online'
    ? 'En línea'
    : incident?.network_status === 'offline' ? 'Sin conexión' : '';

  return Object.freeze({
    code: metadata.code,
    section: metadata.section !== 'No determinada' ? metadata.section : '',
    category: metadata.categoryLabel,
    appVersion: metadata.appVersion !== 'No disponible' ? metadata.appVersion : '',
    connection
  });
};

/**
 * Message builder for the current manual contact flow. It accepts only the
 * incident allowlist and includes user-authored text only after an explicit
 * opt-in. The technical reporter's receipt-aware contract remains separate.
 */
export const buildIncidentSupportMessage = ({ incident, description = '', includeDescription = false } = {}) => {
  const safeDetails = getSafeIncidentSupportDetails(incident);
  const details = [
    `Código del problema: ${safeDetails.code}`,
    ...(safeDetails.section ? [`Sección: ${safeDetails.section}`] : []),
    `Categoría: ${safeDetails.category}`,
    ...(safeDetails.appVersion ? [`Versión de Lanzo: ${safeDetails.appVersion}`] : []),
    ...(safeDetails.connection ? [`Conexión: ${safeDetails.connection}`] : [])
  ];
  const userDescription = includeDescription === true && typeof description === 'string'
    ? Array.from(description).slice(0, MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS).join('')
    : '';
  const message = [
    'Hola, soporte de Lanzo POS.',
    '',
    'Necesito ayuda con un problema en la aplicación.',
    '',
    ...details,
    ...(userDescription ? ['', 'Descripción:', userDescription] : []),
    '',
    'Agradecería su ayuda para revisar lo ocurrido.'
  ].join('\n');

  return Array.from(message).slice(0, MAX_INCIDENT_SUPPORT_MESSAGE_CODEPOINTS).join('');
};

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
