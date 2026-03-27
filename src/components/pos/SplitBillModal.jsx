import { useEffect, useMemo, useState } from 'react';
import { loadData, STORES } from '../../services/database';
import { Money } from '../../utils/moneyMath';
import { normalizeStock } from '../../services/db/utils';
import './SplitBillModal.css';

const SIDES = ['A', 'B'];

const toQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return normalizeStock(parsed);
};

const isUnitItem = (item) => item?.saleType === 'unit' || !item?.saleType;

const buildEqualAllocations = (order = []) => (
  (order || []).map((item) => {
    const totalQuantity = toQuantity(item?.quantity || 0);
    const quantityA = isUnitItem(item)
      ? Math.floor(totalQuantity / 2)
      : toQuantity(totalQuantity / 2);

    const quantityB = toQuantity(totalQuantity - quantityA);

    return {
      quantityA: toQuantity(quantityA),
      quantityB
    };
  })
);

const calculateTicketMath = ({ order = [], allocations = [], mode = 'manual', total = 0 }) => {
  const baseCents = { A: 0, B: 0 };

  (order || []).forEach((item, index) => {
    const allocation = allocations[index] || { quantityA: 0, quantityB: 0 };
    const quantityA = toQuantity(allocation.quantityA);
    const quantityB = toQuantity(allocation.quantityB);

    const lineTotalA = Money.multiply(item?.price || 0, quantityA);
    const lineTotalB = Money.multiply(item?.price || 0, quantityB);

    baseCents.A += Money.toCents(lineTotalA);
    baseCents.B += Money.toCents(lineTotalB);
  });

  const parentCents = Money.toCents(total || 0);
  const adjustments = { A: 0, B: 0 };

  if (mode === 'equal') {
    const targetA = Math.ceil(parentCents / 2);
    const targetB = Math.floor(parentCents / 2);
    adjustments.A = targetA - baseCents.A;
    adjustments.B = targetB - baseCents.B;
  } else {
    const remainder = parentCents - (baseCents.A + baseCents.B);
    adjustments.A = remainder;
    adjustments.B = 0;
  }

  return {
    parentCents,
    baseCents,
    adjustments,
    totalsCents: {
      A: baseCents.A + adjustments.A,
      B: baseCents.B + adjustments.B
    }
  };
};

const toMoneySafe = (value, fallback = '0') => {
  try {
    return Money.init(value ?? fallback);
  } catch {
    return Money.init(fallback);
  }
};

const formatMoneyFromCents = (cents) => Money.toNumber(Money.fromCents(cents)).toFixed(2);

const buildTicketLines = (allocations, side) => (
  (allocations || []).map((allocation, lineIndex) => {
    const quantity = side === 'A' ? toQuantity(allocation?.quantityA) : toQuantity(allocation?.quantityB);
    if (quantity <= 0) return null;
    return { lineIndex, quantity };
  }).filter(Boolean)
);

const initialPaymentsState = () => ({
  A: {
    paymentMethod: 'efectivo',
    amountPaid: '',
    customerId: '',
    sendReceipt: false
  },
  B: {
    paymentMethod: 'efectivo',
    amountPaid: '',
    customerId: '',
    sendReceipt: false
  }
});

