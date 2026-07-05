import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { makeSaleDiscount, orderTotals, withOrderTotals } from '../../services/sales/orderTotals';
import { showMessageModal } from '../../services/utils';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useOrderDiscountRuntime } from '../../hooks/pos/useOrderDiscountRuntime';
import OrderLineDiscountList from './OrderLineDiscountList';
import './OrderDiscountPanel.css';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const currentOrderSelector = (state) => (state.currentOrderId ? state.activeOrders.get(state.currentOrderId) || null : null);

export default function OrderDiscountPanel({
  compact = false,
  restaurant = false,
  embedded = false,
  triggerOnly = false,
  defaultExpanded = false,
  onOpen
}) {
  useOrderDiscountRuntime();

  const order = useActiveOrders(currentOrderSelector);
  const updateCurrentOrder = useActiveOrders((state) => state.updateCurrentOrder);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded || !restaurant);
  const [type, setType] = useState('amount');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const items = useMemo(() => (Array.isArray(order?.items) ? order.items : []), [order]);
  const totals = useMemo(() => orderTotals(order || { items }), [order, items]);
  const hasItems = items.some((item) => Number(item?.quantity) > 0);
  const hasAnyDiscount = Number(totals.discountTotal || 0) > 0;
  const hasSaleDiscount = Number(totals.saleDiscountAmount || 0) > 0;
  const locked = Boolean(order?.isLockedForCheckout);

  const closeForm = () => {
    setOpen(false);
    setType('amount');
    setValue('');
    setReason('');
  };

  const applyDiscount = () => {
    if (!order || locked) return;
    if (!hasItems) {
      showMessageModal('Agrega productos antes de aplicar un descuento.', null, { type: 'warning' });
      return;
    }

    try {
      const saleDiscount = makeSaleDiscount(order, { type, value, reason });
      updateCurrentOrder(withOrderTotals({ ...order, saleDiscount }));
      closeForm();
      showMessageModal('Descuento aplicado.', null, { type: 'success' });
    } catch (error) {
      showMessageModal(error?.message || 'No se pudo aplicar el descuento.', null, { type: 'warning' });
    }
  };

  const removeDiscount = () => {
    if (!order || locked) return;
    updateCurrentOrder(withOrderTotals({ ...order, saleDiscount: null }, null));
    closeForm();
    showMessageModal('Descuento quitado.', null, { type: 'success' });
  };

  if (!hasItems) return null;

  if (triggerOnly) {
    return (
      <button
        type="button"
        className={`order-discount-mobile-trigger${hasAnyDiscount ? ' order-discount-mobile-trigger--active' : ''}`}
        onClick={onOpen}
      >
        <span>Descuentos</span>
        {hasAnyDiscount && <small>-{money(totals.discountTotal)}</small>}
      </button>
    );
  }

  const toggleExpanded = () => {
    setExpanded((current) => {
      if (current) closeForm();
      return !current;
    });
  };

  return (
    <section className={`order-discount-panel${compact ? ' order-discount-panel--compact' : ''}${restaurant ? ' order-discount-panel--restaurant' : ''}${embedded ? ' order-discount-panel--embedded' : ''}${expanded ? ' order-discount-panel--expanded' : ''}`}>
      <button
        type="button"
        className="order-discount-accordion-trigger"
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        <span>
          <strong>Descuentos</strong>
          <small>{hasAnyDiscount ? `Aplicado: -${money(totals.discountTotal)}` : 'Opcional'}</small>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>

      {expanded && (
        <div className="order-discount-content">
          <div className="order-discount-totals">
            <div className="order-discount-row"><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
            {hasAnyDiscount && <div className="order-discount-row order-discount-row--discount"><span>Descuento</span><strong>-{money(totals.discountTotal)}</strong></div>}
            <div className="order-discount-row order-discount-row--total"><span>Total</span><strong>{money(totals.total)}</strong></div>
          </div>

          {totals.saleDiscount && <p className="order-discount-note">Descuento aplicado: {totals.saleDiscount.reason}</p>}

          {open && !locked && (
            <div className="order-discount-form">
              <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Tipo de descuento">
                <option value="amount">Monto fijo</option>
                <option value="percent">Porcentaje</option>
              </select>
              <input type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Valor" />
              <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo del descuento" />
            </div>
          )}

          <div className="order-discount-actions">
            {open ? (
              <>
                <button type="button" className="order-discount-btn order-discount-btn--primary" onClick={applyDiscount} disabled={locked}>Aplicar descuento</button>
                <button type="button" className="order-discount-btn" onClick={closeForm}>Cancelar</button>
              </>
            ) : (
              <button type="button" className="order-discount-btn" onClick={() => setOpen(true)} disabled={locked}>Descuento general</button>
            )}
            {hasSaleDiscount && !open && <button type="button" className="order-discount-btn order-discount-btn--danger" onClick={removeDiscount} disabled={locked}>Quitar descuento general</button>}
          </div>

          <OrderLineDiscountList />
        </div>
      )}
    </section>
  );
}
