// src/components/common/PaymentModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, STORES } from '../../services/database';
import QuickAddCustomerModal from './QuickAddCustomerModal';
import './PaymentModal.css';

export default function PaymentModal({ show, onClose, onConfirm, total }) {
  // Estado local para este modal
  const [amountPaid, setAmountPaid] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  // --- NUEVOS ESTADOS ---
  const [paymentMethod, setPaymentMethod] = useState('efectivo'); // 'efectivo' o 'fiado'
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState([]);

  const [sendReceipt, setSendReceipt] = useState(true);

  // Carga la lista de clientes cuando se abre el modal
  useEffect(() => {
    if (show) {
      const fetchCustomers = async () => {
        const customerData = await loadData(STORES.CUSTOMERS);
        setCustomers(customerData || []);
      };
      fetchCustomers();
      // Sugerir el monto total si es en efectivo
      if (paymentMethod === 'efectivo') {
        setAmountPaid(total.toFixed(2));
      }
    } else {
      // Limpiar al cerrar
      setAmountPaid('');
      setSelectedCustomerId(null);
      setCustomerSearch('');
      setFilteredCustomers([]);
      setPaymentMethod('efectivo');
      setSendReceipt(true);
    }
  }, [show, total]); // Quitamos paymentMethod de las dependencias

  // Lógica de cálculo
  const paid = parseFloat(amountPaid) || 0;
  
  // Lógica condicional
  const isEfectivo = paymentMethod === 'efectivo';
  const isFiado = paymentMethod === 'fiado';
  
  // Cálculo de Cambio (Efectivo)
  const change = isEfectivo ? paid - total : 0;
  
  // Cálculo de Saldo (Fiado)
  const saldoPendiente = isFiado ? total - paid : 0;

  // Validación para confirmar
  const canConfirm = isEfectivo 
    ? (paid >= total) // Si es efectivo, debe pagar completo
    : (selectedCustomerId !== null); // Si es fiado, debe tener cliente

  const handleAmountFocus = (e) => {
    e.target.select();
  };

  const handleCustomerSearch = (e) => {
    const query = e.target.value;
    setCustomerSearch(query);
    setSelectedCustomerId(null); // Deseleccionar si se está escribiendo

    if (query.trim().length > 2) {
      const filtered = customers.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.phone.includes(query)
      );
      setFilteredCustomers(filtered);
    } else {
      setFilteredCustomers([]);
    }
  };

  const handleCustomerClick = (customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearch(`${customer.name} - ${customer.phone}`);
    setFilteredCustomers([]);
  };

  // Al confirmar, enviamos los datos al padre
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canConfirm) return;
    
    onConfirm({
      amountPaid: paid, // Será 0 si es fiado y no abona
      customerId: selectedCustomerId,
      paymentMethod: paymentMethod, // Enviamos el método
      saldoPendiente: saldoPendiente, // Enviamos el saldo (será 0 si es efectivo)
      sendReceipt: sendReceipt
    });
  };
  
  // --- NUEVO: Handler para el cliente guardado ---
  const handleQuickCustomerSaved = (newCustomer) => {
    // Añadir el nuevo cliente a la lista local
    setCustomers(prev => [...prev, newCustomer]);
    // Seleccionarlo automáticamente
    handleCustomerClick(newCustomer);
    // Cerrar el modal rápido
    setIsQuickAddOpen(false);
  };
  
  // --- NUEVO: Cambiar el input de monto al cambiar método ---
  const handlePaymentMethodChange = (method) => {
    setPaymentMethod(method);
    if (method === 'efectivo') {
      setAmountPaid(total.toFixed(2)); // Poner total
    } else {
      setAmountPaid(''); // Limpiar para el abono
    }
  }

  if (!show) {
    return null;
  }

  return (
    <>
      <div id="payment-modal" className="modal" style={{ display: 'flex' }}>
        <div className="modal-content">
          <h2 className="modal-title">Procesar Pago</h2>
          <form onSubmit={handleSubmit}>
            <div className="payment-details">
              <p className="payment-label">Total a Pagar:</p>
              <p id="payment-total" className="payment-total">${total.toFixed(2)}</p>

              {/* --- NUEVO: Selector de Método de Pago --- */}
              <div className="form-group">
                <label className="form-label">Método de Pago:</label>
                <div className="payment-method-selector">
                  <button 
                    type="button"
                    className={`btn-method ${isEfectivo ? 'active' : ''}`}
                    onClick={() => handlePaymentMethodChange('efectivo')}
                  >
                    Efectivo
                  </button>
                  <button 
                    type="button"
                    className={`btn-method ${isFiado ? 'active' : ''}`}
                    onClick={() => handlePaymentMethodChange('fiado')}
                  >
                    Fiado
                  </button>
                </div>
              </div>
              
              {/* --- SECCIÓN DE CLIENTE MODIFICADA --- */}
              <div className="form-group customer-search-wrapper">
                <label className="form-label" htmlFor="sale-customer-input">
                  {isFiado ? 'Asignar a Cliente (Obligatorio):' : 'Asignar a Cliente (Opcional):'}
                </label>
                <input
                  className="form-input"
                  id="sale-customer-input"
                  type="text"
                  placeholder="Buscar por nombre o teléfono. Introduce minumo 3 letras"
                  value={customerSearch}
                  onChange={handleCustomerSearch}
                  autoComplete="off"
                />
                {filteredCustomers.length > 0 && (
                  <div className="customer-search-results">
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
                {/* --- NUEVO: Botón de añadir rápido --- */}
                <button 
                  type="button" 
                  className="btn-quick-add"
                  onClick={() => setIsQuickAddOpen(true)}
                >
                  + Nuevo Cliente
                </button>
              </div>
              
              {/* --- LÓGICA CONDICIONAL DE MONTO --- */}
              <label className="payment-input-label" htmlFor="payment-amount">
                {isEfectivo ? 'Monto Recibido:' : 'Abono (Opcional):'}
              </label>
              <input
                className="payment-input"
                id="payment-amount"
                type="number"
                step="0.01"
                min="0"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                onFocus={handleAmountFocus}
                required={isEfectivo} // Solo requerido si es efectivo
              />
              
              {/* --- LÓGICA CONDICIONAL DE CAMBIO/SALDO --- */}
              {isEfectivo ? (
                <>
                  <p className="payment-label">Cambio:</p>
                  <p id="payment-change" className="payment-change">
                    ${change >= 0 ? change.toFixed(2) : '0.00'}
                  </p>
                </>
              ) : (
                <>
                  <p className="payment-label">Saldo Pendiente:</p>
                  <p id="payment-change" className="payment-saldo">
                    ${saldoPendiente.toFixed(2)}
                  </p>
                </>
              )}
            </div>
            
            {selectedCustomerId && (
              <div className="form-group-checkbox">
                <input
                  id="send-receipt-ticket"
                  type="checkbox"
                  checked={sendReceipt}
                  onChange={(e) => setSendReceipt(e.target.checked)}
                />
                <label htmlFor="send-receipt-ticket">Enviar ticket por WhatsApp</label>
              </div>
            )}

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
      
      {/* --- RENDER DEL NUEVO MODAL --- */}
      <QuickAddCustomerModal
        show={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onCustomerSaved={handleQuickCustomerSaved}
      />
    </>
  );
}