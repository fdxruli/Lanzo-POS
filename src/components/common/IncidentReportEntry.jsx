import { useId } from 'react';
import { Send } from 'lucide-react';

export default function IncidentReportEntry({
  incident,
  open = false,
  controlsId,
  buttonRef = null,
  onToggle = null
}) {
  const generatedControlsId = useId().replace(/:/g, '');
  if (!incident) return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      className="ui-button ui-button--ghost incident-report__open"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId || `incident-report-region-${generatedControlsId}`}
    >
      <Send size={16} aria-hidden="true" />
      {open ? 'Cerrar reporte' : 'Reportar problema'}
    </button>
  );
}
