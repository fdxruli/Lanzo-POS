const STATUS_LABELS = {
  open: 'Abierto',
  waiting_support: 'Esperando soporte',
  waiting_user: 'Esperando tu respuesta',
  resolved: 'Resuelto',
  closed: 'Cerrado'
};

export default function SupportTicketStatusBadge({ status = 'open' }) {
  const normalizedStatus = STATUS_LABELS[status] ? status : 'open';

  return (
    <span className={`support-ticket-status support-ticket-status--${normalizedStatus}`}>
      {STATUS_LABELS[normalizedStatus]}
    </span>
  );
}
