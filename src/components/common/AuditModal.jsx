// src/components/common/AuditModal.jsx
import { useState, useEffect } from 'react';
import { Money } from '../../utils/moneyMath';
import '../customers/AbonoModal.css';

export default function AuditModal({ show, onClose, onConfirmAudit, caja: _caja, calcularTeorico, isProcessing = false }) {
  const [montoFisicoTotal, setMontoFisicoTotal] = useState('');
  const [montoFondoSiguienteTurno, setMontoFondoSiguienteTurno] = useState('');
  const [teorico, setTeorico] = useState('0');
  const [comentarios, setComentarios] = useState('');
  const [step, setStep] = useState(1);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (show && calcularTeorico) {
      calcularTeorico().then((val) => setTeorico(val));
      setMontoFisicoTotal('');
      setMontoFondoSiguienteTurno('');
      setComentarios('');
      setStep(1);
    }
  }, [show, calcularTeorico]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fisicoSafe = Money.init(montoFisicoTotal || 0);
  const fondoSiguienteTurnoSafe = Money.init(montoFondoSiguienteTurno || 0);
  const teoricoSafe = Money.init(teorico || 0);

  const diferenciaSafe = Money.subtract(fisicoSafe, teoricoSafe);
  const hayDiferencia = diferenciaSafe.abs().gt(0.5);
  const fondoMayorQueFisico = fondoSiguienteTurnoSafe.gt(fisicoSafe);

  const handleNext = () => {
    if (isProcessing) return;
    setStep(2);
  };

  const handleSubmit = () => {
    if (isProcessing) return;

    onConfirmAudit(
      Money.toExactString(fisicoSafe),
      Money.toExactString(fondoSiguienteTurnoSafe),
      comentarios
    );
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}>
      <div className="modal-content" style={{ maxWidth: '550px' }}>
        <h2 className="modal-title">Auditoria de Caja (Cierre)</h2>

        {step === 1 ? (
          <>
            <p>Ingresa el efectivo fisico total y el fondo que se dejara para el siguiente turno.</p>

            <div className="form-group">
              <label className="form-label">Monto Fisico Total ($):</label>
              <input
                type="number"
                className="form-input"
                style={{ fontSize: '1.2rem', textAlign: 'center', fontWeight: 'bold' }}
                value={montoFisicoTotal}
                onChange={(e) => setMontoFisicoTotal(e.target.value)}
                autoFocus
                step="0.01"
                min="0"
                disabled={isProcessing}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Monto Fondo Siguiente Turno ($):</label>
              <input
                type="number"
                className="form-input"
                style={{ fontSize: '1.2rem', textAlign: 'center', fontWeight: 'bold' }}
                value={montoFondoSiguienteTurno}
                onChange={(e) => setMontoFondoSiguienteTurno(e.target.value)}
                step="0.01"
                min="0"
                disabled={isProcessing}
              />
              {montoFondoSiguienteTurno && fondoMayorQueFisico && (
                <small style={{ color: 'var(--error-color)' }}>
                  El fondo siguiente no puede ser mayor al monto fisico total.
                </small>
              )}
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button className="btn btn-cancel" onClick={onClose} disabled={isProcessing}>Cancelar</button>
              <button
                className="btn btn-save"
                onClick={handleNext}
                disabled={
                  isProcessing ||
                  !montoFisicoTotal ||
                  !montoFondoSiguienteTurno ||
                  fisicoSafe.lt(0) ||
                  fondoSiguienteTurnoSafe.lt(0) ||
                  fondoMayorQueFisico
                }
              >
                Verificar Cuadre
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <p style={{ marginBottom: '5px' }}>Total teorico esperado:</p>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                ${Money.toNumber(teoricoSafe).toFixed(2)}
              </div>

              <p style={{ marginBottom: '5px', marginTop: '15px' }}>Monto fisico contado:</p>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
                ${Money.toNumber(fisicoSafe).toFixed(2)}
              </div>

              <p style={{ marginBottom: '5px', marginTop: '15px' }}>Fondo siguiente turno:</p>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-dark)' }}>
                ${Money.toNumber(fondoSiguienteTurnoSafe).toFixed(2)}
              </div>

              <div
                style={{
                  marginTop: '20px',
                  padding: '15px',
                  borderRadius: '8px',
                  backgroundColor: hayDiferencia ? '#fee2e2' : '#d1fae5',
                  color: hayDiferencia ? '#b91c1c' : '#047857',
                  fontWeight: 'bold'
                }}
              >
                {hayDiferencia
                  ? `Diferencia: ${diferenciaSafe.gt(0) ? '+' : ''}${Money.toNumber(diferenciaSafe).toFixed(2)}`
                  : 'Caja cuadrada perfectamente'}
              </div>
            </div>

            {hayDiferencia && (
              <div className="form-group">
                <label className="form-label">Comentario de diferencia (requerido)</label>
                <textarea
                  className="form-textarea"
                  placeholder="Ej: Correccion por cambio mal dado"
                  value={comentarios}
                  onChange={(e) => setComentarios(e.target.value)}
                  disabled={isProcessing}
                ></textarea>
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button className="btn btn-cancel" onClick={() => setStep(1)} disabled={isProcessing}>Volver</button>
              <button
                className="btn btn-process"
                onClick={handleSubmit}
                disabled={isProcessing || (hayDiferencia && comentarios.trim().length < 5)}
              >
                Confirmar y Cerrar Caja
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
