// src/components/common/PaymentModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, STORES } from '../../services/database';
import './PaymentModal.css';

export default function PaymentModal({ show, onClose, onConfirm, total }) {
  // Estado local para este modal
  const [amountPaid, setAmountPaid] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  // --- NUEVOS ESTADOS PARA EL BUSCADOR DE CLIENTES ---
  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState([]);

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
      // <-- NUEVO: Limpiar también los estados de búsqueda
      setCustomerSearch('');
      setFilteredCustomers([]);
    }
  }, [show, total]);

  // Lógica de cálculo de cambio
  const paid = parseFloat(amountPaid) || 0;
  const change = paid - total;
  const canConfirm = change >= 0;

  // --- INICIO: NUEVOS MANEJADORES ---

  /**
   * (NUEVO) Selecciona el texto del input de monto al hacer focus
   */
  const handleAmountFocus = (e) => {
    e.target.select();
  };

  /**
   * (NUEVO) Maneja la búsqueda en vivo de clientes
   */
  const handleCustomerSearch = (e) => {
    const query = e.target.value;
    setCustomerSearch(query);
    setSelectedCustomerId(null); // Deseleccionar si se está escribiendo

    if (query.trim().length > 2) { // Buscar después de 2 caracteres
      const filtered = customers.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.phone.includes(query)
      );
      setFilteredCustomers(filtered);
    } else {
      setFilteredCustomers([]);
    }
  };

  /**
   * (NUEVO) Maneja el clic en un resultado de búsqueda
   */
  const handleCustomerClick = (customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearch(`${customer.name} - ${customer.phone}`); // Rellena el input
    setFilteredCustomers([]); // Oculta los resultados
  };

  // --- FIN: NUEVOS MANEJADORES ---


  // Al confirmar, enviamos los datos al padre
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!canConfirm) {
      return; // Salir si no se puede confirmar
    }
    
    onConfirm({
      amountPaid: paid,
      customerId: selectedCustomerId,
    });
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
            
            {/* --- INICIO: SECCIÓN DE CLIENTE MODIFICADA --- */}
            <div className="form-group customer-search-wrapper">
              <label className="form-label" htmlFor="sale-customer-input">
                Asignar a Cliente (Opcional):
              </label>
              <input
                className="form-input"
                id="sale-customer-input"
                type="text"
                placeholder="Buscar por nombre o teléfono (min. 3 letras)"
                value={customerSearch} // <-- MODIFICADO
                onChange={handleCustomerSearch} // <-- MODIFICADO
                autoComplete="off" // <-- NUEVO
              />
              {/* --- NUEVO: Lista de resultados --- */}
              {filteredCustomers.length > 0 && (
                <div className="customer-search-results">
                  {/* Mostramos solo los primeros 5 para no saturar */}
                  {filteredCustomers.slice(0, 5).map(c => (
                    <div
                      key={c.id}
                      className="customer-result-item"
                      onClick={() => handleCustomerClick(c)}
                    >
                      {c.name} ({c.phone})
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* --- FIN: SECCIÓN DE CLIENTE MODIFICADA --- */}
            
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
              onFocus={handleAmountFocus} // <-- ¡ESTA ES LA MEJORA!
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