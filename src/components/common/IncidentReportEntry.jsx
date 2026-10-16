import { Suspense, lazy, useState } from 'react';
import { Send } from 'lucide-react';

const IncidentReportForm = lazy(() => import('./IncidentReportForm'));

export default function IncidentReportEntry({ incident, isContextCurrent = null, services = null }) {
  const [open, setOpen] = useState(false);

  if (!incident) return null;

  if (open) {
    return (
      <Suspense fallback={<p role="status">Preparando el formulario de reporte…</p>}>
        <IncidentReportForm
          services={services}
          incident={incident}
          isContextCurrent={isContextCurrent}
          openOnMount
          onClose={() => setOpen(false)}
        />
      </Suspense>
    );
  }

  return (
    <button
      type="button"
      className="ui-button ui-button--ghost incident-report__open"
      onClick={() => setOpen(true)}
    >
      <Send size={16} aria-hidden="true" />
      Reportar problema
    </button>
  );
}
