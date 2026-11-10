import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function EcommerceSiteBuilderStatus({ hasLocalChanges, hasUnpublishedChanges, conflict }) {
  return (
    <div className="ecom-builder-status" aria-live="polite">
      {conflict && <strong role="alert"><AlertTriangle size={16} />Conflicto: el borrador cambió en otro dispositivo.</strong>}
      {hasLocalChanges && <span className="is-warning"><AlertTriangle size={16} />Cambios sin guardar</span>}
      {hasUnpublishedChanges && <span className="is-warning"><AlertTriangle size={16} />Borrador sin publicar</span>}
      {!hasLocalChanges && !hasUnpublishedChanges && !conflict && <span><CheckCircle2 size={16} />Sin cambios pendientes: borrador y diseño publicado sincronizados</span>}
    </div>
  );
}
