// src/components/caja/modals/CashEntryModal.jsx
import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Modal para registrar entrada de efectivo
 *
 * @param {Object} props
 * @param {boolean} props.show - Controla la visibilidad del modal
 * @param {Function} props.onClose - Callback al cerrar el modal
 * @param {Function} props.onSubmit - Callback al enviar el formulario (recibe event)
 * @param {boolean} [props.isDisabled=false] - Deshabilita la interacción
 */
const CashEntryModal = ({ show, onClose, onSubmit, isDisabled = false }) => {
  // Soporte para tecla ESC
  useEffect(() => {
    if (!show || isDisabled) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [show, onClose, isDisabled]);

  if (!show) return null;

  return (
    <div
      className="modal"
      style={{ display: 'flex' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-entrada"
    >
      <div className="modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 className="modal-title" style={{ margin: 0 }} id="modal-title-entrada">Entrada de Efectivo</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isDisabled}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Monto ($):</label>
            <input
              name="entrada-monto-input"
              type="number"
              className="form-input"
              step="0.01"
              min="0.01"
              required
              autoFocus
              disabled={isDisabled}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Concepto:</label>
            <input
              name="entrada-concepto-input"
              type="text"
              className="form-input"
              placeholder="Ej: Cambio, Aporte extra, Recuperación de fiado"
              required
              disabled={isDisabled}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
            <button type="button" className="btn btn-cancel" onClick={onClose} disabled={isDisabled}>Cancelar</button>
            <button type="submit" className="btn btn-save" disabled={isDisabled}>Guardar Entrada</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CashEntryModal;
