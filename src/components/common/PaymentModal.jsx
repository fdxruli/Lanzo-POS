// src/components/common/PaymentModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, STORES, db } from '../../services/database';
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
  const [initialPaymentMethod, setInitialPaymentMethod] = useState('efectivo');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState([]);

  const [sendReceipt, setSendReceipt] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [hasOverdueCredit, setHasOverdueCredit] = useState(false);

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
      setInitialPaymentMethod('efectivo');
      setSendReceipt(true);
      setIsSubmitting(false);
      setDueDate('');
      setHasOverdueCredit(false);
    }
  }, [show, total, paymentMethod]);

  // --- NUEVO: Verificación de Morosidad ---
  useEffect(() => {
    if (show && paymentMethod === 'fiado' && selectedCustomerId) {
      const checkOverdue = async () => {
        try {
          const customerSales = await db.table(STORES.SALES)
            .where('customerId').equals(selectedCustomerId)
            .toArray();

          const todayStr = new Date().toISOString().split('T')[0];

          const hasOverdue = customerSales.some(s =>
            s.paymentMethod === 'fiado' &&
            s.creditStatus === 'VIGENTE' &&
            s.dueDate &&
            s.dueDate.split('T')[0] < todayStr
          );

          setHasOverdueCredit(hasOverdue);
        } catch (error) {
          Logger.error("Error al verificar morosidad:", error);
          setHasOverdueCredit(false);
        }
      };
      checkOverdue();
    } else {
      setHasOverdueCredit(false);
    }
  }, [show, paymentMethod, selectedCustomerId]);

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
  const hasInitialCreditPayment = isFiado && safePaid.gt(0);

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

  const todayStr = new Date().toISOString().split('T')[0];
  const isDueDateValid = isFiado ? (dueDate && dueDate >= todayStr) : true;

  const canConfirm = isEfectivo
    ? safePaid.gte(safeTotal)
    : (selectedCustomerId !== null && safePaid.lte(safeTotal) && !isOverLimit && isDueDateValid);

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
        amountPaid: Money.toExactString(safePaid),
        customerId: selectedCustomerId,
        paymentMethod: paymentMethod,
        initialPaymentMethod: hasInitialCreditPayment ? initialPaymentMethod : null,
        saldoPendiente: Money.toExactString(saldoPendiente),
        sendReceipt: sendReceipt,
        dueDate: isFiado && dueDate ? new Date(dueDate).toISOString() : null
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
    setInitialPaymentMethod('efectivo');
    if (method === 'efectivo') {
      setAmountPaid(Money.toNumber(safeTotal).toFixed(2).toString());
      setDueDate('');
      setHasOverdueCredit(false);
    } else {
      setAmountPaid('');
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 15);
      setDueDate(defaultDate.toISOString().split('T')[0]);
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
            <div className="payment-grid">
              {/* COLUMNA IZQUIERDA: Contexto del Pago */}
              <div className="payment-col-left">
                <div className="payment-details">
                  <p className="payment-label">Total a Pagar:</p>
                  <p id="payment-total" className="payment-total">${Money.toNumber(safeTotal)}</p>

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

                  {isFiado && (
                    <div className="form-group payment-form-group-spaced">
                      <label className="form-label" htmlFor="due-date-input">
                        Fecha de Vencimiento:
                      </label>
                      <input
                        id="due-date-input"
                        type="date"
                        className="form-input payment-date-input"
                        value={dueDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setDueDate(e.target.value)}
                        required
                      />
                      {dueDate && dueDate < new Date().toISOString().split('T')[0] && (
                        <p className="ui-inline-error payment-inline-message">
                          La fecha de vencimiento no puede ser menor a la actual.
                        </p>
                      )}
                    </div>
                  )}

                  {isFiado && hasOverdueCredit && (
                    <div className="ui-alert ui-alert--warning payment-alert">
                      <span aria-hidden="true">⚠️</span>
                      <div>
                        <strong>Atención:</strong> Este cliente tiene saldos vencidos anteriores.
                      </div>
                    </div>
                  )}

                  <div className="form-group customer-search-wrapper payment-form-group-spaced">
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

                  {/* El checkbox de ticket puede ir en esta columna para no estorbar los botones */}
                  {selectedCustomerId && (
                    <div className="form-group-checkbox payment-form-group-spaced">
                      <input
                        id="send-receipt-ticket"
                        type="checkbox"
                        checked={sendReceipt}
                        onChange={(e) => setSendReceipt(e.target.checked)}
                      />
                      <label htmlFor="send-receipt-ticket">Enviar ticket por WhatsApp</label>
                    </div>
                  )}
                </div>
              </div>

              {/* COLUMNA DERECHA: Ejecución del Pago */}
              <div className="payment-col-right">
                <div className="payment-details">
                  <label className="payment-input-label" htmlFor="payment-amount">
                    {isEfectivo ? 'Monto Recibido:' : 'Abono (Opcional):'}
                  </label>
                  <input
                    className="payment-input"
                    id="payment-amount"
                    type="text"
                    inputMode="decimal"
                    value={amountPaid}
                    onChange={handleAmountChange}
                    onFocus={handleAmountFocus}
                    required={isEfectivo}
                    autoFocus={isEfectivo}
                  />

                  {hasInitialCreditPayment && (
                    <div className="form-group payment-initial-payment-method">
                      <label className="form-label" htmlFor="initial-payment-method">
                        Método del abono inicial:
                      </label>

                      <select
                        id="initial-payment-method"
                        className="form-input"
                        value={initialPaymentMethod}
                        onChange={(e) => setInitialPaymentMethod(e.target.value)}
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="tarjeta">Tarjeta</option>
                        <option value="transferencia">Transferencia</option>
                      </select>

                      <p className="ui-inline-help payment-inline-message payment-inline-message--helper">
                        Solo efectivo se reflejará en caja. Tarjeta y transferencia quedarán como pago sin aumentar efectivo esperado.
                      </p>
                    </div>
                  )}

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
                        className="btn-cash-option btn-cash-option-exact"
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
                        <div className={`ui-alert ${isOverLimit ? 'ui-alert--danger' : 'ui-alert--success'} payment-alert ${!isOverLimit ? 'payment-credit-available' : ''}`}>
                          {isOverLimit ? (
                            // CASO ERROR: Se pasó del límite
                            <>
                              <span aria-hidden="true">🚫</span>
                              <div>
                                <strong>Crédito Insuficiente</strong>
                                <p className="ui-alert__text">{limitMessage}</p>
                              </div>
                            </>
                          ) : (
                            // CASO OK: Muestra cuánto le queda disponible
                            <>
                              <span>Crédito disponible:</span>
                              <strong>${Money.toNumber(Money.subtract(limit, projectedDebt)).toFixed(2)}</strong>
                            </>
                          )}
                        </div>
                      )}
                      {isFiado && safePaid.gt(safeTotal) && (
                        <p className="ui-inline-error payment-inline-message">
                          El abono inicial no puede ser mayor al total.
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* Los botones de acción van al final de la columna de ejecución */}
                <div className="payment-actions">
                  <button
                    id="confirm-payment-btn"
                    className="ui-button ui-button--success payment-confirm-button"
                    type="submit"
                    disabled={!canConfirm || isSubmitting}
                  >
                    {isSubmitting ? 'Procesando...' : 'Confirmar Pago'}
                  </button>

                  <button
                    id="cancel-payment-btn"
                    className="ui-button ui-button--ghost payment-cancel-button"
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
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
