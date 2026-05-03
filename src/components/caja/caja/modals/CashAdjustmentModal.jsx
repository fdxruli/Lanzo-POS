// src/components/caja/modals/CashAdjustmentModal.jsx
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

/**
 * Modal para registrar ajustes de caja por diferencias físicas
 *
 * @param {Object} props
 * @param {boolean} props.show - Controla la visibilidad del modal
 * @param {Function} props.onClose - Callback al cerrar el modal
 * @param {Function} props.onConfirm - Callback al confirmar (recibe montoFisicoReal, comentario)
 * @param {string|number} props.totalTeorico - Valor teórico actual de la caja (calculado por el padre)
 * @param {boolean} [props.isDisabled=false] - Deshabilita la interacción
 */
const CashAdjustmentModal = ({
  show,
  onClose,
  onConfirm,
  totalTeorico,
  isDisabled = false
}) => {
  // Usamos el estado 'show' como key para forzar el reseteo del estado interno
  // Esto evita llamar setState dentro de useEffect
  const [montoFisicoReal, setMontoFisicoReal] = useState('');
  const [comentario, setComentario] = useState('');
  const [mostrarConfirmacionCero, setMostrarConfirmacionCero] = useState(false);

  // Soporte para tecla ESC
  useEffect(() => {
    if (!show || isDisabled) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [show, onClose, isDisabled]);

  // Handler para resetear el estado cuando se abre el modal
  const handleOpen = () => {
    setMontoFisicoReal('');
    setComentario('');
    setMostrarConfirmacionCero(false);
  };

  // Efecto para inicializar al abrir (patrón aceptado para modales)
  useEffect(() => {
    if (show) {
      handleOpen();
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

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isDisabled) return;

    // Si no hay diferencia, mostrar confirmación antes de registrar
    if (noHayDiferencia && !mostrarConfirmacionCero) {
      setMostrarConfirmacionCero(true);
      return;
    }

    onConfirm(Money.toExactString(fisicoSafe), comentarioLimpio);
  };

  const handleCancelarConfirmacionCero = () => {
    setMostrarConfirmacionCero(false);
  };

  return (
    <div
      className="modal"
      style={{ display: 'flex', zIndex: 1200 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-ajuste"
    >
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 className="modal-title" style={{ margin: 0 }} id="modal-title-ajuste">Ajuste de Caja</h3>
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

        <p style={{ marginBottom: '12px', color: 'var(--text-light)', fontSize: '0.9rem' }}>
          Ingresa el monto físico real para generar un ajuste auditable contra el total teórico.
        </p>

        <div style={{ marginBottom: '12px', padding: '10px', background: 'var(--light-background)', borderRadius: '8px' }}>
          <strong>Total teórico actual:</strong> ${Money.toNumber(teoricoSafe).toFixed(2)}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Monto Físico Real ($)</label>
            <input
              type="number"
              className="form-input"
              value={montoFisicoReal}
              onChange={(e) => {
                setMontoFisicoReal(e.target.value);
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

          <div className="form-group">
            <label className="form-label">Comentario (obligatorio)</label>
            <textarea
              className="form-textarea"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej: Corrección por cambio mal dado en venta #123"
              required
              disabled={isDisabled}
              rows={3}
            />
          </div>

          <div style={{ marginBottom: '12px', padding: '10px', borderRadius: '8px', background: '#f8fafc' }}>
            <strong>Diferencia:</strong>{' '}
            <span style={{
              color: diferenciaEsPositiva ? 'var(--success-color)' : (diferenciaEsNegativa ? 'var(--error-color)' : 'var(--text-dark)'),
              fontSize: '1.1rem',
              fontWeight: 'bold'
            }}>
              {diferenciaEsPositiva ? '+' : ''}{diferenciaEsNegativa ? '-' : ''}${Money.toNumber(diferenciaSafe.abs()).toFixed(2)}
            </span>
            {diferenciaEsPositiva && (
              <div style={{ color: 'var(--success-color)', marginTop: '4px', fontSize: '0.9rem' }}>
                ↑ Se registrará como <strong>ajuste_entrada</strong>
              </div>
            )}
            {diferenciaEsNegativa && (
              <div style={{ color: 'var(--error-color)', marginTop: '4px', fontSize: '0.9rem' }}>
                ↓ Se registrará como <strong>ajuste_salida</strong>
              </div>
            )}
            {noHayDiferencia && (
              <div style={{ color: 'var(--text-light)', marginTop: '4px', fontSize: '0.9rem' }}>
                ✓ No hay diferencia; no se registrará movimiento adicional.
              </div>
            )}
          </div>

          {mostrarConfirmacionCero && (
            <div style={{
              padding: '12px',
              backgroundColor: '#FEF3C7',
              borderLeft: '4px solid #F59E0B',
              borderRadius: '6px',
              marginBottom: '12px'
            }}>
              <p style={{ color: '#92400E', margin: '0 0 10px 0', fontWeight: 'bold' }}>
                ℹ️ ¿Confirmar sin registrar ajuste?
              </p>
              <p style={{ color: '#78350F', margin: '0 0 10px 0', fontSize: '0.9rem' }}>
                El monto físico coincide exactamente con el teórico.
                El comentario se guardará como nota pero no se generará ningún movimiento de ajuste.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-cancel"
                  onClick={handleCancelarConfirmacionCero}
                  disabled={isDisabled}
                  style={{ flex: 1 }}
                >
                  Volver
                </button>
                <button
                  type="submit"
                  className="btn btn-save"
                  disabled={isDisabled}
                  style={{ flex: 1 }}
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '15px' }}>
            <button type="button" className="btn btn-cancel" onClick={onClose} disabled={isDisabled}>Cancelar</button>
            <button
              type="submit"
              className="btn btn-save"
              disabled={isDisabled || !puedeEnviar}
            >
              {noHayDiferencia ? 'Solo Guardar Nota' : 'Registrar Ajuste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CashAdjustmentModal;
