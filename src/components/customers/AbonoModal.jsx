// src/components/customers/AbonoModal.jsx
import React, { useState, useEffect } from 'react';
import { Wallet, X, CheckCircle, MessageCircle, AlertTriangle } from 'lucide-react';
import './AbonoModal.css';

export default function AbonoModal({ show, onClose, onConfirmAbono, customer }) {
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);

  const deudaActual = Number(customer?.debt) || 0;

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

    // El Modal solo pasa la información al componente PADRE.
    onConfirmAbono(customer, montoAbono, sendReceipt);
  };

  if (!show || !customer) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}>
      <div className="modal-content abono-modal-content">
        <div className="abono-header">
          <h2 className="modal-title">
            <Wallet size={24} className="text-primary" />
            Abonar a Deuda
          </h2>
          <button className="btn-icon-close" onClick={onClose} aria-label="Cerrar">
            <X size={24} />
          </button>
        </div>

        <div className="abono-summary-card">
          <div className="cliente-info">
            <span className="cliente-label">Cliente:</span>
            <span className="cliente-name">{customer.name}</span>
          </div>
          <div className="deuda-row">
            <span className="deuda-label">Deuda Actual:</span>
            <span className="deuda-total">${deudaActual.toFixed(2)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="abono-form">
          <div className="form-group abono-input-group">
            <div className="abono-input-header">
              <label className="form-label" htmlFor="abono-monto">Monto a Abonar ($):</label>
              <button
                type="button"
                className="btn-saldar-quick"
                onClick={handleSaldarCuenta}
                title="Liquidar toda la deuda"
              >
                Saldar $ {deudaActual.toFixed(2)}
              </button>
            </div>
            
            <div className="input-with-currency">
              <span className="currency-symbol">$</span>
              <input
                className={`form-input abono-monto-input ${error ? 'invalid' : ''}`}
                id="abono-monto"
                type="number"
                step="0.01"
                min="0"
                max={deudaActual.toFixed(2)}
                value={monto}
                onChange={handleMontoChange}
                placeholder="0.00"
                required
                autoFocus
              />
            </div>
            {error && (
              <p className="form-help-text validation-message error">
                <AlertTriangle size={14} /> {error}
              </p>
            )}
          </div>

          <label className="abono-whatsapp-toggle">
            <div className="toggle-info">
              <MessageCircle size={20} className="icon-whatsapp" />
              <span>Enviar recibo por WhatsApp</span>
            </div>
            <input
              id="send-receipt-abono"
              type="checkbox"
              checked={sendReceipt}
              onChange={(e) => setSendReceipt(e.target.checked)}
            />
          </label>

          <div className="abono-actions">
            <button type="submit" className="btn btn-save" disabled={!!error || !monto}>
              <CheckCircle size={18} />
              Confirmar Abono
            </button>
            <button type="button" className="btn btn-cancel" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}