import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import SupportTicketMessage from './SupportTicketMessage';
import SupportTicketStatusBadge from './SupportTicketStatusBadge';

export default function SupportTicketThread({
  ticket,
  messages = [],
  loading = false,
  error = null,
  submitting = false,
  onBack,
  onRetry,
  onReply,
  onCloseTicket
}) {
  const [reply, setReply] = useState('');
  const [localError, setLocalError] = useState(null);
  const isClosed = ticket?.status === 'closed';
  const isWaitingUser = ticket?.status === 'waiting_user';

  const handleReplySubmit = async (event) => {
    event.preventDefault();
    const normalizedReply = reply.trim();

    if (normalizedReply.length < 10) {
      setLocalError('Escribe una respuesta de al menos 10 caracteres.');
      return;
    }

    if (normalizedReply.length > 3000) {
      setLocalError('La respuesta no puede superar 3000 caracteres.');
      return;
    }

    setLocalError(null);
    const result = await onReply?.({ ticketId: ticket?.id, message: normalizedReply });

    if (result?.success !== false) {
      setReply('');
    } else {
      setLocalError('No pudimos enviar la respuesta. Intenta de nuevo.');
    }
  };

  if (loading) {
    return (
      <div className="support-ticket-state" role="status" aria-live="polite">
        Cargando soporte...
      </div>
    );
  }

  if (error) {
    return (
      <div className="support-ticket-state support-ticket-state--error" role="alert">
        <p>{error}</p>
        <div className="support-ticket-state__actions">
          <button type="button" onClick={onBack}>Volver</button>
          {onRetry && <button type="button" onClick={() => onRetry(ticket?.id)}>Reintentar</button>}
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="support-ticket-state">
        No se encontró la solicitud.
      </div>
    );
  }

  return (
    <section className="support-ticket-thread" aria-labelledby="support-ticket-thread-title">
      <div className="support-ticket-thread__header">
        <button type="button" className="support-ticket-icon-button" onClick={onBack} aria-label="Volver a solicitudes">
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div>
          <h3 id="support-ticket-thread-title">{ticket.subject}</h3>
          <SupportTicketStatusBadge status={ticket.status} />
        </div>
        {!isClosed && (
          <button
            type="button"
            className="support-ticket-close"
            onClick={() => onCloseTicket?.(ticket.id)}
            disabled={submitting}
          >
            Cerrar
          </button>
        )}
      </div>

      {isWaitingUser && (
        <div className="support-ticket-notice support-ticket-notice--waiting">
          Soporte respondió. Revisa el mensaje y responde si necesitas continuar.
        </div>
      )}

      <div className="support-ticket-thread__messages" aria-label="Conversación de soporte">
        {messages.map((message) => (
          <SupportTicketMessage key={message.id} message={message} />
        ))}
      </div>

      {(localError || error) && (
        <p className="support-ticket-form__error" role="alert">
          {localError || error}
        </p>
      )}

      {isClosed ? (
        <div className="support-ticket-closed">
          <Lock size={16} aria-hidden="true" />
          Este ticket está cerrado. Crea una nueva solicitud si necesitas más ayuda.
        </div>
      ) : (
        <form className="support-ticket-reply" onSubmit={handleReplySubmit}>
          <label>
            <span>Responder</span>
            <textarea
              value={reply}
              minLength={10}
              maxLength={3000}
              rows={4}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Agrega detalles o responde al equipo de soporte."
              disabled={submitting}
              required
            />
          </label>
          <button type="submit" className="support-ticket-primary" disabled={submitting}>
            {submitting ? 'Enviando...' : 'Enviar respuesta'}
          </button>
        </form>
      )}
    </section>
  );
}
