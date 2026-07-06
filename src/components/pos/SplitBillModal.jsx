import { useEffect, useMemo, useState, useCallback } from 'react';
import { Check, Minus, Plus, RotateCcw, X } from 'lucide-react';
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

const formatQuantity = (value) => {
  const quantity = toQuantity(value);
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};

/**
 * Build ticket lines for a specific ticket index.
 * @param {Array} allocations - Full allocations array
 * @param {number} ticketIdx - Ticket index
 * @returns {Array} Line items for the ticket
 */
const buildTicketLines = (allocations, ticketIdx) =>
  (allocations || []).flatMap((allocation, lineIndex) => {
    const quantity = toQuantity(allocation?.ticketQuantities?.[ticketIdx] || 0);
    return quantity <= 0 ? [] : [{ lineIndex, quantity }];
  });

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
  const customersById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
  );

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

  useEffect(() => {
    if (!show) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  // Recalculate when splitCount changes
  useEffect(() => {
    if (!show) return;

    // Rebuild allocations for new ticket count, preserving pool
    setAllocations((currentAllocations) => {
      if (currentAllocations.length === 0) return currentAllocations;

      return order.map((item, idx) => {
        const current = currentAllocations[idx];
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
    });
  }, [show, order, splitCount]);

  const ticketMath = useMemo(
    () => calculateTicketMath({ order, allocations, mode, total }),
    [order, allocations, mode, total]
  );

  const assignmentProgress = useMemo(() => {
    let totalQuantity = 0;
    let pendingQuantity = 0;
    let pendingLines = 0;

    (order || []).forEach((item, index) => {
      const lineTotal = toQuantity(item?.quantity || 0);
      const poolQuantity = toQuantity(allocations[index]?.poolQuantity || 0);

      totalQuantity = toQuantity(totalQuantity + lineTotal);
      pendingQuantity = toQuantity(pendingQuantity + poolQuantity);
      if (poolQuantity > 0) pendingLines += 1;
    });

    const assignedQuantity = toQuantity(totalQuantity - pendingQuantity);

    return {
      assignedQuantity,
      pendingQuantity,
      pendingLines,
      totalQuantity
    };
  }, [order, allocations]);

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

        const customer = customersById.get(payment.customerId);
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
  }, [order, allocations, ticketLabels, ticketMath, payments, customersById]);

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
      className="modal split-bill-overlay"
      style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}
      onClick={onClose}
    >
      <div
        className="modal-content split-bill-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-bill-title"
        aria-describedby="split-bill-description"
      >
        <div className="split-bill-header">
          <div className="split-bill-title-block">
            <span className="split-bill-kicker">Separación de cobro</span>
            <h2 id="split-bill-title">Dividir cuenta</h2>
            <p id="split-bill-description">
              Asigna lo pendiente a cada ticket y confirma el método de pago.
            </p>
          </div>
          <button
            type="button"
            className="split-close-button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar división de cuenta"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="split-status-strip" aria-label="Resumen de división">
          <div className="split-status-card">
            <span>Total cuenta</span>
            <strong>${formatMoneyFromCents(ticketMath.parentCents)}</strong>
          </div>
          <div className="split-status-card">
            <span>Asignado</span>
            <strong>
              {formatQuantity(assignmentProgress.assignedQuantity)} / {formatQuantity(assignmentProgress.totalQuantity)}
            </strong>
          </div>
          <div className={`split-status-card ${assignmentProgress.pendingQuantity > 0 ? 'is-pending' : 'is-ready'}`}>
            <span>Pendiente</span>
            <strong>{formatQuantity(assignmentProgress.pendingQuantity)}</strong>
          </div>
        </div>

        <div className="split-controls-row">
          <div className="split-count-selector">
            <label htmlFor="splitCount">Tickets</label>
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

          <div className="split-mode-row" aria-label="Modo de división">
            <button
              type="button"
              className={`btn-method ${mode === 'manual' ? 'active' : ''}`}
              onClick={() => handleModeChange('manual')}
              aria-pressed={mode === 'manual'}
              disabled={isSubmitting}
            >
              Manual
            </button>
            <button
              type="button"
              className={`btn-method ${mode === 'equal' ? 'active' : ''}`}
              onClick={() => handleModeChange('equal')}
              aria-pressed={mode === 'equal'}
              disabled={isSubmitting}
            >
              Equitativo
            </button>
          </div>
        </div>

        <form className="split-bill-form" onSubmit={handleSubmit}>
          <div className="split-main-content">
            <section className="split-pool-section" aria-labelledby="split-pool-title">
              <div className="split-section-heading">
                <div>
                  <h3 id="split-pool-title">Pendiente por asignar</h3>
                  <p>{assignmentProgress.pendingLines} productos con cantidad disponible</p>
                </div>
              </div>

              <div className="split-pool-list">
                {order.map((item, index) => {
                  const allocation = allocations[index];
                  if (!allocation) return null;

                  const poolQty = toQuantity(allocation.poolQuantity);
                  const totalQty = toQuantity(item.quantity || 0);
                  const step = isUnitItem(item) ? 1 : 0.0001;
                  const isCompleted = poolQty <= 0;

                  return (
                    <article
                      key={getCartLineId(item, index)}
                      className={`split-pool-item ${isCompleted ? 'completed' : ''}`}
                    >
                      <div className="split-pool-item-head">
                        <div className="split-pool-item-info">
                          <span className="split-pool-item-name">{item.name}</span>
                          <span className="split-pool-item-price">
                            ${Money.toNumber(item.price || 0).toFixed(2)} c/u
                          </span>
                        </div>
                        <span className={`split-pool-badge ${isCompleted ? 'is-complete' : ''}`}>
                          {isCompleted ? (
                            <>
                              <Check size={14} aria-hidden="true" /> Asignado
                            </>
                          ) : (
                            `${formatQuantity(poolQty)} de ${formatQuantity(totalQty)}`
                          )}
                        </span>
                      </div>

                      {!isCompleted && (
                        <div className="split-pool-item-actions">
                          <span className="split-action-label">Sumar</span>
                          <div className="split-assign-grid">
                            {ticketLabels.map((label, tIdx) => (
                              <button
                                key={label}
                                type="button"
                                className="btn-pool-move"
                                onClick={() => moveToTicket(index, tIdx, step)}
                                disabled={poolQty < step || isSubmitting}
                                title={`Sumar ${formatQuantity(step)} a ${label}`}
                              >
                                <Plus size={14} aria-hidden="true" />
                                {label}
                              </button>
                            ))}
                          </div>

                          <span className="split-action-label">Todo a</span>
                          <div className="split-assign-grid split-assign-grid--compact">
                            {ticketLabels.map((label, tIdx) => (
                              <button
                                key={label}
                                type="button"
                                className="btn-pool-move-all"
                                onClick={() => moveAllToTicket(index, tIdx)}
                                disabled={poolQty <= 0 || isSubmitting}
                                title={`Asignar todo a ${label}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="split-tickets-section" aria-label="Tickets separados">
              <div className="split-tickets-grid">
                {ticketLabels.map((label, tIdx) => {
                  const ticketTotalCents = ticketMath.totalsCents[tIdx];
                  const adjustment = ticketMath.adjustments[tIdx];
                  const payment = payments[label] || {};
                  const ticketItems = order.reduce((items, item, idx) => {
                    const qty = toQuantity(allocations[idx]?.ticketQuantities?.[tIdx] || 0);
                    if (qty > 0) {
                      items.push({ item, qty, lineIndex: idx });
                    }
                    return items;
                  }, []);

                  return (
                    <article
                      key={label}
                      className={`split-ticket-card ${ticketItems.length === 0 ? 'is-empty' : ''}`}
                    >
                      <div className="split-ticket-header">
                        <div>
                          <h3>Ticket {label}</h3>
                          <span>{ticketItems.length} productos</span>
                        </div>
                        <p className="split-ticket-total">
                          ${formatMoneyFromCents(ticketTotalCents)}
                        </p>
                      </div>

                      {adjustment !== 0 && (
                        <p className="split-ticket-adjustment">
                          Ajuste: {adjustment >= 0 ? '+' : ''}${formatMoneyFromCents(adjustment)}
                        </p>
                      )}

                      <div className="split-ticket-items">
                        {ticketItems.length === 0 ? (
                          <p className="split-ticket-empty">Sin productos asignados</p>
                        ) : (
                          ticketItems.map(({ item, qty, lineIndex }) => (
                            <div key={lineIndex} className="split-ticket-item">
                              <span className="split-ticket-item-name">{item.name}</span>
                              <span className="split-ticket-item-qty">x {formatQuantity(qty)}</span>
                              <button
                                type="button"
                                className="btn-item-remove"
                                onClick={() => moveToPool(lineIndex, tIdx, isUnitItem(item) ? 1 : 0.0001)}
                                disabled={isSubmitting}
                                aria-label={`Quitar una unidad de ${item.name} del ticket ${label}`}
                                title="Quitar uno"
                              >
                                <Minus size={14} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn-item-remove-all"
                                onClick={() => moveAllToPool(lineIndex, tIdx)}
                                disabled={isSubmitting}
                                aria-label={`Regresar todo ${item.name} al pendiente`}
                                title="Regresar todo"
                              >
                                <RotateCcw size={14} aria-hidden="true" />
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
                    </article>
                  );
                })}
              </div>
            </section>
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
              type="button"
              className="btn btn-cancel-payment"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-confirm"
              disabled={Boolean(splitValidationError) || isSubmitting}
            >
              {isSubmitting ? 'Procesando...' : 'Confirmar división y cobro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
