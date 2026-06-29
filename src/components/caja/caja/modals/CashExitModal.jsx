// src/components/caja/modals/CashExitModal.jsx
import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useDismissibleHistoryLayer } from '../../../../hooks/useDismissibleHistoryLayer';

/**
 * Modal para registrar salida de efectivo
 *
 * @param {Object} props
 * @param {boolean} props.show - Controla la visibilidad del modal
 * @param {Function} props.onClose - Callback al cerrar el modal
 * @param {Function} props.onSubmit - Callback al enviar el formulario (recibe event)
 * @param {boolean} [props.isDisabled=false] - Deshabilita la interacción
 */
const CashExitModal = ({ show, onClose, onSubmit, isDisabled = false }) => {
  const handleDismiss = useCallback(() => {
    if (isDisabled) return;
    onClose();
  }, [isDisabled, onClose]);

  const dismissModal = useDismissibleHistoryLayer({
    isOpen: show,
    onDismiss: handleDismiss,
    layerId: 'cash-exit-modal'
  });

  // Soporte para tecla ESC
  useEffect(() => {
    if (!show || isDisabled) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') dismissModal();
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [show, dismissModal, isDisabled]);

  if (!show) return null;

  return (
    <div
      className="ui-modal ui-modal--high cash-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-salida"
    >
      <div className="ui-modal__content ui-modal__content--sm cash-modal-content">
        <header className="ui-modal__header cash-modal-header">
          <h2 className="ui-modal__title modal-title" id="modal-title-salida">Salida de Efectivo</h2>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm cash-modal-close"
            onClick={dismissModal}
            disabled={isDisabled}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </header>

        <p className="ui-alert ui-alert--warning cash-modal-note">
          ⚠️ La salida debe estar justificada y será registrada en el historial de movimientos.
        </p>

        <form className="ui-modal__body cash-modal-form" onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="salida-monto-input">Monto ($):</label>
            <input
              id="salida-monto-input"
              name="salida-monto-input"
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
            <label className="form-label" htmlFor="salida-concepto-input">Concepto:</label>
            <input
              id="salida-concepto-input"
              name="salida-concepto-input"
              type="text"
              className="form-input"
              placeholder="Ej: Pago proveedor, Gasto operativo, Retiro"
              required
              disabled={isDisabled}
            />
          </div>
          <footer className="ui-modal__actions cash-modal-actions">
            <button type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={dismissModal} disabled={isDisabled}>Cancelar</button>
            <button type="submit" className="ui-button ui-button--danger btn btn-delete" disabled={isDisabled}>Registrar Salida</button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default CashExitModal;