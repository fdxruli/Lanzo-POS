import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function EcommerceSiteBuilderStatus({ hasLocalChanges, hasUnpublishedChanges, conflict }) {
  return (
    <div className="ecom-builder-status" aria-live="polite">
      {hasLocalChanges ? <span className="is-warning"><AlertTriangle size={16} />Cambios sin guardar</span> : null}
      {hasUnpublishedChanges ? <span className="is-warning"><AlertTriangle size={16} />Borrador sin publicar</span> : null}
      {!hasLocalChanges && !hasUnpublishedChanges ? <span><CheckCircle2 size={16} />Borrador y sitio publicado están al día</span> : null}
      {conflict ? <strong role="alert">El borrador cambió en otro dispositivo.</strong> : null}
    </div>
  );
}
