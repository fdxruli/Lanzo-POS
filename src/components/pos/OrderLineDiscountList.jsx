import { useState } from 'react';
import { getLineKey } from '../../services/sales/orderTotals';
import { showMessageModal } from '../../services/utils';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const selectCurrentOrder = (state) => (state.currentOrderId ? state.activeOrders.get(state.currentOrderId) || null : null);

export default function OrderLineDiscountList() {
  const order = useActiveOrders(selectCurrentOrder);
  const applyLineDiscount = useActiveOrders((state) => state.applyLineDiscount);
  const removeLineDiscount = useActiveOrders((state) => state.removeLineDiscount);
  const [editingLineId, setEditingLineId] = useState(null);
  const [type, setType] = useState('amount');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const items = Array.isArray(order?.items) ? order.items.filter((item) => Number(item?.quantity) > 0) : [];
  if (items.length === 0) return null;

  const reset = () => {
    setEditingLineId(null);
    setType('amount');
    setValue('');
    setReason('');
  };

  const apply = (lineId) => {
    try {
      applyLineDiscount(lineId, { type, value, reason });
      reset();
      showMessageModal('Descuento por producto aplicado.', null, { type: 'success' });
    } catch (error) {
      showMessageModal(error?.message || 'No se pudo aplicar el descuento por producto.', null, { type: 'warning' });
    }
  };

  const remove = (lineId) => {
    removeLineDiscount(lineId);
    showMessageModal('Descuento por producto quitado.', null, { type: 'success' });
  };

  return (
    <div className="order-line-discounts" aria-label="Descuentos por producto">
      <div className="order-line-discounts-title">Descuento por producto</div>
      {items.map((item, index) => {
        const lineId = getLineKey(item, index);
        const discountAmount = Number(item.discountAmount ?? item.discount_amount ?? item.discount?.amount ?? 0);
        const hasDiscount = discountAmount > 0;
        const isEditing = editingLineId === lineId;

        return (
          <div key={lineId} className="order-line-discount-item">
            <div className="order-line-discount-copy">
              <span>{item.name || 'Producto'}</span>
              {hasDiscount && <small>Descuento: -{money(discountAmount)} · {item.discount?.reason || 'Manual'}</small>}
            </div>

            {isEditing ? (
              <div className="order-line-discount-form">
                <select value={type} onChange={(event) => setType(event.target.value)}>
                  <option value="amount">Monto fijo</option>
                  <option value="percent">Porcentaje</option>
                </select>
                <input type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Valor" />
                <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo del descuento" />
                <button type="button" className="order-discount-btn order-discount-btn--primary" onClick={() => apply(lineId)}>Aplicar</button>
                <button type="button" className="order-discount-btn" onClick={reset}>Cancelar</button>
              </div>
            ) : (
              <div className="order-line-discount-actions">
                <button type="button" className="order-discount-btn" onClick={() => setEditingLineId(lineId)}>Descuento</button>
                {hasDiscount && <button type="button" className="order-discount-btn order-discount-btn--danger" onClick={() => remove(lineId)}>Quitar</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
