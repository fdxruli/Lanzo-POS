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

  // --- 1. NUEVO: Estado para bloquear doble clic ---
  const [isSubmitting, setIsSubmitting] = useState(false); 

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
      } else {
        setAmountPaid('');
      }
      // --- 2. NUEVO: Asegurarnos de desbloquear al abrir ---
      setIsSubmitting(false);
    } else {
      // Limpiar al cerrar
      setAmountPaid('');
      setSelectedCustomerId(null);
      setCustomerSearch('');
      setFilteredCustomers([]);
      setPaymentMethod('efectivo');
      setSendReceipt(true);
      setIsSubmitting(false);
    }
  }, [show, total, paymentMethod]); 

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
    ? (paid >= total)
    : (selectedCustomerId !== null && paid <= total);

  const handleAmountFocus = (e) => {
    e.target.select();
  };

  const handleCustomerSearch = (e) => {
    // ... (sin cambios)
    const query = e.target.value;
    setCustomerSearch(query);
    setSelectedCustomerId(null);

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

  // --- 3. NUEVO: Handler protegido contra doble clic ---
  const handleSubmit = async (e) => { // Hacemos la función async
    e.preventDefault();
    
    // Si ya se está enviando o no es válido, detenemos aquí
    if (!canConfirm || isSubmitting) return;

    // Bloqueamos el botón inmediatamente
    setIsSubmitting(true);

    try {
        // Esperamos a que la función del padre termine (o inicie el proceso)
        await onConfirm({
          amountPaid: paid, 
          customerId: selectedCustomerId,
          paymentMethod: paymentMethod, 
          saldoPendiente: saldoPendiente, 
          sendReceipt: sendReceipt
        });
        
        // Nota: No desbloqueamos aquí con setIsSubmitting(false) porque
        // si tiene éxito, el modal se desmontará/cerrará desde el padre.
    } catch (error) {
        console.error("Error al procesar pago:", error);
        // Solo si falla y el modal sigue abierto, desbloqueamos para reintentar
        setIsSubmitting(false); 
    }
  };

  // ... (handlers handleQuickCustomerSaved y handlePaymentMethodChange sin cambios) ...
  const handleQuickCustomerSaved = (newCustomer) => {
    setCustomers(prev => [...prev, newCustomer]);
    handleCustomerClick(newCustomer);
    setIsQuickAddOpen(false);
  };

  const handlePaymentMethodChange = (method) => {
    setPaymentMethod(method);
    if (method === 'efectivo') {
      setAmountPaid(total.toFixed(2)); 
    } else {
      setAmountPaid(''); 
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

              {/* ... (Selector de método y Buscador de cliente sin cambios) ... */}
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
                <button
                  type="button"
                  className="btn-quick-add"
                  onClick={() => setIsQuickAddOpen(true)}
                >
                  + Nuevo Cliente
                </button>
              </div>

              {/* ... (Inputs de monto y cambio sin cambios) ... */}
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
                required={isEfectivo} 
              />

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
                  {isFiado && paid > total && (
                    <p style={{ color: 'var(--error-color)', fontSize: '0.8rem', marginTop: '5px' }}>
                      El abono inicial no puede ser mayor al total.
                    </p>
                  )}
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

            {/* --- 4. NUEVO: Botón protegido --- */}
            <button
              id="confirm-payment-btn"
              className="btn btn-confirm"
              type="submit"
              disabled={!canConfirm || isSubmitting} // Deshabilitado si está enviando
              style={isSubmitting ? { opacity: 0.7, cursor: 'wait' } : {}}
            >
              {isSubmitting ? 'Procesando...' : 'Confirmar Pago'}
            </button>
            
            <button
              id="cancel-payment-btn"
              className="btn btn-cancel-payment"
              type="button"
              onClick={onClose}
              disabled={isSubmitting} // También deshabilitamos cancelar durante el envío
            >
              Cancelar
            </button>
          </form>
        </div>
      </div>
      {/* Corrección menor: En tu código original usabas 'isQuickAddOpen' para este modal, asegúrate de mantener esa coherencia */}
      {isQuickAddOpen && (
        <QuickAddCustomerModal
            show={true}
            onClose={() => setIsQuickAddOpen(false)}
            onCustomerSaved={handleQuickCustomerSaved}
        />
      )}
    </>
  );
}