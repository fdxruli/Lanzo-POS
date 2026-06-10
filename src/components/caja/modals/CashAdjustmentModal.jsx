import { useState, useEffect } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Info,
  Scale,
  X
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import { useConfirmDiscard } from '../../../hooks/useConfirmDiscard';

const CashAdjustmentModal = ({
  show,
  onClose,
  onConfirm,
  totalTeorico,
  isDisabled = false
}) => {
  const [montoFisicoReal, setMontoFisicoReal] = useState('');
  const [comentario, setComentario] = useState('');
  const [mostrarConfirmacionCero, setMostrarConfirmacionCero] = useState(false);
  const requestClose = useConfirmDiscard({
    hasChanges: montoFisicoReal.length > 0 || comentario.length > 0,
    onClose,
    isDisabled
  });

  useEffect(() => {
    if (!show || isDisabled) return;

    const handleEsc = (event) => {
      if (event.key === 'Escape') requestClose();
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [show, requestClose, isDisabled]);

  useEffect(() => {
    if (show) {
      setMontoFisicoReal('');
      setComentario('');
      setMostrarConfirmacionCero(false);
    }
  }, [show]);

  if (!show) return null;

  const teoricoSafe = Money.init(totalTeorico || 0);
  const fisicoSafe = Money.init(montoFisicoReal || 0);
  const diferenciaSafe = Money.subtract(fisicoSafe, teoricoSafe);
  const comentarioLimpio = comentario.trim();
  const diferenciaEsPositiva = diferenciaSafe.gt(0);
  const diferenciaEsNegativa = diferenciaSafe.lt(0);
  const noHayDiferencia = !diferenciaEsPositiva && !diferenciaEsNegativa;
  const puedeEnviar = montoFisicoReal && fisicoSafe.gte(0) && comentarioLimpio.length > 0;
  const differenceTone = diferenciaEsPositiva
    ? 'positive'
    : diferenciaEsNegativa
      ? 'negative'
      : 'neutral';

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isDisabled) return;

    if (noHayDiferencia && !mostrarConfirmacionCero) {
      setMostrarConfirmacionCero(true);
      return;
    }

    onConfirm(Money.toExactString(fisicoSafe), comentarioLimpio);
  };

  return (
    <div
      className="modal caja-modal caja-modal--adjustment"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-ajuste"
    >
      <div className="modal-content caja-modal__content caja-modal__content--medium">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true">
            <Scale size={22} />
          </span>
          <div className="caja-modal__heading">
            <p>Conciliación auditable</p>
            <h2 id="modal-title-ajuste">Ajuste de caja</h2>
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
            Compara el efectivo físico contra el total teórico y documenta cualquier diferencia.
          </p>

          <div className="caja-modal__reference">
            <span>Total teórico actual</span>
            <strong>${Money.toNumber(teoricoSafe).toFixed(2)}</strong>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="caja-modal__field">
              <label htmlFor="monto-fisico-real-input">Monto físico real</label>
              <div className="caja-modal__money-input">
                <span aria-hidden="true">$</span>
                <input
                  id="monto-fisico-real-input"
                  type="number"
                  value={montoFisicoReal}
                  onChange={(event) => {
                    setMontoFisicoReal(event.target.value);
                    setMostrarConfirmacionCero(false);
                  }}
                  step="0.01"
                  min="0"
                  required
                  autoFocus
                  disabled={isDisabled}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="caja-modal__field">
              <label htmlFor="ajuste-comentario-input">
                Comentario
                <span>Obligatorio</span>
              </label>
              <textarea
                id="ajuste-comentario-input"
                value={comentario}
                onChange={(event) => setComentario(event.target.value)}
                placeholder="Ej. Corrección por cambio mal dado en venta #123"
                required
                disabled={isDisabled}
                rows={3}
              />
            </div>

            <div className={`caja-modal__difference caja-modal__difference--${differenceTone}`}>
              <div>
                <span>Diferencia calculada</span>
                <strong>
                  {diferenciaEsPositiva ? '+' : diferenciaEsNegativa ? '-' : ''}
                  ${Money.toNumber(diferenciaSafe.abs()).toFixed(2)}
                </strong>
              </div>
              <p>
                {diferenciaEsPositiva && (
                  <><ArrowDownToLine size={17} aria-hidden="true" /> Se registrará como ajuste de entrada.</>
                )}
                {diferenciaEsNegativa && (
                  <><ArrowUpFromLine size={17} aria-hidden="true" /> Se registrará como ajuste de salida.</>
                )}
                {noHayDiferencia && (
                  <><CheckCircle2 size={17} aria-hidden="true" /> No se generará un movimiento adicional.</>
                )}
              </p>
            </div>

            {mostrarConfirmacionCero && (
              <div className="caja-modal__confirmation">
                <div className="caja-modal__notice caja-modal__notice--warning">
                  <Info size={18} aria-hidden="true" />
                  <div>
                    <strong>Confirmar sin registrar ajuste</strong>
                    <p>
                      El monto físico coincide con el teórico. El comentario se guardará como nota,
                      pero no se generará ningún movimiento.
                    </p>
                  </div>
                </div>
                <div className="caja-modal__confirmation-actions">
                  <button
                    type="button"
                    className="caja-modal__button caja-modal__button--secondary"
                    onClick={() => setMostrarConfirmacionCero(false)}
                    disabled={isDisabled}
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    className="caja-modal__button caja-modal__button--primary"
                    disabled={isDisabled}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}

            <footer className="caja-modal__actions">
              <button type="button" className="caja-modal__button caja-modal__button--secondary" onClick={requestClose} disabled={isDisabled}>
                Cancelar
              </button>
              <button
                type="submit"
                className="caja-modal__button caja-modal__button--primary"
                disabled={isDisabled || !puedeEnviar}
              >
                <Scale size={18} aria-hidden="true" />
                {noHayDiferencia ? 'Guardar nota' : 'Registrar ajuste'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CashAdjustmentModal;
