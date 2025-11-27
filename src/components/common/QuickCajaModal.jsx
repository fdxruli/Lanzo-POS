// src/components/common/QuickCajaModal.jsx
import React, { useState } from 'react';

export default function QuickCajaModal({ show, onClose, onConfirm }) {
  const [monto, setMonto] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const montoInicial = parseFloat(monto);
    if (!isNaN(montoInicial) && montoInicial >= 0) {
      onConfirm(montoInicial);
      setMonto(''); // Limpiar al confirmar
    } else {
      alert('Por favor, ingresa un monto válido.');
    }
  };

  const handleClose = () => {
    setMonto(''); // Limpiar al cerrar
    onClose();
  };

  if (!show) {
    return null;
  }

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}>
      <div className="modal-content">
        <h2 className="modal-title">Abrir Caja Rápido</h2>
        <p>No hay una caja abierta. Ingresa el monto inicial para comenzar.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="quick-caja-monto" className="form-label">Monto Inicial ($):</label>
            <input
              id="quick-caja-monto"
              className="form-input"
              type="number"
              step="0.01"
              min="0"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              required
              autoFocus // Enfocar este input automáticamente
            />
          </div>
          <button type="submit" className="btn btn-save">Abrir Caja y Continuar</button>
          <button type="button" className="btn btn-cancel" onClick={handleClose}>
            Cancelar Venta
          </button>
        </form>
      </div>
    </div>
  );
}