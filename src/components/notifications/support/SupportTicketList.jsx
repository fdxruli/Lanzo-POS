import { Plus, RefreshCw } from 'lucide-react';
import SupportTicketStatusBadge from './SupportTicketStatusBadge';

const CATEGORY_LABELS = {
  help: 'Ayuda general',
  license: 'Licencia',
  sync: 'Sincronización',
  cash: 'Caja / ventas',
  inventory: 'Inventario',
  feature: 'Sugerencia',
  bug: 'Error',
  billing: 'Facturación',
  other: 'Otro'
};

const PRIORITY_LABELS = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente'
};

const formatDate = (value) => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function SupportTicketList({
  tickets = [],
  loading = false,
  error = null,
  onRetry,
  onNewTicket,
  onOpenTicket
}) {
  return (
    <section className="support-ticket-panel" aria-labelledby="support-ticket-panel-title">
      <div className="support-ticket-toolbar">
        <div>
          <h3 id="support-ticket-panel-title">Soporte Lanzo Nube</h3>
          <p>Solicitudes y respuestas desde el sistema.</p>
        </div>
        <button type="button" className="support-ticket-primary" onClick={onNewTicket}>
          <Plus size={16} aria-hidden="true" />
          Nueva solicitud
        </button>
      </div>

      {loading && (
        <div className="support-ticket-state" role="status" aria-live="polite">
          Cargando soporte...
        </div>
      )}

      {!loading && error && (
        <div className="support-ticket-state support-ticket-state--error" role="alert">
          <p>{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              Reintentar
            </button>
          )}
        </div>
      )}

      {!loading && !error && tickets.length === 0 && (
        <div className="support-ticket-empty">
          <h4>Aún no tienes solicitudes de soporte.</h4>
          <p>Crea una solicitud y te responderemos desde Lanzo Nube.</p>
        </div>
      )}

      {!loading && !error && tickets.length > 0 && (
        <div className="support-ticket-list" role="list" aria-label="Solicitudes de soporte">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              className="support-ticket-row"
              onClick={() => onOpenTicket?.(ticket.id)}
            >
              <span className="support-ticket-row__main">
                <strong>{ticket.subject}</strong>
                <span>{ticket.last_message_preview || 'Sin mensajes recientes'}</span>
                {ticket.updated_at && <time dateTime={ticket.updated_at}>{formatDate(ticket.updated_at)}</time>}
              </span>
              <span className="support-ticket-row__meta">
                <SupportTicketStatusBadge status={ticket.status} />
                <small>
                  {CATEGORY_LABELS[ticket.category] || CATEGORY_LABELS.help} - {PRIORITY_LABELS[ticket.priority] || PRIORITY_LABELS.normal}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
