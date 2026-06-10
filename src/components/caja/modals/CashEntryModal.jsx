import { useEffect, useState } from 'react';
import { ArrowDownToLine, Save, X } from 'lucide-react';
import { useConfirmDiscard } from '../../../hooks/useConfirmDiscard';

const CashEntryModal = ({ show, onClose, onSubmit, isDisabled = false }) => {
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const requestClose = useConfirmDiscard({
    hasChanges: monto.length > 0 || concepto.length > 0,
    onClose,
    isDisabled
  });

  useEffect(() => {
    if (show) {
      setMonto('');
      setConcepto('');
    }
  }, [show]);

  useEffect(() => {
    if (!show || isDisabled) return;

    const handleEsc = (event) => {
      if (event.key === 'Escape') requestClose();
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [show, requestClose, isDisabled]);

  if (!show) return null;

  return (
    <div
      className="modal caja-modal caja-modal--entry"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-entrada"
    >
      <div className="modal-content caja-modal__content caja-modal__content--compact">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true">
            <ArrowDownToLine size={22} />
          </span>
          <div className="caja-modal__heading">
            <p>Movimiento de efectivo</p>
            <h2 id="modal-title-entrada">Registrar entrada</h2>
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
            Agrega efectivo externo al flujo normal de ventas del turno.
          </p>

          <form onSubmit={onSubmit}>
            <div className="caja-modal__field">
              <label htmlFor="entrada-monto-input">Monto</label>
              <div className="caja-modal__money-input">
                <span aria-hidden="true">$</span>
                <input
                  id="entrada-monto-input"
                  name="entrada-monto-input"
                  type="number"
                  value={monto}
                  onChange={(event) => setMonto(event.target.value)}
                  step="0.01"
                  min="0.01"
                  required
                  autoFocus
                  disabled={isDisabled}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="caja-modal__field">
              <label htmlFor="entrada-concepto-input">Concepto</label>
              <input
                id="entrada-concepto-input"
                name="entrada-concepto-input"
                type="text"
                value={concepto}
                onChange={(event) => setConcepto(event.target.value)}
                placeholder="Ej. Cambio, aporte extra o recuperación de fiado"
                required
                disabled={isDisabled}
              />
            </div>

            <footer className="caja-modal__actions">
              <button type="button" className="caja-modal__button caja-modal__button--secondary" onClick={requestClose} disabled={isDisabled}>
                Cancelar
              </button>
              <button type="submit" className="caja-modal__button caja-modal__button--positive" disabled={isDisabled}>
                <Save size={18} aria-hidden="true" />
                Guardar entrada
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CashEntryModal;
