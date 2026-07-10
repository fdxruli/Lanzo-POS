const SENDER_LABELS = {
  user: 'Tu mensaje',
  support: 'Soporte Lanzo',
  system: 'Sistema'
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

export default function SupportTicketMessage({ message }) {
  const senderType = message?.sender_type || 'user';
  const senderLabel = SENDER_LABELS[senderType] || SENDER_LABELS.user;
  const createdAt = message?.created_at || '';

  return (
    <article className={`support-ticket-message support-ticket-message--${senderType}`}>
      <div className="support-ticket-message__meta">
        <strong>{senderLabel}</strong>
        {createdAt && <time dateTime={createdAt}>{formatDate(createdAt)}</time>}
      </div>
      <p>{message?.message || ''}</p>
    </article>
  );
}
