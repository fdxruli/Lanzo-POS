import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpFromLine, X } from 'lucide-react';
import { useConfirmDiscard } from '../../../hooks/useConfirmDiscard';

const CashExitModal = ({ show, onClose, onSubmit, isDisabled = false }) => {
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
      className="modal caja-modal caja-modal--exit"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-salida"
    >
      <div className="modal-content caja-modal__content caja-modal__content--compact">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true">
            <ArrowUpFromLine size={22} />
          </span>
          <div className="caja-modal__heading">
            <p>Movimiento de efectivo</p>
            <h2 id="modal-title-salida">Registrar salida</h2>
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
          <div className="caja-modal__notice caja-modal__notice--warning">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>La salida debe estar justificada y quedará registrada en el historial del turno.</p>
          </div>

          <form onSubmit={onSubmit}>
            <div className="caja-modal__field">
              <label htmlFor="salida-monto-input">Monto</label>
              <div className="caja-modal__money-input">
                <span aria-hidden="true">$</span>
                <input
                  id="salida-monto-input"
                  name="salida-monto-input"
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
              <label htmlFor="salida-concepto-input">Concepto</label>
              <input
                id="salida-concepto-input"
                name="salida-concepto-input"
                type="text"
                value={concepto}
                onChange={(event) => setConcepto(event.target.value)}
                placeholder="Ej. Pago a proveedor, gasto operativo o retiro"
                required
                disabled={isDisabled}
              />
            </div>

            <footer className="caja-modal__actions">
              <button type="button" className="caja-modal__button caja-modal__button--secondary" onClick={requestClose} disabled={isDisabled}>
                Cancelar
              </button>
              <button type="submit" className="caja-modal__button caja-modal__button--danger" disabled={isDisabled}>
                <ArrowUpFromLine size={18} aria-hidden="true" />
                Registrar salida
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CashExitModal;
