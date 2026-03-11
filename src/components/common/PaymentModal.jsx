// src/components/common/PaymentModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, STORES } from '../../services/database';
import QuickAddCustomerModal from './QuickAddCustomerModal';
import './PaymentModal.css';
import Logger from '../../services/Logger';
import { Money } from '../../utils/moneyMath';

const CASH_DENOMINATIONS = [20, 50, 100, 200, 500, 1000];

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
        setAmountPaid(Money.toNumber(Money.init(total)).toFixed(2).toString());
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

  const safeTotal = Money.init(total);

  let safePaid;
  try {
    const cleanInput = amountPaid.toString().replace(',', '.');
    safePaid = Money.init(cleanInput || "0");
  } catch (e) {
    safePaid = Money.init(0);
  }

  // Lógica condicional
  const isEfectivo = paymentMethod === 'efectivo';
  const isFiado = paymentMethod === 'fiado';

  // 3. Cálculos estrictos usando la API de Money (devuelven instancias Big)
  const change = isEfectivo ? Money.subtract(safePaid, safeTotal) : Money.init("0");
  const saldoPendiente = isFiado ? Money.subtract(safeTotal, safePaid) : Money.init("0");

  const currentCustomer = customers.find(c => c.id === selectedCustomerId);

  const limit = Money.init(currentCustomer?.creditLimit || 0);
  const currentDebt = Money.init(currentCustomer?.debt || 0);
  const projectedDebt = Money.add(currentDebt, saldoPendiente);

  // 4. Evaluaciones usando los comparadores seguros de Big.js (.eq, .gt, .gte, .lte)
  const isOverLimit = isFiado && currentCustomer && (limit.eq(0) || projectedDebt.gt(limit));

  const limitMessage = limit.eq(0)
    ? "Este cliente no tiene crédito autorizado."
    : `Excede el límite de crédito ($${Money.toNumber(limit)}). Deuda final $${Money.toNumber(projectedDebt)}.`;

  const canConfirm = isEfectivo
    ? safePaid.gte(safeTotal)
    : (selectedCustomerId !== null && safePaid.lte(safeTotal) && !isOverLimit);

  // Handler para el input (Control Estricto de Strings)
  const handleAmountChange = (e) => {
    const val = e.target.value;
    // Permite solo números y opcionalmente hasta dos decimales. Bloquea letras, 'e', o negativos.
    if (val === '' || /^\d+(\.\d{0,2})?$/.test(val)) {
      setAmountPaid(val);
    }
  };

  const handleAmountFocus = (e) => {
    e.target.select();
  };

  const handleDenominationClick = (amount) => {
    const added = Money.init(amount);

    // Si el input actual es exactamente igual al total (el auto-fill),
    // asumimos que el cajero está reemplazando el pago sugerido con un billete real.
    if (safePaid.eq(safeTotal)) {
      setAmountPaid(Money.toExactString(added));
    } else {
      // De lo contrario, sumamos billetes (ej. clic en $50 y luego clic en $20 = $70)
      const newTotal = Money.add(safePaid, added);
      setAmountPaid(Money.toExactString(newTotal));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canConfirm || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await onConfirm({
        // 5. OBLIGATORIO: Enviar los datos puros (strings exactos) para evitar corromper al padre
        amountPaid: Money.toExactString(safePaid),
        customerId: selectedCustomerId,
        paymentMethod: paymentMethod,
        saldoPendiente: Money.toExactString(saldoPendiente),
        sendReceipt: sendReceipt
      });
    } catch (error) {
      Logger.error("Error al procesar pago:", error);
      setIsSubmitting(false);
    }
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

  // ... (handlers handleQuickCustomerSaved y handlePaymentMethodChange sin cambios) ...
  const handleQuickCustomerSaved = (newCustomer) => {
    setCustomers(prev => [...prev, newCustomer]);
    handleCustomerClick(newCustomer);
    setIsQuickAddOpen(false);
  };

  const handlePaymentMethodChange = (method) => {
    setPaymentMethod(method);
    if (method === 'efectivo') {
      setAmountPaid(Money.toNumber(safeTotal).toFixed(2).toString());
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
              <p id="payment-total" className="payment-total">${Money.toNumber(safeTotal)}</p>

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
                type="text"           // NUNCA type="number"
                inputMode="decimal"   // Lanza el teclado numérico con punto en móviles
                value={amountPaid}
                onChange={handleAmountChange}
                onFocus={handleAmountFocus}
                required={isEfectivo}
                autoFocus={isEfectivo}
              />

              {isEfectivo && (
                <div className="quick-cash-options">
                  {CASH_DENOMINATIONS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      className="btn-cash-option"
                      onClick={() => handleDenominationClick(amount)}
                    >
                      ${amount}
                    </button>
                  ))}
                  {/* Botón extra para "Monto Exacto" si lo deseas */}
                  <button
                    type="button"
                    className="btn-cash-option"
                    style={{ gridColumn: '1 / -1', borderColor: 'var(--success-color)', color: 'var(--success-color)' }}
                    onClick={() => setAmountPaid(Money.toNumber(safeTotal).toFixed(2).toString())}
                  >
                    Exacto (${Money.toNumber(safeTotal).toFixed(2)})
                  </button>
                </div>
              )}

              {isEfectivo ? (
                <>
                  <p className="payment-label">Cambio:</p>
                  <p id="payment-change" className="payment-change">
                    ${change.gte(0) ? Money.toNumber(change).toFixed(2) : '0.00'}
                  </p>
                </>
              ) : (
                <>
                  <p className="payment-label">Saldo Pendiente:</p>
                  <p id="payment-change" className="payment-saldo">
                    ${Money.toNumber(saldoPendiente).toFixed(2)}
                  </p>
                  {/* ALERTA DE LÍMITE DE CRÉDITO */}
                  {isFiado && currentCustomer && (
                    <div style={{
                      marginTop: '10px',
                      padding: '10px',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      backgroundColor: isOverLimit ? '#fed7d7' : '#e6fffa', // Rojo si se pasa, Verde/Azul si está bien
                      color: isOverLimit ? '#c53030' : '#2c7a7b',
                      border: `1px solid ${isOverLimit ? '#feb2b2' : '#b2f5ea'}`
                    }}>
                      {isOverLimit ? (
                        // CASO ERROR: Se pasó del límite
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span>🚫</span>
                          <div>
                            <strong>Crédito Insuficiente</strong>
                            <div style={{ fontSize: '0.8em' }}>{limitMessage}</div>
                          </div>
                        </div>
                      ) : (
                        // CASO OK: Muestra cuánto le queda disponible
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Crédito disponible:</span>
                          <strong>${Money.toNumber(Money.subtract(limit, projectedDebt)).toFixed(2)}</strong>
                        </div>
                      )}
                    </div>
                  )}
                  {isFiado && safePaid.gt(safeTotal) && (
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