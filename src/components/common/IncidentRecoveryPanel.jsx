import { useId, useState } from 'react';
import {
  CheckCheck,
  Copy,
  Info,
  Mail,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff
} from 'lucide-react';
import './ErrorBoundary.css';
import IncidentReportEntry from './IncidentReportEntry';

const RECOVERY_STATUS_LABELS = Object.freeze({
  detected: 'Problema identificado',
  preserved: 'Estado conservado',
  action_required: 'Requiere una acción',
  recovering: 'Recuperación en curso',
  verified: 'Sección disponible',
  failed: 'El reintento no funcionó',
  blocked: 'Acción bloqueada por seguridad'
});

const getSeverityClass = (severity) => {
  if (severity === 'critical_blocker') return 'critical';
  if (severity === 'recoverable') return 'recoverable';
  return 'section';
};

export default function IncidentRecoveryPanel({
  severity = 'section_failure',
  title,
  description,
  metadata,
  recoveryNotice = '',
  operationDetails = null,
  primaryAction = null,
  secondaryActions = [],
  copied = false,
  onCopy = null,
  copyError = '',
  incidentRecord = null,
  reportServices = null,
  recoveryControls = null,
  isContextCurrent = null,
  contactNote = '',
  onDismiss = null,
  titleRef = null
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId().replace(/:/g, '');
  const isCritical = severity === 'critical_blocker';
  const Icon = isCritical ? ShieldAlert : Info;

  return (
    <section
      className={'incident-recovery incident-recovery--' + getSeverityClass(severity)}
      role={isCritical ? 'alertdialog' : 'status'}
      aria-modal={isCritical ? 'true' : undefined}
      aria-labelledby={'incident-title-' + detailsId}
      tabIndex={isCritical ? -1 : undefined}
    >
      <div className="incident-recovery__layout">
        <div className="incident-recovery__header">
          <span className="incident-recovery__icon" aria-hidden="true">
            <Icon size={24} strokeWidth={1.8} />
          </span>
          <div className="incident-recovery__copy">
            <p className="incident-recovery__eyebrow">Centro de recuperación</p>
            <h2 id={'incident-title-' + detailsId} ref={titleRef} tabIndex="-1">{title}</h2>
            <p className="incident-recovery__description">{description}</p>
          </div>
        </div>

        {recoveryControls}

        {operationDetails && (
          <section className="incident-recovery__operation" aria-label="Operación afectada">
            <h3>{operationDetails.title || 'Qué necesita revisión'}</h3>
            <p>{operationDetails.description}</p>
            {operationDetails.blockedActions?.length > 0 && (
              <div>
                <h4>Acciones temporalmente bloqueadas</h4>
                <ul>
                  {operationDetails.blockedActions.map((action) => <li key={action}>{action}</li>)}
                </ul>
              </div>
            )}
            {operationDetails.verification && (
              <p><strong>Verificación necesaria:</strong> {operationDetails.verification}</p>
            )}
          </section>
        )}

        {recoveryNotice && (
          <p className="incident-recovery__notice" role="status" aria-live="polite">
            {recoveryNotice}
          </p>
        )}

        {copyError && (
          <p className="incident-recovery__notice incident-recovery__notice--warning" role="status">
            {copyError}
          </p>
        )}

        <div className="incident-recovery__actions">
          {primaryAction && (
            <button
              type="button"
              className="ui-button ui-button--primary incident-recovery__primary"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              aria-describedby={primaryAction.disabledReason ? 'incident-disabled-' + detailsId : undefined}
            >
              {primaryAction.busy
                ? <RefreshCw className="incident-recovery__spin" size={18} aria-hidden="true" />
                : primaryAction.icon || null}
              {primaryAction.label}
            </button>
          )}

          {primaryAction?.disabledReason && (
            <span className="incident-recovery__disabled-reason" id={'incident-disabled-' + detailsId}>
              {primaryAction.disabledReason}
            </span>
          )}

          {secondaryActions.map((action) => (
            <button
              type="button"
              key={action.label}
              className="ui-button ui-button--ghost incident-recovery__secondary"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.icon || null}
              {action.label}
            </button>
          ))}

          {onCopy && (
            <button
              type="button"
              className="ui-button ui-button--ghost incident-recovery__secondary"
              onClick={onCopy}
            >
              {copied
                ? <CheckCheck size={17} aria-hidden="true" />
                : <Copy size={17} aria-hidden="true" />}
              {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
            </button>
          )}
        </div>

        <IncidentReportEntry services={reportServices} incident={incidentRecord} isContextCurrent={isContextCurrent} />

        {contactNote && (
          <p className="incident-recovery__contact-note">
            <Mail size={15} aria-hidden="true" />
            {contactNote}
          </p>
        )}

        {metadata && (
          <div className="incident-recovery__details">
            <button
              type="button"
              className="incident-recovery__details-toggle"
              aria-expanded={detailsOpen}
              aria-controls={'incident-details-' + detailsId}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <span>{detailsOpen ? 'Ocultar detalles del problema' : 'Detalles del problema'}</span>
              <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
            </button>
            <div
              id={'incident-details-' + detailsId}
              className="incident-recovery__details-content"
              hidden={!detailsOpen}
            >
              <dl>
                <div><dt>Código técnico</dt><dd>{metadata.code}</dd></div>
                <div><dt>Categoría</dt><dd>{metadata.categoryLabel}</dd></div>
                <div><dt>Sección</dt><dd>{metadata.section}</dd></div>
                <div><dt>Fecha y hora</dt><dd>{metadata.formattedTimestamp || metadata.timestamp}</dd></div>
                <div><dt>Versión</dt><dd>{metadata.appVersion}</dd></div>
                <div>
                  <dt>Conexión</dt>
                  <dd>
                    {metadata.online
                      ? <><Wifi size={14} aria-hidden="true" /> En línea</>
                      : <><WifiOff size={14} aria-hidden="true" /> Sin conexión</>}
                  </dd>
                </div>
                <div>
                  <dt>Estado de recuperación</dt>
                  <dd>{RECOVERY_STATUS_LABELS[metadata.recoveryStatus] || 'Requiere una acción'}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        {onDismiss && (
          <button
            type="button"
            className="incident-recovery__dismiss"
            onClick={onDismiss}
            aria-label="Cerrar aviso de incidencia"
          >
            Cerrar
          </button>
        )}
      </div>
    </section>
  );
}
