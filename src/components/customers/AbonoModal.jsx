// src/components/common/AbonoModal.jsx
import React, { useState, useEffect } from 'react';
import './AbonoModal.css';

export default function AbonoModal({ show, onClose, onConfirmAbono, customer }) {
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');

  const [sendReceipt, setSendReceipt] = useState(true);

  const deudaActual = customer?.debt || 0;

  useEffect(() => {
    if (!show) {
      setMonto('');
      setError('');
    }
  }, [show]);

  const handleMontoChange = (e) => {
    const value = e.target.value;
    setError('');
    if (parseFloat(value) > deudaActual) {
      setError('El abono no puede ser mayor que la deuda actual.');
    }
    setMonto(value);
  };

  const handleSaldarCuenta = () => {
    setMonto(deudaActual.toFixed(2));
    setError('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const montoAbono = parseFloat(monto);

    if (isNaN(montoAbono) || montoAbono <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    if (montoAbono > deudaActual) {
      setError('El abono no puede ser mayor que la deuda actual.');
      return;
    }

    onConfirmAbono(customer, montoAbono, sendReceipt);
  };

  if (!show || !customer) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-mid)' }}>
      <div className="modal-content abono-modal">
        <h2 className="modal-title">Abonar a Deuda</h2>
        <div className="abono-summary">
          <p>Cliente: <strong>{customer.name}</strong></p>
          <p className="deuda-label">Deuda Actual:</p>
          <p className="deuda-total">${deudaActual.toFixed(2)}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="abono-monto">Monto a Abonar ($):</label>
            <input
              className={`form-input ${error ? 'invalid' : ''}`}
              id="abono-monto"
              type="number"
              step="0.01"
              min="0"
              max={deudaActual.toFixed(2)}
              value={monto}
              onChange={handleMontoChange}
              required
              autoFocus
            />
            {error && <p className="form-help-text validation-message error">{error}</p>}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaldarCuenta}
          >
            Saldar Cuenta (${deudaActual.toFixed(2)})
          </button>

          <div className="form-group-checkbox">
            <input
              id="send-receipt-abono"
              type="checkbox"
              checked={sendReceipt}
              onChange={(e) => setSendReceipt(e.target.checked)}
            />
            <label htmlFor="send-receipt-abono">Enviar recibo por WhatsApp</label>
          </div>

          <button type="submit" className="btn btn-save" disabled={!!error || !monto}>
            Confirmar Abono
          </button>
          <button type="button" className="btn btn-cancel" onClick={onClose}>
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}