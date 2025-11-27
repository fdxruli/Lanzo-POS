// src/components/common/AuditModal.jsx
import React, { useState, useEffect } from 'react';
import './AbonoModal.css'; // Reusamos estilos existentes para consistencia

export default function AuditModal({ show, onClose, onConfirmAudit, caja, calcularTeorico }) {
    const [montoFisico, setMontoFisico] = useState('');
    const [teorico, setTeorico] = useState(0);
    const [comentarios, setComentarios] = useState('');
    const [step, setStep] = useState(1); // 1: Conteo, 2: Resultado

    useEffect(() => {
        if (show && calcularTeorico) {
            calcularTeorico().then(val => setTeorico(val));
            setMontoFisico('');
            setComentarios('');
            setStep(1);
        }
    }, [show, calcularTeorico]);

    const diferencia = (parseFloat(montoFisico) || 0) - teorico;
    const hayDiferencia = Math.abs(diferencia) > 0.5; // Tolerancia de 50 centavos

    const handleNext = () => {
        setStep(2);
    };

    const handleSubmit = () => {
        onConfirmAudit(parseFloat(montoFisico), comentarios);
    };

    if (!show) return null;

    return (
        <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}>
            <div className="modal-content" style={{ maxWidth: '500px' }}>
                <h2 className="modal-title">Auditoría de Caja (Cierre)</h2>

                {step === 1 ? (
                    <>
                        <p>Por favor, cuenta el dinero físico en la caja e ingrésalo.</p>
                        <div className="form-group">
                            <label className="form-label">Dinero en efectivo ($):</label>
                            <input
                                type="number"
                                className="form-input"
                                style={{ fontSize: '1.5rem', textAlign: 'center', fontWeight: 'bold' }}
                                value={montoFisico}
                                onChange={(e) => setMontoFisico(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                            <button className="btn btn-cancel" onClick={onClose}>Cancelar</button>
                            <button
                                className="btn btn-save"
                                onClick={handleNext}
                                disabled={!montoFisico}
                            >
                                Verificar Cuadre
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <p style={{ marginBottom: '5px' }}>El sistema espera:</p>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>${teorico.toFixed(2)}</div>

                            <p style={{ marginBottom: '5px', marginTop: '15px' }}>Tú contaste:</p>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>${parseFloat(montoFisico).toFixed(2)}</div>

                            <div style={{
                                marginTop: '20px',
                                padding: '15px',
                                borderRadius: '8px',
                                backgroundColor: hayDiferencia ? '#fee2e2' : '#d1fae5',
                                color: hayDiferencia ? '#b91c1c' : '#047857',
                                fontWeight: 'bold'
                            }}>
                                {hayDiferencia
                                    ? `⚠️ Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia.toFixed(2)}`
                                    : '✅ ¡Caja Cuadrada Perfectamente!'}
                            </div>
                        </div>

                        {hayDiferencia && (
                            <div className="form-group">
                                <label className="form-label">¿A qué se debe la diferencia? (Requerido para seguimiento)</label>
                                <textarea
                                    className="form-textarea"
                                    placeholder="Ej: Tomé para el taxi, sobró cambio, etc."
                                    value={comentarios}
                                    onChange={(e) => setComentarios(e.target.value)}
                                ></textarea>
                            </div>
                        )}

                        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                            <button className="btn btn-cancel" onClick={() => setStep(1)}>Volver a contar</button>
                            <button
                                className="btn btn-process"
                                onClick={handleSubmit}
                                disabled={hayDiferencia && comentarios.length < 5} // Obligar comentario si falla
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