export default function SplitBillModal({
  show,
  onClose,
  order = [],
  total = 0,
  onConfirm,
  isCajaOpen = true
}) {
  const [mode, setMode] = useState('equal');
  const [allocations, setAllocations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState(initialPaymentsState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!show) return;

    const equalAllocations = buildEqualAllocations(order);
    const initialMath = calculateTicketMath({
      order,
      allocations: equalAllocations,
      mode: 'equal',
      total
    });

    setMode('equal');
    setAllocations(equalAllocations);
    setPayments({
      A: {
        paymentMethod: 'efectivo',
        amountPaid: formatMoneyFromCents(initialMath.totalsCents.A),
        customerId: '',
        sendReceipt: false
      },
      B: {
        paymentMethod: 'efectivo',
        amountPaid: formatMoneyFromCents(initialMath.totalsCents.B),
        customerId: '',
        sendReceipt: false
      }
    });
    setIsSubmitting(false);

    const fetchCustomers = async () => {
      const customerData = await loadData(STORES.CUSTOMERS);
      setCustomers(customerData || []);
    };

    fetchCustomers();
  }, [show, order, total]);

  const ticketMath = useMemo(() => calculateTicketMath({ order, allocations, mode, total }), [order, allocations, mode, total]);

  const splitValidationError = useMemo(() => {
    if (!Array.isArray(order) || order.length === 0) {
      return 'No hay productos para dividir.';
    }

    let hasA = false;
    let hasB = false;

    for (let index = 0; index < order.length; index += 1) {
      const item = order[index];
      const allocation = allocations[index] || { quantityA: 0, quantityB: 0 };

      const totalQuantity = toQuantity(item?.quantity || 0);
      const quantityA = toQuantity(allocation.quantityA);
      const quantityB = toQuantity(allocation.quantityB);

      if (toQuantity(quantityA + quantityB) !== totalQuantity) {
        return `La línea ${index + 1} no está balanceada.`;
      }

      if (quantityA > 0) hasA = true;
      if (quantityB > 0) hasB = true;
    }

    if (!hasA || !hasB) {
      return 'Cada ticket debe tener al menos un producto.';
    }

    if (ticketMath.totalsCents.A + ticketMath.totalsCents.B !== ticketMath.parentCents) {
      return 'Los totales A/B no cuadran con la orden padre.';
    }

    if (!isCajaOpen && (payments.A.paymentMethod === 'efectivo' || payments.B.paymentMethod === 'efectivo')) {
      return 'Necesitas una caja abierta para cobrar tickets en efectivo.';
    }

    const debtAccumulator = new Map();

    for (const side of SIDES) {
      const ticketTotal = Money.fromCents(ticketMath.totalsCents[side]);
      const payment = payments[side];
      const paid = toMoneySafe(payment.amountPaid, '0');

      if (paid.lt(0)) {
        return `Monto inválido en ticket ${side}.`;
      }

      if (payment.paymentMethod === 'efectivo') {
        if (paid.lt(ticketTotal)) {
          return `El ticket ${side} en efectivo requiere monto completo.`;
        }
        continue;
      }

      if (!payment.customerId) {
        return `El ticket ${side} a fiado requiere cliente.`;
      }

      if (paid.gt(ticketTotal)) {
        return `El abono del ticket ${side} no puede ser mayor al total.`;
      }

      const customer = customers.find((candidate) => candidate.id === payment.customerId);
      if (!customer) {
        return `Cliente inválido en ticket ${side}.`;
      }

      const saldo = Money.subtract(ticketTotal, paid);
      const currentDebt = toMoneySafe(customer.debt, '0');
      const limit = toMoneySafe(customer.creditLimit, '0');
      const pending = debtAccumulator.get(customer.id) || Money.init(0);
      const projected = Money.add(Money.add(currentDebt, pending), saldo);

      if (limit.eq(0) || projected.gt(limit)) {
        return `El ticket ${side} excede el límite de crédito de ${customer.name}.`;
      }

      debtAccumulator.set(customer.id, Money.add(pending, saldo));
    }

    return null;
  }, [order, allocations, ticketMath, payments, customers, isCajaOpen]);

  const updateQuantity = (lineIndex, side, value) => {
    setAllocations((previous) => {
      const next = [...previous];
      const current = next[lineIndex] || { quantityA: 0, quantityB: 0 };
      const item = order[lineIndex];
      const totalQuantity = toQuantity(item?.quantity || 0);
      const isUnit = isUnitItem(item);

      const parsedValue = toQuantity(value);
      const clamped = Math.min(parsedValue, totalQuantity);
      const safeValue = isUnit ? Math.round(clamped) : clamped;

      if (side === 'A') {
        const quantityA = toQuantity(safeValue);
        const quantityB = toQuantity(totalQuantity - quantityA);
        next[lineIndex] = { ...current, quantityA, quantityB };
      } else {
        const quantityB = toQuantity(safeValue);
        const quantityA = toQuantity(totalQuantity - quantityB);
        next[lineIndex] = { ...current, quantityA, quantityB };
      }

      return next;
    });
  };

  const updatePayment = (side, field, value) => {
    setPayments((previous) => ({
      ...previous,
      [side]: {
        ...previous[side],
        [field]: value
      }
    }));
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    if (nextMode === 'equal') {
      setAllocations(buildEqualAllocations(order));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (splitValidationError || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        mode,
        tickets: SIDES.map((side) => {
          const ticketTotal = Money.fromCents(ticketMath.totalsCents[side]);
          const paidInput = toMoneySafe(payments[side].amountPaid || 0, '0');
          const amountPaid = payments[side].paymentMethod === 'efectivo'
            ? (paidInput.gt(ticketTotal) ? ticketTotal : paidInput)
            : paidInput;

          const saldoPendiente = payments[side].paymentMethod === 'fiado'
            ? Money.subtract(ticketTotal, amountPaid)
            : Money.init(0);

          return {
            label: side,
            paymentData: {
              paymentMethod: payments[side].paymentMethod,
              amountPaid: Money.toExactString(amountPaid),
              saldoPendiente: Money.toExactString(saldoPendiente),
              customerId: payments[side].customerId || null,
              sendReceipt: Boolean(payments[side].sendReceipt)
            },
            lines: buildTicketLines(allocations, side)
          };
        })
      };

      await onConfirm(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!show) return null;

  return (
    <div
      className="modal"
      style={{ display: 'flex', zIndex: 10040 }}
      onClick={onClose}
      role="button"
      tabIndex={0}
      aria-label="Cerrar modal de split bill"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          onClose();
        }
      }}
    >
      <div
        className="modal-content split-bill-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Split bill A/B"
      >
        <h2>Split Bill A/B</h2>

        <div className="split-mode-row">
          <button
            type="button"
            className={`btn-method ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => handleModeChange('manual')}
          >
            Manual
          </button>
          <button
            type="button"
            className={`btn-method ${mode === 'equal' ? 'active' : ''}`}
            onClick={() => handleModeChange('equal')}
          >
            Equitativo
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="split-lines-table-wrap">
            <table className="split-lines-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Total</th>
                  <th>Ticket A</th>
                  <th>Ticket B</th>
                </tr>
              </thead>
              <tbody>
                {order.map((item, index) => {
                  const allocation = allocations[index] || { quantityA: 0, quantityB: 0 };
                  const step = isUnitItem(item) ? '1' : '0.0001';
                  const totalQuantity = toQuantity(item.quantity || 0);

                  return (
                    <tr key={`${item.id || 'line'}-${index}`}>
                      <td>
                        <div className="split-line-name">{item.name}</div>
                        <div className="split-line-price">${Money.toNumber(item.price || 0).toFixed(2)} c/u</div>
                      </td>
                      <td>{totalQuantity}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={totalQuantity}
                          step={step}
                          value={allocation.quantityA}
                          onChange={(event) => updateQuantity(index, 'A', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={totalQuantity}
                          step={step}
                          value={allocation.quantityB}
                          onChange={(event) => updateQuantity(index, 'B', event.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="split-summary-grid">
            {SIDES.map((side) => {
              const ticketTotalCents = ticketMath.totalsCents[side];
              const adjustment = ticketMath.adjustments[side];
              const payment = payments[side];

              return (
                <div key={side} className="split-ticket-card">
                  <h3>Ticket {side}</h3>
                  <p className="split-ticket-total">${formatMoneyFromCents(ticketTotalCents)}</p>
                  <p className="split-ticket-adjustment">
                    Ajuste contable: {adjustment >= 0 ? '+' : ''}${formatMoneyFromCents(adjustment)}
                  </p>

                  <label>
                    Método de pago
                    <select
                      value={payment.paymentMethod}
                      onChange={(event) => updatePayment(side, 'paymentMethod', event.target.value)}
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="fiado">Fiado</option>
                    </select>
                  </label>

                  <label>
                    {payment.paymentMethod === 'efectivo' ? 'Monto recibido' : 'Abono'}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={payment.amountPaid}
                      onChange={(event) => updatePayment(side, 'amountPaid', event.target.value)}
                    />
                  </label>

                  {payment.paymentMethod === 'fiado' && (
                    <label>
                      Cliente
                      <select
                        value={payment.customerId}
                        onChange={(event) => updatePayment(side, 'customerId', event.target.value)}
                      >
                        <option value="">Selecciona cliente</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name} ({customer.phone})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="split-receipt-toggle">
                    <input
                      type="checkbox"
                      checked={payment.sendReceipt}
                      onChange={(event) => updatePayment(side, 'sendReceipt', event.target.checked)}
                      disabled={payment.paymentMethod === 'fiado' && !payment.customerId}
                    />
                    Enviar ticket por WhatsApp
                  </label>
                </div>
              );
            })}
          </div>

          {splitValidationError && (
            <p className="split-validation-error">{splitValidationError}</p>
          )}

          <div className="split-actions">
            <button type="submit" className="btn btn-confirm" disabled={Boolean(splitValidationError) || isSubmitting}>
              {isSubmitting ? 'Procesando...' : 'Confirmar Split y Cobro'}
            </button>
            <button type="button" className="btn btn-cancel-payment" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

