import { useEffect, useId, useRef, useState } from 'react';
import { Lightbulb, Mail, Send, X } from 'lucide-react';
import { useConfirmDiscard } from '../../hooks/useConfirmDiscard';
import './ContactModal.css';

const createInitialData = fields => fields.reduce((data, field) => {
  data[field.id] = '';
  return data;
}, {});

export default function ContactModal({
  show,
  onClose,
  onSubmit,
  title,
  fields,
  submitLabel = 'Generar correo',
  description
}) {
  const titleId = useId();
  const descriptionId = useId();
  const firstFieldRef = useRef(null);
  const [formData, setFormData] = useState(() => createInitialData(fields));

  const isValid = fields.every(field => (
    field.required === false || (formData[field.id] || '').trim().length > 0
  ));
  const hasChanges = Object.values(formData).some(value => value.trim().length > 0);

  const requestClose = useConfirmDiscard({
    hasChanges,
    onClose,
    message: 'Hay información capturada que todavía no se ha enviado. ¿Quieres cancelar la operación?'
  });

  useEffect(() => {
    if (!show) return undefined;

    firstFieldRef.current?.focus();

    const handleEscape = (event) => {
      if (event.key === 'Escape') requestClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [requestClose, show]);

  if (!show) return null;

  const handleChange = ({ target: { name, value } }) => {
    setFormData(current => ({ ...current, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isValid) return;
    onSubmit(formData);
    onClose();
  };

  return (
    <div
      className="contact-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <dialog
        open
        className="contact-modal"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="contact-modal__header">
          <div className="contact-modal__header-icon" aria-hidden="true">
            <Mail size={22} />
          </div>
          <div className="contact-modal__heading">
            <p>Contacto con soporte</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="contact-modal__close"
            onClick={requestClose}
            aria-label="Cerrar modal"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="contact-modal__body">
          {description && (
            <p id={descriptionId} className="contact-modal__intro">{description}</p>
          )}

          <form onSubmit={handleSubmit}>
            {fields.map((field, index) => {
              const fieldId = `contact-${field.id}`;
              const hintId = field.hint ? `${fieldId}-hint` : undefined;

              return (
                <div className="contact-modal__field" key={field.id}>
                  <label htmlFor={fieldId}>
                    <span>{field.label}</span>
                    {field.required !== false && <strong>Requerido</strong>}
                  </label>

                  {field.type === 'textarea' ? (
                    <textarea
                      id={fieldId}
                      name={field.id}
                      value={formData[field.id] || ''}
                      onChange={handleChange}
                      required={field.required !== false}
                      ref={index === 0 ? firstFieldRef : undefined}
                      placeholder={field.placeholder || ''}
                      rows={field.rows || 4}
                      aria-describedby={hintId}
                    />
                  ) : (
                    <input
                      type={field.type || 'text'}
                      id={fieldId}
                      name={field.id}
                      value={formData[field.id] || ''}
                      onChange={handleChange}
                      required={field.required !== false}
                      ref={index === 0 ? firstFieldRef : undefined}
                      placeholder={field.placeholder || ''}
                      aria-describedby={hintId}
                    />
                  )}

                  {field.hint && <small id={hintId}>{field.hint}</small>}
                </div>
              );
            })}

            <div className="contact-modal__tip">
              <Lightbulb size={17} aria-hidden="true" />
              <p>Se abrirá tu cliente de correo con el mensaje redactado para que puedas revisarlo y enviarlo.</p>
            </div>

            <div className="contact-modal__actions">
              <button type="button" className="contact-modal__button contact-modal__button--secondary" onClick={requestClose}>
                Cancelar
              </button>
              <button
                type="submit"
                className="contact-modal__button contact-modal__button--primary"
                disabled={!isValid}
              >
                <Send size={18} aria-hidden="true" />
                {submitLabel}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}
