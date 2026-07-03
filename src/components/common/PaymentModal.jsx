import React, { useState, useEffect } from 'react';
import { loadData, STORES, db } from '../../services/database';
import QuickAddCustomerModal from './QuickAddCustomerModal';
import './PaymentModal.css';
import Logger from '../../services/Logger';
import { Money } from '../../utils/moneyMath';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { orderTotals } from '../../services/sales/orderTotals';

const CASH_DENOMINATIONS = [20, 50, 100, 200, 500, 1000];
const selectCurrentOrder = (state) => (state.currentOrderId ? state.activeOrders.get(state.currentOrderId) || null : null);

export default function PaymentModal({ show, onClose, onConfirm, total }) {
  const currentOrder = useActiveOrders(selectCurrentOrder);
  const [amountPaid, setAmountPaid] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [initialPaymentMethod, setInitialPaymentMethod] = useState('efectivo');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [sendReceipt, setSendReceipt] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [hasOverdueCredit, setHasOverdueCredit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeTotals = orderTotals(currentOrder || {});
  const effectiveTotal = Number(activeTotals.total || total || 0);

  useEffect(() => {
    if (show) {
      loadData(STORES.CUSTOMERS).then((customerData) => setCustomers(customerData || []));
      if (paymentMethod === 'efectivo') setAmountPaid(Money.toNumber(Money.init(effectiveTotal)).toFixed(2).toString());
      else setAmountPaid('');
      setIsSubmitting(false);
    } else {
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
  }, [show, effectiveTotal, paymentMethod]);

  useEffect(() => {
    if (show && paymentMethod === 'fiado' && selectedCustomerId) {
      const checkOverdue = async () => {
        try {
          const customerSales = await db.table(STORES.SALES).where('customerId').equals(selectedCustomerId).toArray();
          const todayStr = new Date().toISOString().split('T')[0];
          setHasOverdueCredit(customerSales.some((sale) => sale.paymentMethod === 'fiado' && sale.creditStatus === 'VIGENTE' && sale.dueDate && sale.dueDate.split('T')[0] < todayStr));
        } catch (error) {
          Logger.error('Error al verificar morosidad:', error);
          setHasOverdueCredit(false);
        }
      };
      checkOverdue();
    } else {
      setHasOverdueCredit(false);
    }
  }, [show, paymentMethod, selectedCustomerId]);

  const safeTotal = Money.init(effectiveTotal);
  let safePaid;
  try { safePaid = Money.init(amountPaid.toString().replace(',', '.') || '0'); } catch { safePaid = Money.init(0); }

  const isEfectivo = paymentMethod === 'efectivo';
  const isFiado = paymentMethod === 'fiado';
  const hasInitialCreditPayment = isFiado && safePaid.gt(0);
  const change = isEfectivo ? Money.subtract(safePaid, safeTotal) : Money.init('0');
  const saldoPendiente = isFiado ? Money.subtract(safeTotal, safePaid) : Money.init('0');
  const currentCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const limit = Money.init(currentCustomer?.creditLimit || 0);
  const currentDebt = Money.init(currentCustomer?.debt || 0);
  const projectedDebt = Money.add(currentDebt, saldoPendiente);
  const isOverLimit = isFiado && currentCustomer && (limit.eq(0) || projectedDebt.gt(limit));
  const limitMessage = limit.eq(0) ? 'Este cliente no tiene crédito autorizado.' : `Excede el límite de crédito ($${Money.toNumber(limit)}). Deuda final $${Money.toNumber(projectedDebt)}.`;
  const todayStr = new Date().toISOString().split('T')[0];
  const isDueDateValid = isFiado ? (dueDate && dueDate >= todayStr) : true;
  const canConfirm = isEfectivo ? safePaid.gte(safeTotal) : (selectedCustomerId !== null && safePaid.lte(safeTotal) && !isOverLimit && isDueDateValid);

  const handleAmountChange = (event) => {
    const val = event.target.value;
    if (val === '' || /^\d+(\.\d{0,2})?$/.test(val)) setAmountPaid(val);
  };

  const handleDenominationClick = (amount) => {
    const added = Money.init(amount);
    setAmountPaid(Money.toExactString(safePaid.eq(safeTotal) ? added : Money.add(safePaid, added)));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canConfirm || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await onConfirm({
        amountPaid: Money.toExactString(safePaid),
        customerId: selectedCustomerId,
        paymentMethod,
        initialPaymentMethod: hasInitialCreditPayment ? initialPaymentMethod : null,
        saldoPendiente: Money.toExactString(saldoPendiente),
        sendReceipt,
        dueDate: isFiado && dueDate ? new Date(dueDate).toISOString() : null,
        subtotal: activeTotals.subtotal || effectiveTotal,
        discountTotal: activeTotals.discountTotal || 0,
        discount_total: activeTotals.discountTotal || 0,
        saleDiscount: activeTotals.saleDiscount || null,
        discount: activeTotals.saleDiscount || null
      });
    } catch (error) {
      Logger.error('Error al procesar pago:', error);
      setIsSubmitting(false);
    }
  };

  const handleCustomerSearch = (event) => {
    const query = event.target.value;
    setCustomerSearch(query);
    setSelectedCustomerId(null);
    if (query.trim().length > 2) {
      setFilteredCustomers(customers.filter((customer) => customer.name.toLowerCase().includes(query.toLowerCase()) || customer.phone.includes(query)));
    } else {
      setFilteredCustomers([]);
    }
  };

  const handleCustomerClick = (customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearch(`${customer.name} - ${customer.phone}`);
    setFilteredCustomers([]);
  };

  const handleQuickCustomerSaved = (newCustomer) => {
    setCustomers((prev) => [...prev, newCustomer]);
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
  };

  if (!show) return null;

  return (
    <>
      <div id="payment-modal" className="modal" style={{ display: 'flex' }}>
        <div className="modal-content">
          <h2 className="modal-title">Procesar Pago</h2>
          <form onSubmit={handleSubmit}>
            <div className="payment-grid">
              <div className="payment-col-left">
                <div className="payment-details">
                  <p className="payment-label">Total a Pagar:</p>
                  <p id="payment-total" className="payment-total">${Money.toNumber(safeTotal)}</p>
                  {Number(activeTotals.discountTotal || 0) > 0 && <p className="payment-label">Incluye descuento: -${Number(activeTotals.discountTotal || 0).toFixed(2)}</p>}

                  <div className="form-group">
                    <label className="form-label">Método de Pago:</label>
                    <div className="payment-method-selector">
                      <button type="button" className={`btn-method ${isEfectivo ? 'active' : ''}`} onClick={() => handlePaymentMethodChange('efectivo')}>Efectivo</button>
                      <button type="button" className={`btn-method ${isFiado ? 'active' : ''}`} onClick={() => handlePaymentMethodChange('fiado')}>Fiado</button>
                    </div>
                  </div>

                  {isFiado && (
                    <div className="form-group payment-form-group-spaced">
                      <label className="form-label" htmlFor="due-date-input">Fecha de Vencimiento:</label>
                      <input id="due-date-input" type="date" className="form-input payment-date-input" value={dueDate} min={todayStr} onChange={(event) => setDueDate(event.target.value)} required />
                      {dueDate && dueDate < todayStr && <p className="ui-inline-error payment-inline-message">La fecha de vencimiento no puede ser menor a la actual.</p>}
                    </div>
                  )}

                  {isFiado && hasOverdueCredit && <div className="ui-alert ui-alert--warning payment-alert"><span>Atención: este cliente tiene saldos vencidos anteriores.</span></div>}

                  <div className="form-group customer-search-wrapper payment-form-group-spaced">
                    <label className="form-label" htmlFor="sale-customer-input">{isFiado ? 'Asignar a Cliente (Obligatorio):' : 'Asignar a Cliente (Opcional):'}</label>
                    <input className="form-input" id="sale-customer-input" type="text" placeholder="Buscar por nombre o teléfono. Introduce minumo 3 letras" value={customerSearch} onChange={handleCustomerSearch} autoComplete="off" />
                    {filteredCustomers.length > 0 && <div className="customer-search-results">{filteredCustomers.slice(0, 5).map((customer) => <div key={customer.id} className="customer-result-item" onClick={() => handleCustomerClick(customer)}>{customer.name} ({customer.phone})</div>)}</div>}
                    <button type="button" className="btn-quick-add" onClick={() => setIsQuickAddOpen(true)}>+ Nuevo Cliente</button>
                  </div>

                  {selectedCustomerId && <div className="form-group-checkbox payment-form-group-spaced"><input id="send-receipt-ticket" type="checkbox" checked={sendReceipt} onChange={(event) => setSendReceipt(event.target.checked)} /><label htmlFor="send-receipt-ticket">Enviar ticket por WhatsApp</label></div>}
                </div>
              </div>

              <div className="payment-col-right">
                <div className="payment-details">
                  <label className="payment-input-label" htmlFor="payment-amount">{isEfectivo ? 'Monto Recibido:' : 'Abono (Opcional):'}</label>
                  <input className="payment-input" id="payment-amount" type="text" inputMode="decimal" value={amountPaid} onChange={handleAmountChange} onFocus={(event) => event.target.select()} required={isEfectivo} autoFocus={isEfectivo} />

                  {hasInitialCreditPayment && <div className="form-group payment-initial-payment-method"><label className="form-label" htmlFor="initial-payment-method">Método del abono inicial:</label><select id="initial-payment-method" className="form-input" value={initialPaymentMethod} onChange={(event) => setInitialPaymentMethod(event.target.value)}><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option></select><p className="ui-inline-help payment-inline-message payment-inline-message--helper">Solo efectivo se reflejará en caja.</p></div>}

                  {isEfectivo && <div className="quick-cash-options">{CASH_DENOMINATIONS.map((amount) => <button key={amount} type="button" className="btn-cash-option" onClick={() => handleDenominationClick(amount)}>${amount}</button>)}<button type="button" className="btn-cash-option btn-cash-option-exact" onClick={() => setAmountPaid(Money.toNumber(safeTotal).toFixed(2).toString())}>Exacto (${Money.toNumber(safeTotal).toFixed(2)})</button></div>}

                  {isEfectivo ? <><p className="payment-label">Cambio:</p><p id="payment-change" className="payment-change">${change.gte(0) ? Money.toNumber(change).toFixed(2) : '0.00'}</p></> : <><p className="payment-label">Saldo Pendiente:</p><p id="payment-change" className="payment-saldo">${Money.toNumber(saldoPendiente).toFixed(2)}</p>{isFiado && currentCustomer && <div className={`ui-alert ${isOverLimit ? 'ui-alert--danger' : 'ui-alert--success'} payment-alert ${!isOverLimit ? 'payment-credit-available' : ''}`}>{isOverLimit ? <><span>Crédito insuficiente</span><p className="ui-alert__text">{limitMessage}</p></> : <><span>Crédito disponible:</span><strong>${Money.toNumber(Money.subtract(limit, projectedDebt)).toFixed(2)}</strong></>}</div>}{isFiado && safePaid.gt(safeTotal) && <p className="ui-inline-error payment-inline-message">El abono inicial no puede ser mayor al total.</p>}</>}
                </div>

                <div className="payment-actions">
                  <button id="confirm-payment-btn" className="ui-button ui-button--success payment-confirm-button" type="submit" disabled={!canConfirm || isSubmitting}>{isSubmitting ? 'Procesando...' : 'Confirmar Pago'}</button>
                  <button id="cancel-payment-btn" className="ui-button ui-button--ghost payment-cancel-button" type="button" onClick={onClose} disabled={isSubmitting}>Cancelar</button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
      {isQuickAddOpen && <QuickAddCustomerModal show={true} onClose={() => setIsQuickAddOpen(false)} onCustomerSaved={handleQuickCustomerSaved} />}
    </>
  );
}
