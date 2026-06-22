import { useEffect, useMemo, useState, useCallback } from 'react';
import { loadData, STORES } from '../../services/database';
import { Money } from '../../utils/moneyMath';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { normalizeStock } from '../../services/db/utils';
import './SplitBillModal.css';

const MIN_TICKETS = 2;
const MAX_TICKETS = 8;

const toQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return normalizeStock(parsed);
};

const isUnitItem = (item) => item?.saleType === 'unit' || !item?.saleType;

/**
 * Generate ticket labels: T1, T2, T3... (avoiding A/B bias)
 * @param {number} count - Number of tickets
 * @returns {string[]} Array of labels
 */
const generateTicketLabels = (count) =>
  Array.from({ length: count }, (_, i) => `T${i + 1}`);

/**
 * Build equal allocations for N tickets.
 * All products start in the Pool (unassigned), not auto-distributed.
 * @param {Array} order - Order items
 * @param {number} ticketCount - Number of tickets
 * @returns {Array} Allocations array with pool quantities
 */
const buildEqualAllocations = (order = [], ticketCount = 2) => {
  if (ticketCount < MIN_TICKETS) ticketCount = MIN_TICKETS;
  if (ticketCount > MAX_TICKETS) ticketCount = MAX_TICKETS;

  return (order || []).map((item) => {
    const totalQuantity = toQuantity(item?.quantity || 0);

    // All quantity starts in pool
    return {
      poolQuantity: totalQuantity,
      ticketQuantities: Array(ticketCount).fill(0)
    };
  });
};

/**
 * Calculate ticket totals and adjustments for N tickets.
 * @param {Object} params
 * @returns {Object} Math results for all tickets
 */
