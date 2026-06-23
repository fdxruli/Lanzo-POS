import { useState, useEffect, useRef } from 'react';
import { Landmark, Save, X } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import { showMessageModal } from '../../../services/utils';
import Logger from '../../../services/Logger';
import { useConfirmDiscard } from '../../../hooks/useConfirmDiscard';

const EditInitialModal = ({ show, onClose, onSave, currentAmount, isDisabled = false }) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const inputRef = useRef(null);
  const modalRef = useRef(null);
  const focusedElementRef = useRef(null);
  const initialAmount = currentAmount !== undefined ? String(currentAmount) : '';
  const requestClose = useConfirmDiscard({
    hasChanges: String(amount) !== initialAmount || reason.trim() !== '',
    onClose,
    isDisabled
  });

  useEffect(() => {
    if (show) {
      focusedElementRef.current = document.activeElement;
      setAmount(currentAmount !== undefined ? currentAmount : '');
      setReason('');
    }
  }, [show, currentAmount]);

  useEffect(() => {
    if (!show || isDisabled) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        requestClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = modalRef.current?.querySelectorAll(
        'input:not(:disabled), button:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
      );

      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    inputRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      focusedElementRef.current?.focus?.();
    };
  }, [show, requestClose, isDisabled]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isDisabled) return;

    try {
      const safeVal = Money.init(amount);
      if (safeVal.lt(0)) {
        showMessageModal('El fondo inicial no puede ser negativo.', null, { type: 'error' });
        return;
      }
      const cleanReason = reason.trim();
      if (!cleanReason) {
        showMessageModal('Indica el motivo del ajuste de fondo inicial.', null, { type: 'error' });
        return;
      }
      onSave(Money.toExactString(safeVal), cleanReason);
      onClose();
    } catch (error) {
      Logger.error('Error en fondo inicial:', error);
      showMessageModal('Monto inválido. Por favor verifica el formato.', null, { type: 'error' });
    }
  };

  if (!show) return null;

  return (
    <div
      ref={modalRef}
      className="modal caja-modal caja-modal--fund"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-fondo-inicial"
    >
      <div className="modal-content caja-modal__content caja-modal__content--compact">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true">
            <Landmark size={22} />
          </span>
          <div className="caja-modal__heading">
            <p>Configuración del turno</p>
            <h2 id="modal-title-fondo-inicial">Ajustar fondo inicial</h2>
          </div>
          <button
            type="button"
            className="caja-modal__close"
            onClick={requestClose}
            disabled={isDisabled}
            aria-label="Cerrar modal"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="caja-modal__body">
          <p className="caja-modal__intro">
            Corrige el fondo calculado si el efectivo físico disponible al iniciar el turno es diferente.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="caja-modal__field">
              <label htmlFor="fondo-real-input">Fondo real</label>
              <div className="caja-modal__money-input">
                <span aria-hidden="true">$</span>
                <input
                  ref={inputRef}
                  id="fondo-real-input"
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  step="0.01"
                  min="0"
                  disabled={isDisabled}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="caja-modal__field">
              <label htmlFor="fondo-inicial-motivo">Motivo del ajuste</label>
              <textarea
                id="fondo-inicial-motivo"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isDisabled}
                placeholder="Ej. Diferencia detectada en conteo inicial"
                rows={3}
                required
              />
            </div>

            <footer className="caja-modal__actions">
              <button type="button" className="caja-modal__button caja-modal__button--secondary" onClick={requestClose} disabled={isDisabled}>
                Cancelar
              </button>
              <button type="submit" className="caja-modal__button caja-modal__button--primary" disabled={isDisabled}>
                <Save size={18} aria-hidden="true" />
                Actualizar
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditInitialModal;
