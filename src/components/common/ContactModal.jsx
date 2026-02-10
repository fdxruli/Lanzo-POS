import React, { useState, useEffect } from 'react';
import { Mail, Send } from 'lucide-react';
import './ContactModal.css';

/**
 * Modal de contacto mejorado que genera correos electrónicos
 * @param {boolean} show - Controla la visibilidad del modal
 * @param {function} onClose - Callback al cerrar
 * @param {function} onSubmit - Callback con los datos del formulario
 * @param {string} title - Título del modal
 * @param {Array} fields - Campos del formulario
 * @param {string} submitLabel - Texto del botón de envío
 * @param {string} description - Descripción opcional bajo el título
 */
export default function ContactModal({
  show,
  onClose,
  onSubmit,
  title,
  fields,
  submitLabel = "Generar Correo",
  description
}) {
  const [formData, setFormData] = useState({});
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    if (show) {
      const initialData = fields.reduce((acc, field) => {
        acc[field.id] = '';
        return acc;
      }, {});
      setFormData(initialData);
      setIsValid(false);
    }
  }, [show, fields]);

  // Validación en tiempo real
  useEffect(() => {
    const allFieldsFilled = fields.every(field => {
      const value = formData[field.id] || '';
      return value.trim().length > 0;
    });
    setIsValid(allFieldsFilled);
  }, [formData, fields]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid) return;
    onSubmit(formData);
    onClose();
  };

  // Cerrar con ESC
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && show) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [show, onClose]);

  if (!show) {
    return null;
  }

  return (
    <div
      className="modal"
      style={{ display: 'flex', zIndex: 8000 }}
      onClick={(e) => e.target.className === 'modal' && onClose()}
    >
      <div className="modal-content contact-modal">

        {/* Icono de correo */}
        <div style={{
          textAlign: 'center',
          marginBottom: '1rem',
          marginTop: '-10px'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            margin: '0 auto',
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 16px rgba(59, 130, 246, 0.3)'
          }}>
            <Mail size={28} color="white" />
          </div>
        </div>

        <h2 className="modal-title">{title}</h2>

        {description && (
          <p style={{
            textAlign: 'center',
            color: 'var(--text-light)',
            fontSize: '0.95rem',
            marginBottom: '1.5rem',
            lineHeight: '1.5'
          }}>
            {description}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          {fields.map((field, index) => (
            <div className="form-group" key={field.id}>
              <label className="form-label" htmlFor={field.id}>
                {field.label}
                {field.required !== false && <span style={{ color: 'var(--error-color)' }}> *</span>}
              </label>

              {field.type === 'textarea' ? (
                <textarea
                  className="form-textarea"
                  id={field.id}
                  name={field.id}
                  value={formData[field.id] || ''}
                  onChange={handleChange}
                  required={field.required !== false}
                  autoFocus={index === 0}
                  placeholder={field.placeholder || ''}
                  rows={field.rows || 4}
                />
              ) : (
                <input
                  className="form-input"
                  type={field.type || 'text'}
                  id={field.id}
                  name={field.id}
                  value={formData[field.id] || ''}
                  onChange={handleChange}
                  required={field.required !== false}
                  autoFocus={index === 0}
                  placeholder={field.placeholder || ''}
                />
              )}

              {field.hint && (
                <small style={{
                  display: 'block',
                  marginTop: '4px',
                  color: 'var(--text-light)',
                  fontSize: '0.85rem'
                }}>
                  {field.hint}
                </small>
              )}
            </div>
          ))}

          <button
            type="submit"
            className="btn btn-save contact-submit-btn"
            disabled={!isValid}
            style={{
              opacity: isValid ? 1 : 0.6,
              cursor: isValid ? 'pointer' : 'not-allowed'
            }}
          >
            <Send size={18} />
            {submitLabel}
          </button>

          <button
            type="button"
            className="btn btn-cancel"
            onClick={onClose}
          >
            Cancelar
          </button>
        </form>

        {/* Info adicional */}
        <div style={{
          marginTop: '1rem',
          padding: '12px',
          background: 'var(--light-background)',
          borderRadius: '8px',
          fontSize: '0.85rem',
          color: 'var(--text-light)',
          textAlign: 'center',
          lineHeight: '1.4'
        }}>
          <strong>💡 Tip:</strong> Se abrirá tu cliente de correo con el mensaje ya redactado. Solo revisa y envía.
        </div>
      </div>
    </div>
  );
}