const calculateTicketMath = ({ order = [], allocations = [], mode = 'manual', total = 0 }) => {
  const ticketCount = allocations[0]?.ticketQuantities?.length || MIN_TICKETS;
  const baseCents = Array(ticketCount).fill(0);

  (order || []).forEach((item, index) => {
    const allocation = allocations[index];
    if (!allocation) return;

    const price = item?.price || 0;

    allocation.ticketQuantities.forEach((qty, ticketIdx) => {
      const lineTotal = Money.multiply(price, qty);
      baseCents[ticketIdx] += Money.toCents(lineTotal);
    });
  });

  const parentCents = Money.toCents(total || 0);
  const adjustments = Array(ticketCount).fill(0);

  if (mode === 'equal') {
    // Distribute remainder to first tickets
    const basePerTicket = Math.floor(parentCents / ticketCount);
    const remainder = parentCents % ticketCount;

    baseCents.forEach((base, idx) => {
      const target = basePerTicket + (idx < remainder ? 1 : 0);
      adjustments[idx] = target - base;
    });
  } else {
    // Manual: remainder goes to first ticket
    const totalBase = baseCents.reduce((a, b) => a + b, 0);
    adjustments[0] = parentCents - totalBase;
  }

  return {
    parentCents,
    baseCents,
    adjustments,
    totalsCents: baseCents.map((base, idx) => base + adjustments[idx]),
    ticketCount
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

/**
 * Build ticket lines for a specific ticket index.
 * @param {Array} allocations - Full allocations array
 * @param {number} ticketIdx - Ticket index
 * @returns {Array} Line items for the ticket
 */
const buildTicketLines = (allocations, ticketIdx) =>
  (allocations || [])
    .map((allocation, lineIndex) => {
      const quantity = toQuantity(allocation?.ticketQuantities?.[ticketIdx] || 0);
      if (quantity <= 0) return null;
      return { lineIndex, quantity };
    })
    .filter(Boolean);

/**
 * Initialize payments state for N tickets.
 * @param {number} count - Number of tickets
 * @param {number[]} totalsCents - Initial totals per ticket
 * @returns {Object} Payments state
 */
const initialPaymentsState = (count, totalsCents = []) => {
  const state = {};
  const labels = generateTicketLabels(count);

  labels.forEach((label, idx) => {
    state[label] = {
      paymentMethod: 'efectivo',
      amountPaid: formatMoneyFromCents(totalsCents[idx] || 0),
      customerId: '',
      sendReceipt: false
    };
  });

  return state;
};

export default function SplitBillModal({
  show,
  onClose,
  order = [],
  total = 0,
  onConfirm,
  isCajaOpen = true
}) {
  const [splitCount, setSplitCount] = useState(2);
  const [mode, setMode] = useState('manual');
  const [allocations, setAllocations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const ticketLabels = useMemo(() => generateTicketLabels(splitCount), [splitCount]);

  // Initialize modal state when shown
  useEffect(() => {
    if (!show) return;

    const initialAllocations = buildEqualAllocations(order, splitCount);
    const initialMath = calculateTicketMath({
      order,
      allocations: initialAllocations,
      mode: 'manual',
      total
    });

    setMode('manual');
    setAllocations(initialAllocations);
    setPayments(initialPaymentsState(splitCount, initialMath.totalsCents));
    setIsSubmitting(false);

    const fetchCustomers = async () => {
      const customerData = await loadData(STORES.CUSTOMERS);
      setCustomers(customerData || []);
    };

    fetchCustomers();
  }, [show, order, total, splitCount]);

  // Recalculate when splitCount changes
  useEffect(() => {
    if (!show || allocations.length === 0) return;

    // Rebuild allocations for new ticket count, preserving pool
    const newAllocations = order.map((item, idx) => {
      const current = allocations[idx];
      const totalQuantity = toQuantity(item?.quantity || 0);

      // Sum currently assigned quantities
      const currentlyAssigned = current?.ticketQuantities
        ? current.ticketQuantities.reduce((a, b) => a + b, 0)
        : 0;

      const poolQuantity = toQuantity(totalQuantity - currentlyAssigned);

      // Resize ticket quantities array
      const newTicketQuantities = Array(splitCount).fill(0);
      if (current?.ticketQuantities) {
        current.ticketQuantities.forEach((qty, i) => {
          if (i < splitCount) newTicketQuantities[i] = qty;
        });
      }

      return {
        poolQuantity,
        ticketQuantities: newTicketQuantities
      };
    });

    setAllocations(newAllocations);
  }, [splitCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticketMath = useMemo(
    () => calculateTicketMath({ order, allocations, mode, total }),
    [order, allocations, mode, total]
  );

  // Update payment amounts when totals change
  useEffect(() => {
    if (!show) return;

    setPayments((prev) => {
      const newPayments = {};
      ticketLabels.forEach((label, idx) => {
        const current = prev[label] || {};
        const newTotal = formatMoneyFromCents(ticketMath.totalsCents[idx] || 0);
        
        newPayments[label] = {
          ...current,
          amountPaid: current.paymentMethod === 'fiado' ? current.amountPaid : newTotal
        };
      });
      return newPayments;
    });
  }, [ticketMath.totalsCents, ticketLabels, show]);

  /**
   * Validation for N-way split.
   * Validates: pool empty, each ticket has items, totals match, credit limits.
   */
  const splitValidationError = useMemo(() => {
    if (!Array.isArray(order) || order.length === 0) {
      return 'No hay productos para dividir.';
    }

    const ticketCount = ticketLabels.length;

    // Check pool is empty (all items assigned)
    for (let index = 0; index < order.length; index += 1) {
      const item = order[index];
      const allocation = allocations[index];

      if (!allocation) continue;

      const totalQuantity = toQuantity(item?.quantity || 0);
      const assigned = allocation.ticketQuantities.reduce((a, b) => a + b, 0);

      if (toQuantity(assigned) !== totalQuantity) {
        return `El producto "${item.name}" tiene cantidad sin asignar en el Pool.`;
      }
    }

    // Check each ticket has at least one item
    for (let t = 0; t < ticketCount; t++) {
      const hasItems = allocations.some((alloc) =>
        toQuantity(alloc?.ticketQuantities?.[t] || 0) > 0
      );
      if (!hasItems) {
        return `El Ticket ${ticketLabels[t]} debe tener al menos un producto.`;
      }
    }

    // Verify totals sum correctly
    const totalChildren = ticketMath.totalsCents.reduce((a, b) => a + b, 0);
    if (totalChildren !== ticketMath.parentCents) {
      return 'Los totales de los tickets no cuadran con la orden padre.';
    }

    // Payment validation with debt accumulator
    const debtAccumulator = new Map();

    for (let t = 0; t < ticketCount; t++) {
      const label = ticketLabels[t];
      const ticketTotal = Money.fromCents(ticketMath.totalsCents[t]);
      const payment = payments[label];

      if (!payment) {
        return `Configuración de pago faltante para ticket ${label}.`;
      }

      const paid = toMoneySafe(payment.amountPaid, '0');

      if (paid.lt(0)) {
        return `Monto inválido en ticket ${label}.`;
      }

      if (payment.paymentMethod === 'efectivo') {
        if (paid.lt(ticketTotal)) {
          return `El ticket ${label} en efectivo requiere monto completo.`;
        }
        continue;
      }

      if (payment.paymentMethod === 'fiado') {
        if (!payment.customerId) {
          return `El ticket ${label} a fiado requiere cliente.`;
        }

        if (paid.gt(ticketTotal)) {
          return `El abono del ticket ${label} no puede ser mayor al total.`;
        }

        const customer = customers.find((c) => c.id === payment.customerId);
        if (!customer) {
          return `Cliente inválido en ticket ${label}.`;
        }

        const saldo = Money.subtract(ticketTotal, paid);
        const currentDebt = toMoneySafe(customer.debt, '0');
        const limit = toMoneySafe(customer.creditLimit, '0');
        const pending = debtAccumulator.get(customer.id) || Money.init(0);
        const projected = Money.add(Money.add(currentDebt, pending), saldo);

        if (limit.eq(0) || projected.gt(limit)) {
          return `El ticket ${label} excede el límite de crédito de ${customer.name}.`;
        }

        debtAccumulator.set(customer.id, Money.add(pending, saldo));
      }
    }

    return null;
  }, [order, allocations, ticketLabels, ticketMath, payments, customers]);

  const willAutoOpenCaja = useMemo(() => (
    !isCajaOpen &&
    ticketLabels.some((label) => payments[label]?.paymentMethod === 'efectivo')
  ), [isCajaOpen, payments, ticketLabels]);

  /**
   * Move quantity from Pool to a specific ticket.
   * @param {number} lineIndex - Product line index
   * @param {number} ticketIdx - Ticket index to add to
   * @param {number} delta - Amount to move (positive)
   */
  const moveToTicket = useCallback((lineIndex, ticketIdx, delta) => {
    setAllocations((prev) => {
      const next = [...prev];
      const current = next[lineIndex];
      if (!current) return prev;

      const poolQty = toQuantity(current.poolQuantity);
      const moveQty = Math.min(delta, poolQty);

      if (moveQty <= 0) return prev;

      const newTicketQuantities = [...current.ticketQuantities];
      newTicketQuantities[ticketIdx] = toQuantity(newTicketQuantities[ticketIdx] + moveQty);

      next[lineIndex] = {
        ...current,
        poolQuantity: toQuantity(poolQty - moveQty),
        ticketQuantities: newTicketQuantities
      };

      return next;
    });
  }, []);

  /**
   * Move quantity from a ticket back to Pool.
   * @param {number} lineIndex - Product line index
   * @param {number} ticketIdx - Ticket index to remove from
   * @param {number} delta - Amount to move (positive)
   */
  const moveToPool = useCallback((lineIndex, ticketIdx, delta) => {
    setAllocations((prev) => {
      const next = [...prev];
      const current = next[lineIndex];
      if (!current) return prev;

      const ticketQty = toQuantity(current.ticketQuantities[ticketIdx]);
      const moveQty = Math.min(delta, ticketQty);

      if (moveQty <= 0) return prev;

      const newTicketQuantities = [...current.ticketQuantities];
      newTicketQuantities[ticketIdx] = toQuantity(ticketQty - moveQty);

      next[lineIndex] = {
        ...current,
        poolQuantity: toQuantity(current.poolQuantity + moveQty),
        ticketQuantities: newTicketQuantities
      };

      return next;
    });
  }, []);

  /**
   * Move all remaining quantity from Pool to a specific ticket.
   * @param {number} lineIndex - Product line index
   * @param {number} ticketIdx - Ticket index
   */
  const moveAllToTicket = useCallback((lineIndex, ticketIdx) => {
    setAllocations((prev) => {
      const next = [...prev];
      const current = next[lineIndex];
      if (!current) return prev;

      const poolQty = toQuantity(current.poolQuantity);
      if (poolQty <= 0) return prev;

      const newTicketQuantities = [...current.ticketQuantities];
      newTicketQuantities[ticketIdx] = toQuantity(newTicketQuantities[ticketIdx] + poolQty);

      next[lineIndex] = {
        ...current,
        poolQuantity: 0,
        ticketQuantities: newTicketQuantities
      };

      return next;
    });
  }, []);

  /**
   * Move all quantity from a ticket back to Pool.
   * @param {number} lineIndex - Product line index
   * @param {number} ticketIdx - Ticket index
   */
  const moveAllToPool = useCallback((lineIndex, ticketIdx) => {
    setAllocations((prev) => {
      const next = [...prev];
      const current = next[lineIndex];
      if (!current) return prev;

      const ticketQty = toQuantity(current.ticketQuantities[ticketIdx]);
      if (ticketQty <= 0) return prev;

      const newTicketQuantities = [...current.ticketQuantities];
      newTicketQuantities[ticketIdx] = 0;

      next[lineIndex] = {
        ...current,
        poolQuantity: toQuantity(current.poolQuantity + ticketQty),
        ticketQuantities: newTicketQuantities
      };

      return next;
    });
  }, []);

  const updatePayment = (label, field, value) => {
    setPayments((prev) => ({
      ...prev,
      [label]: {
        ...prev[label],
        [field]: value
      }
    }));
  };

  const handleSplitCountChange = (newCount) => {
    const count = Math.max(MIN_TICKETS, Math.min(MAX_TICKETS, Number(newCount) || MIN_TICKETS));
    setSplitCount(count);
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    if (nextMode === 'equal') {
      // Auto-distribute pool equally among all tickets
      setAllocations((prev) =>
        prev.map((alloc) => {
          const total = toQuantity(alloc.poolQuantity) +
            alloc.ticketQuantities.reduce((a, b) => a + b, 0);
          const perTicket = Math.floor(total / splitCount);
          const remainder = total % splitCount;

          const newTicketQuantities = Array(splitCount).fill(perTicket);
          // Add remainder to first tickets
          for (let i = 0; i < remainder; i++) {
            newTicketQuantities[i] += 1;
          }

          return {
            poolQuantity: 0,
            ticketQuantities: newTicketQuantities
          };
        })
      );
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
        tickets: ticketLabels.map((label, idx) => {
          const ticketTotal = Money.fromCents(ticketMath.totalsCents[idx]);
          const paidInput = toMoneySafe(payments[label]?.amountPaid || 0, '0');
          const amountPaid = payments[label]?.paymentMethod === 'efectivo'
            ? (paidInput.gt(ticketTotal) ? ticketTotal : paidInput)
            : paidInput;

          const saldoPendiente = payments[label]?.paymentMethod === 'fiado'
            ? Money.subtract(ticketTotal, amountPaid)
            : Money.init(0);

          return {
            label,
            paymentData: {
              paymentMethod: payments[label]?.paymentMethod,
              amountPaid: Money.toExactString(amountPaid),
              saldoPendiente: Money.toExactString(saldoPendiente),
              customerId: payments[label]?.customerId || null,
              sendReceipt: Boolean(payments[label]?.sendReceipt)
            },
            lines: buildTicketLines(allocations, idx)
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
      style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}
      onClick={onClose}
      role="button"
      tabIndex={0}
      aria-label="Cerrar modal de dividir cuenta"
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
        aria-label="Dividir cuenta"
        style={{ maxWidth: '1200px', width: '95%' }}
      >
        <h2>Dividir Cuenta</h2>

        <div className="split-controls-row">
          <div className="split-count-selector">
            <label htmlFor="splitCount">Número de tickets:</label>
            <select
              id="splitCount"
              value={splitCount}
              onChange={(e) => handleSplitCountChange(e.target.value)}
              disabled={isSubmitting}
            >
              {Array.from({ length: MAX_TICKETS - MIN_TICKETS + 1 }, (_, i) => i + MIN_TICKETS).map(
                (num) => (
                  <option key={num} value={num}>
                    {num} tickets
                  </option>
                )
              )}
            </select>
          </div>

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
        </div>

        <form onSubmit={handleSubmit}>
          {/* Main Content: Pool + Tickets Grid */}
          <div className="split-main-content">
            {/* Pool Section */}
            <div className="split-pool-section">
              <h3>Pool de Productos (Por Asignar)</h3>
              <div className="split-pool-list">
                {order.map((item, index) => {
                  const allocation = allocations[index];
                  if (!allocation) return null;

                  const poolQty = toQuantity(allocation.poolQuantity);
                  const totalQty = toQuantity(item.quantity || 0);
                  const step = isUnitItem(item) ? 1 : 0.0001;

                  // If fully assigned, show as completed
                  if (poolQty <= 0) {
                    return (
                      <div key={getCartLineId(item, index)} className="split-pool-item completed">
                        <div className="split-pool-item-info">
                          <span className="split-pool-item-name">{item.name}</span>
                          <span className="split-pool-item-price">
                            ${Money.toNumber(item.price || 0).toFixed(2)} c/u
                          </span>
                        </div>
                        <div className="split-pool-item-status">✓ Asignado</div>
                      </div>
                    );
                  }

                  return (
                    <div key={getCartLineId(item, index)} className="split-pool-item">
                      <div className="split-pool-item-info">
                        <span className="split-pool-item-name">{item.name}</span>
                        <span className="split-pool-item-price">
                          ${Money.toNumber(item.price || 0).toFixed(2)} c/u
                        </span>
                        <span className="split-pool-item-qty">
                          Disponible: {poolQty} / {totalQty}
                        </span>
                      </div>
                      <div className="split-pool-item-actions">
                        {ticketLabels.map((label, tIdx) => (
                          <button
                            key={label}
                            type="button"
                            className="btn-pool-move"
                            onClick={() => moveToTicket(index, tIdx, step)}
                            disabled={poolQty < step || isSubmitting}
                            title={`Mover a ${label}`}
                          >
                            → {label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn-pool-move-all"
                          onClick={() => {
                            // Distribute to first ticket with capacity, or first available
                            for (let t = 0; t < ticketLabels.length; t++) {
                              if (poolQty > 0) {
                                moveAllToTicket(index, t);
                                break;
                              }
                            }
                          }}
                          disabled={poolQty <= 0 || isSubmitting}
                        >
                          Todo →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tickets Grid */}
            <div className="split-tickets-grid">
              {ticketLabels.map((label, tIdx) => {
                const ticketTotalCents = ticketMath.totalsCents[tIdx];
                const adjustment = ticketMath.adjustments[tIdx];
                const payment = payments[label] || {};

                // Calculate items in this ticket
                const ticketItems = order
                  .map((item, idx) => ({
                    item,
                    qty: toQuantity(allocations[idx]?.ticketQuantities?.[tIdx] || 0),
                    lineIndex: idx
                  }))
                  .filter((x) => x.qty > 0);

                return (
                  <div key={label} className="split-ticket-card">
                    <div className="split-ticket-header">
                      <h3>Ticket {label}</h3>
                      <p className="split-ticket-total">
                        ${formatMoneyFromCents(ticketTotalCents)}
                      </p>
                      {adjustment !== 0 && (
                        <p className="split-ticket-adjustment">
                          Ajuste: {adjustment >= 0 ? '+' : ''}${formatMoneyFromCents(adjustment)}
                        </p>
                      )}
                    </div>

                    <div className="split-ticket-items">
                      {ticketItems.length === 0 ? (
                        <p className="split-ticket-empty">Sin productos</p>
                      ) : (
                        ticketItems.map(({ item, qty, lineIndex }) => (
                          <div key={lineIndex} className="split-ticket-item">
                            <span className="split-ticket-item-name">{item.name}</span>
                            <span className="split-ticket-item-qty">× {qty}</span>
                            <button
                              type="button"
                              className="btn-item-remove"
                              onClick={() => moveToPool(lineIndex, tIdx, isUnitItem(item) ? 1 : 0.0001)}
                              disabled={isSubmitting}
                              title="Quitar uno"
                            >
                              −
                            </button>
                            <button
                              type="button"
                              className="btn-item-remove-all"
                              onClick={() => moveAllToPool(lineIndex, tIdx)}
                              disabled={isSubmitting}
                              title="Quitar todo"
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="split-ticket-payment">
                      <label>
                        Método de pago
                        <select
                          value={payment.paymentMethod}
                          onChange={(e) => {
                            const newMethod = e.target.value;
                            updatePayment(label, 'paymentMethod', newMethod);
                            if (newMethod === 'fiado') {
                              updatePayment(label, 'amountPaid', '0');
                            } else {
                              updatePayment(label, 'amountPaid', formatMoneyFromCents(ticketMath.totalsCents[tIdx] || 0));
                            }
                          }}
                          disabled={isSubmitting}
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
                          value={payment.amountPaid || '0'}
                          onChange={(e) => updatePayment(label, 'amountPaid', e.target.value)}
                          disabled={isSubmitting}
                        />
                      </label>

                      {payment.paymentMethod === 'fiado' && (
                        <label>
                          Cliente
                          <select
                            value={payment.customerId || ''}
                            onChange={(e) => updatePayment(label, 'customerId', e.target.value)}
                            disabled={isSubmitting}
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
                          checked={payment.sendReceipt || false}
                          onChange={(e) => updatePayment(label, 'sendReceipt', e.target.checked)}
                          disabled={payment.paymentMethod === 'fiado' && !payment.customerId}
                        />
                        Enviar ticket por WhatsApp
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {splitValidationError && (
            <p className="split-validation-error">{splitValidationError}</p>
          )}

          {!splitValidationError && willAutoOpenCaja && (
            <p className="split-validation-warning">
              La caja se abrirá automáticamente al confirmar el cobro en efectivo.
            </p>
          )}

          <div className="split-actions">
            <button
              type="submit"
              className="btn btn-confirm"
              disabled={Boolean(splitValidationError) || isSubmitting}
            >
              {isSubmitting ? 'Procesando...' : 'Confirmar Split y Cobro'}
            </button>
            <button
              type="button"
              className="btn btn-cancel-payment"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
