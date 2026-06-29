// src/components/caja/modals/EditInitialModal.jsx
import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import { showMessageModal } from '../../../services/utils';
import Logger from '../../../services/Logger';

/**
 * Modal para corregir el fondo inicial de la caja
 *
 * @param {Object} props
 * @param {boolean} props.show - Controla la visibilidad del modal
 * @param {Function} props.onClose - Callback al cerrar el modal
 * @param {Function} props.onSave - Callback al guardar el nuevo monto (recibe string)
 * @param {string|number} props.currentAmount - Monto actual del fondo inicial
 * @param {boolean} [props.isDisabled=false] - Deshabilita la interacción
 */
const EditInitialModal = ({ show, onClose, onSave, currentAmount, isDisabled = false }) => {
  const [amount, setAmount] = useState('');
  const [focusedElement, setFocusedElement] = useState(null);
  const inputRef = useRef(null);

  // Inicializar al abrir el modal
  useEffect(() => {
    if (show) {
      setFocusedElement(document.activeElement);
      setAmount(currentAmount !== undefined ? currentAmount : '');
    }
  }, [show]);

  // Soporte para tecla ESC y focus trap
  useEffect(() => {
    if (!show || isDisabled) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    // Focus trap: mantener el foco dentro del modal
    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;

      const focusableElements = document.querySelectorAll(
        '.modal[style*="display: flex"] input, .modal[style*="display: flex"] button, .modal[style*="display: flex"] textarea, .modal[style*="display: flex"] select'
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleEsc);
    document.addEventListener('keydown', handleTabKey);

    // Enfocar el input automáticamente
    inputRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.removeEventListener('keydown', handleTabKey);
      // Restaurar foco al elemento original
      if (focusedElement && focusedElement.focus) {
        focusedElement.focus();
      }
    };
  }, [show, onClose, isDisabled, focusedElement]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isDisabled) return;

    try {
      const safeVal = Money.init(amount);
      if (safeVal.lt(0)) {
        showMessageModal('El fondo inicial no puede ser negativo.', null, { type: 'error' });
        return;
      }
      onSave(Money.toExactString(safeVal));
      onClose();
    } catch (error) {
      Logger.error('Error en fondo inicial:', error);
      showMessageModal('Monto inválido. Por favor verifica el formato.', null, { type: 'error' });
    }
  };

  if (!show) return null;

  return (
    <div
      className="ui-modal ui-modal--high cash-modal-overlay modal"
      style={{ display: 'flex' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-fondo-inicial"
    >
      <div className="ui-modal__content ui-modal__content--sm cash-modal-content">
        <header className="ui-modal__header cash-modal-header">
          <h3 className="ui-modal__title modal-title" id="modal-title-fondo-inicial">Ajustar Fondo Inicial</h3>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm cash-modal-close"
            onClick={onClose}
            disabled={isDisabled}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </header>
        <p className="ui-alert ui-alert--info cash-modal-note">
          El sistema calculó este fondo automáticamente del turno anterior.
          Si el dinero físico real es diferente, corrígelo aquí.
        </p>
        <form className="ui-modal__body cash-modal-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="fondo-real-input">Fondo Real ($)</label>
            <input
              id="fondo-real-input"
              type="number"
              className="form-input"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
              step="0.01"
              min="0"
              disabled={isDisabled}
              placeholder="0.00"
            />
          </div>
          <footer className="ui-modal__actions cash-modal-actions">
            <button type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={onClose} disabled={isDisabled}>Cancelar</button>
            <button type="submit" className="ui-button ui-button--primary btn btn-save" disabled={isDisabled}>Actualizar</button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default EditInitialModal;
