// src/components/common/PaymentModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, STORES } from '../../services/database';
import './PaymentModal.css';

export default function PaymentModal({ show, onClose, onConfirm, total }) {
  // Estado local para este modal
  const [amountPaid, setAmountPaid] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  // Carga la lista de clientes cuando se abre el modal
  useEffect(() => {
    if (show) {
      const fetchCustomers = async () => {
        const customerData = await loadData(STORES.CUSTOMERS);
        setCustomers(customerData || []);
      };
      fetchCustomers();
      // Sugerir el monto total en el input
      setAmountPaid(total.toFixed(2));
    } else {
      // Limpiar al cerrar
      setAmountPaid('');
      setSelectedCustomerId(null);
    }
  }, [show, total]);

  // Lógica de cálculo de cambio
  const paid = parseFloat(amountPaid) || 0;
  const change = paid - total;
  const canConfirm = change >= 0;

  // Manejador del <datalist>
  const handleCustomerSelect = (e) => {
    const value = e.target.value;
    const customer = customers.find(c => `${c.name} - ${c.phone}` === value);
    setSelectedCustomerId(customer ? customer.id : null);
  };

  // Al confirmar, enviamos los datos al padre
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!canConfirm) {
      return; // Salir si no se puede confirmar
    }
    
    // IMPORTANTE: Primero llamamos a onConfirm con los datos
    // onConfirm es una función async, pero NO esperamos su resultado
    // porque eso causaría que el modal se quede abierto durante el procesamiento
    onConfirm({
      amountPaid: paid,
      customerId: selectedCustomerId,
    });
    
    // El modal se cerrará desde PosPage después de validaciones
    // NO llamamos a onClose() aquí
  };

  if (!show) {
    return null;
  }

  // HTML de 'payment-modal'
  return (
    <div id="payment-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2 className="modal-title">Procesar Pago</h2>
        <form onSubmit={handleSubmit}>
          <div className="payment-details">
            <p className="payment-label">Total a Pagar:</p>
            <p id="payment-total" className="payment-total">${total.toFixed(2)}</p>
            
            <div className="form-group">
              <label className="form-label" htmlFor="sale-customer-input">
                Asignar a Cliente (Opcional):
              </label>
              <input
                className="form-input"
                id="sale-customer-input"
                type="text"
                placeholder="Buscar por nombre o teléfono..."
                list="customer-list-datalist"
                onChange={handleCustomerSelect}
              />
              <datalist id="customer-list-datalist">
                {customers.map(c => (
                  <option key={c.id} data-id={c.id} value={`${c.name} - ${c.phone}`} />
                ))}
              </datalist>
            </div>
            
            <label className="payment-input-label" htmlFor="payment-amount">
              Monto Recibido:
            </label>
            <input
              className="payment-input"
              id="payment-amount"
              type="number"
              step="0.01"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              required
            />
            <p className="payment-label">Cambio:</p>
            <p id="payment-change" className="payment-change">
              ${change >= 0 ? change.toFixed(2) : '0.00'}
            </p>
          </div>
          
          <button 
            id="confirm-payment-btn" 
            className="btn btn-confirm" 
            type="submit"
            disabled={!canConfirm}
          >
            Confirmar Pago
          </button>
          <button 
            id="cancel-payment-btn" 
            className="btn btn-cancel-payment" 
            type="button"
            onClick={onClose}
          >
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}