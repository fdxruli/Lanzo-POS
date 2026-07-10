import { useState } from 'react';

const CATEGORY_OPTIONS = [
  { value: 'help', label: 'Ayuda general' },
  { value: 'license', label: 'Problema con licencia' },
  { value: 'sync', label: 'Problema de sincronización' },
  { value: 'cash', label: 'Caja / ventas' },
  { value: 'inventory', label: 'Inventario / productos' },
  { value: 'feature', label: 'Sugerir función' },
  { value: 'other', label: 'Otro' }
];

const PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Baja' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' }
];

export default function SupportTicketForm({
  submitting = false,
  error = null,
  onCancel,
  onSubmit
}) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('help');
  const [priority, setPriority] = useState('normal');
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const normalizedSubject = subject.trim();
    const normalizedMessage = message.trim();

    if (!normalizedSubject) {
      setLocalError('Escribe un asunto.');
      return;
    }

    if (normalizedMessage.length < 10) {
      setLocalError('Describe el problema con al menos 10 caracteres.');
      return;
    }

    if (normalizedMessage.length > 3000) {
      setLocalError('El mensaje no puede superar 3000 caracteres.');
      return;
    }

    setLocalError(null);
    const result = await onSubmit?.({
      subject: normalizedSubject,
      category,
      priority,
      message: normalizedMessage,
      metadata: { source: 'notification_center' }
    });

    if (result?.success === false) {
      setLocalError(result.message || result.code || 'No se pudo crear la solicitud.');
    }
  };

  return (
    <form className="support-ticket-form" onSubmit={handleSubmit}>
      <div className="support-ticket-form__header">
        <h3>Nueva solicitud</h3>
        <p>Cuéntanos qué ocurre y te responderemos desde Lanzo Nube.</p>
      </div>

      {(localError || error) && (
        <p className="support-ticket-form__error" role="alert">
          {localError || error}
        </p>
      )}

      <label>
        <span>Asunto</span>
        <input
          type="text"
          value={subject}
          maxLength={180}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Ej. No puedo sincronizar ventas"
          required
        />
      </label>

      <div className="support-ticket-form__grid">
        <label>
          <span>Categoría</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Prioridad</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label>
        <span>Descripción</span>
        <textarea
          value={message}
          minLength={10}
          maxLength={3000}
          rows={7}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Incluye pantalla, acción que intentaste y mensaje de error si aparece."
          required
        />
      </label>

      <div className="support-ticket-form__footer">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
        <button type="submit" className="support-ticket-primary" disabled={submitting}>
          {submitting ? 'Enviando...' : 'Crear solicitud'}
        </button>
      </div>
    </form>
  );
}
