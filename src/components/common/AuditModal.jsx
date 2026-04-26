// src/components/common/AuditModal.jsx
import { useState, useEffect } from 'react';
import { Money } from '../../utils/moneyMath';
import '../customers/AbonoModal.css';

// Configuración de validación
const AUDIT_CONFIG = {
  MIN_COMENTARIO_LENGTH: 10, // Mínimo de caracteres para comentario de diferencia
  MAX_DIFERENCIA_PERCENTUAL: 0.05, // 5% de tolerancia antes de requerir explicación detallada
  SHOW_WARNING_ON_DIFERENCIA: true
};

export default function AuditModal({ show, onClose, onConfirmAudit, caja: _caja, calcularTeorico, isProcessing = false }) {
  const [montoFisicoTotal, setMontoFisicoTotal] = useState('');
  const [montoFondoSiguienteTurno, setMontoFondoSiguienteTurno] = useState('');
  const [teorico, setTeorico] = useState('0');
  const [comentarios, setComentarios] = useState('');
  const [step, setStep] = useState(1);
  const [showWarning, setShowWarning] = useState(false);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (show && calcularTeorico) {
      // Forzar refresh del cálculo teórico para auditoría
      calcularTeorico(true).then((val) => setTeorico(val));
      setMontoFisicoTotal('');
      setMontoFondoSiguienteTurno('');
      setComentarios('');
      setStep(1);
      setShowWarning(false);
    }
  }, [show]); // Solo resetear el modal cuando la prop 'show' cambia
  /* eslint-enable react-hooks/exhaustive-deps */

  const fisicoSafe = Money.init(montoFisicoTotal || 0);
  const fondoSiguienteTurnoSafe = Money.init(montoFondoSiguienteTurno || 0);
  const teoricoSafe = Money.init(teorico || 0);

  const diferenciaSafe = Money.subtract(fisicoSafe, teoricoSafe);
  const diferenciaAbsoluta = diferenciaSafe.abs();
  
  // Calcular diferencia porcentual relativa al teórico
  const diferenciaPercentual = teoricoSafe.gt(0) 
    ? Money.divide(diferenciaAbsoluta, teoricoSafe)
    : Money.init(0);
  
  const hayDiferenciaPercentual = diferenciaPercentual.gt(0);
  const hayDiferenciaSignificativa = diferenciaAbsoluta.gt(0.5);
  const hayDiferenciaMayor = diferenciaPercentual.gt(AUDIT_CONFIG.MAX_DIFERENCIA_PERCENTUAL);
  const fondoMayorQueFisico = fondoSiguienteTurnoSafe.gt(fisicoSafe);
  const comentarioValido = comentarios.trim().length >= AUDIT_CONFIG.MIN_COMENTARIO_LENGTH;

  const handleNext = () => {
    if (isProcessing) return;
    
    // Validación adicional antes de avanzar
    if (hayDiferenciaMayor && !showWarning) {
      setShowWarning(true);
      return; // Pausar para que el usuario pueda ver la advertencia antes de avanzar
    }
    setStep(2);
  };

  const handleBack = () => {
    setShowWarning(false);
    setStep(1);
  };

  const handleSubmit = () => {
    if (isProcessing) return;

    // Validación final estricta
    if (hayDiferenciaSignificativa && !comentarioValido) {
      return; // No permitir envío sin comentario válido
    }

    onConfirmAudit(
      Money.toExactString(fisicoSafe),
      Money.toExactString(fondoSiguienteTurnoSafe),
      comentarios.trim()
    );
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}>
      <div className="modal-content" style={{ maxWidth: '550px' }}>
        <h2 className="modal-title">Auditoria de Caja (Cierre)</h2>

        {step === 1 ? (
          <>
            <p style={{ color: 'var(--text-light)', marginBottom: '20px' }}>
              Ingresa el efectivo físico total y el fondo que se dejará para el siguiente turno.
              <br />
              <small>El sistema verificará automáticamente el cuadre con el total teórico.</small>
            </p>

            <div className="form-group">
              <label className="form-label">
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Monto Físico Total ($)</span>
                  <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                    Efectivo real en caja
                  </span>
                </span>
              </label>
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
                placeholder="0.00"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Monto Fondo Siguiente Turno ($)</span>
                  <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                    Base del próximo turno
                  </span>
                </span>
              </label>
              <input
                type="number"
                className="form-input"
                style={{ fontSize: '1.2rem', textAlign: 'center', fontWeight: 'bold' }}
                value={montoFondoSiguienteTurno}
                onChange={(e) => setMontoFondoSiguienteTurno(e.target.value)}
                step="0.01"
                min="0"
                disabled={isProcessing}
                placeholder="0.00"
              />
              {montoFondoSiguienteTurno && fondoMayorQueFisico && (
                <small style={{ color: 'var(--error-color)', display: 'block', marginTop: '8px' }}>
                  ⚠️ El fondo siguiente no puede ser mayor al monto físico total.
                </small>
              )}
            </div>

            {showWarning && hayDiferenciaMayor && (
              <div 
                style={{ 
                  padding: '12px', 
                  backgroundColor: '#FEF3C7', 
                  borderLeft: '4px solid #F59E0B',
                  borderRadius: '4px',
                  marginBottom: '15px'
                }}
              >
                <strong style={{ color: '#92400E' }}>⚠️ Diferencia Significativa Detectada</strong>
                <p style={{ margin: '8px 0 0 0', color: '#78350F', fontSize: '0.9rem' }}>
                  La diferencia supera el {Math.round(AUDIT_CONFIG.MAX_DIFERENCIA_PERCENTUAL * 100)}% del total teórico.
                  Se requerirá un comentario detallado en el siguiente paso.
                </p>
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-cancel" onClick={onClose} disabled={isProcessing}>Cancelar</button>
              <button
                type="button"
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
                Verificar Cuadre →
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                <div style={{ padding: '12px', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', margin: '0 0 5px 0' }}>Total Teórico</p>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
                    ${Money.toNumber(teoricoSafe).toFixed(2)}
                  </div>
                </div>
                
                <div style={{ padding: '12px', backgroundColor: '#DBEAFE', borderRadius: '8px' }}>
                  <p style={{ fontSize: '0.85rem', color: '#1E40AF', margin: '0 0 5px 0' }}>Total Físico</p>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#1E40AF' }}>
                    ${Money.toNumber(fisicoSafe).toFixed(2)}
                  </div>
                </div>
              </div>

              <p style={{ marginBottom: '5px', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                Fondo para siguiente turno:
              </p>
              <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--text-dark)', marginBottom: '20px' }}>
                ${Money.toNumber(fondoSiguienteTurnoSafe).toFixed(2)}
              </div>

              <div
                style={{
                  padding: '20px',
                  borderRadius: '12px',
                  backgroundColor: hayDiferenciaSignificativa ? '#FEF2F2' : '#ECFDF5',
                  border: `2px solid ${hayDiferenciaSignificativa ? '#FCA5A5' : '#6EE7B7'}`,
                  marginBottom: '20px'
                }}
              >
                <div style={{ fontSize: '0.9rem', color: hayDiferenciaSignificativa ? '#991B1B' : '#065F46', marginBottom: '8px' }}>
                  {hayDiferenciaSignificativa ? '⚠️ DIFERENCIA DETECTADA' : '✓ CAJA CUADRADA'}
                </div>
                <div 
                  style={{ 
                    fontSize: '1.8rem', 
                    fontWeight: 'bold',
                    color: hayDiferenciaSignificativa 
                      ? (diferenciaSafe.gt(0) ? '#DC2626' : '#DC2626')
                      : '#059669'
                  }}
                >
                  {diferenciaSafe.gt(0) ? '+' : ''}${Money.toNumber(diferenciaSafe).toFixed(2)}
                </div>
                {hayDiferenciaPercentual && (
                  <div style={{ fontSize: '0.85rem', color: '#7F1D1D', marginTop: '5px' }}>
                    ({(Money.toNumber(diferenciaPercentual) * 100).toFixed(2)}% del teórico)
                  </div>
                )}
              </div>
            </div>

            {hayDiferenciaSignificativa && (
              <div className="form-group">
                <label className="form-label">
                  <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Comentario de Diferencia (Requerido)</span>
                    <span style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                      Mínimo {AUDIT_CONFIG.MIN_COMENTARIO_LENGTH} caracteres
                    </span>
                  </span>
                </label>
                <textarea
                  className="form-textarea"
                  placeholder="Describe la causa de la diferencia (ej: 'Diferencia por cambio mal dado en venta #123, ya notificado al cajero')"
                  value={comentarios}
                  onChange={(e) => setComentarios(e.target.value)}
                  disabled={isProcessing}
                  rows={4}
                  style={{ 
                    borderColor: !comentarioValido && comentarios.length > 0 ? 'var(--error-color)' : undefined,
                    backgroundColor: !comentarioValido && comentarios.length > 0 ? '#FEF2F2' : undefined
                  }}
                />
                {!comentarioValido && comentarios.length > 0 && (
                  <small style={{ color: 'var(--error-color)' }}>
                    El comentario debe tener al menos {AUDIT_CONFIG.MIN_COMENTARIO_LENGTH} caracteres.
                  </small>
                )}
              </div>
            )}

            {hayDiferenciaSignificativa && !hayDiferenciaMayor && (
              <div 
                style={{ 
                  padding: '10px', 
                  backgroundColor: '#FEF3C7', 
                  borderRadius: '6px', 
                  marginBottom: '15px',
                  fontSize: '0.9rem',
                  color: '#92400E'
                }}
              >
                ℹ️ La diferencia es menor al {Math.round(AUDIT_CONFIG.MAX_DIFERENCIA_PERCENTUAL * 100)}%. 
                Puede ser por redondeo o centavos sueltos.
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-cancel" onClick={handleBack} disabled={isProcessing}>← Volver</button>
              <button
                type="button"
                className="btn btn-process"
                onClick={handleSubmit}
                disabled={
                  isProcessing || 
                  (hayDiferenciaSignificativa && !comentarioValido)
                }
              >
                {isProcessing ? 'Procesando...' : 'Confirmar y Cerrar Caja ✓'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
