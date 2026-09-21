import { memo } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

const LIMITATION_ICONS = {
  warning: AlertTriangle,
  info: Info
};

const DiagnosticLimitation = memo(({ limitation }) => {
  const Icon = LIMITATION_ICONS[limitation.tone] || Info;

  return (
    <div className={`opdiag-limitation opdiag-limitation--${limitation.tone}`} role="note">
      <Icon className="opdiag-limitation-icon" size={17} aria-hidden="true" />
      <div>
        <strong>{limitation.title}</strong>
        <p>{limitation.message}</p>
      </div>
    </div>
  );
});

DiagnosticLimitation.displayName = 'DiagnosticLimitation';

const DiagnosticLimitations = memo(({ limitations = [], reportWarning = null }) => {
  const normalizedReportWarning = typeof reportWarning === 'string' && reportWarning.trim()
    ? {
      id: 'report-source-warning',
      tone: 'warning',
      title: 'Fuente cloud',
      message: reportWarning.trim()
    }
    : null;
  const items = [normalizedReportWarning, ...(Array.isArray(limitations) ? limitations : [])].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <section className="opdiag-limitations" aria-label="Limitaciones del diagnóstico">
      <div className="opdiag-limitations-heading">
        <div>
          <h3>Limitaciones y fuente de datos</h3>
          <span>Consulta estos avisos para interpretar las métricas.</span>
        </div>
      </div>
      <div className="opdiag-limitations-list">
        {items.map((limitation) => <DiagnosticLimitation key={limitation.id} limitation={limitation} />)}
      </div>
    </section>
  );
});

DiagnosticLimitations.displayName = 'DiagnosticLimitations';

export default DiagnosticLimitations;
