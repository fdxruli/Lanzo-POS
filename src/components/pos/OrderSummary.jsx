import React from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import './OrderSummary.css'

export default function OrderSummary({onOpenPayment}) {
  // 1. Conectamos al store. ¡Esto es todo!
  // 'order' se actualizará automáticamente cada vez que cambie en el store.
  const order = useOrderStore((state) => state.order);
  
  // 2. Traemos las acciones que necesitamos
  const { updateItemQuantity, removeItem, clearOrder, getTotalPrice } = useOrderStore.getState();

  // 3. Calculamos el total
  const total = getTotalPrice(); // Usamos la función del store

  // Handlers que llaman a las acciones del store
  const handleQuantityChange = (id, change) => {
    const item = order.find(i => i.id === id);
    if (item.saleType === 'unit') {
      const newQuantity = item.quantity + change;
      if (newQuantity <= 0) {
        removeItem(id);
      } else {
        updateItemQuantity(id, newQuantity);
      }
    }
  };

  const handleBulkInputChange = (id, value) => {
    const newQuantity = parseFloat(value);
    updateItemQuantity(id, isNaN(newQuantity) || newQuantity < 0 ? null : newQuantity);
  };

  return (
    <div className="pos-order-container">
      <h3 className="subtitle">Resumen del Pedido</h3>
      
      {order.length === 0 ? (
        <div id="empty-order-message" className="empty-message">
          No hay elementos en el pedido.
        </div>
      ) : (
        <div id="order-list" className="order-list" aria-label="Lista de pedidos">
          {order.map((item) => (
            <div key={item.id} className="order-item">
              <div className="order-item-info">
                <span className="order-item-name">{item.name}</span>
                <span className="order-item-price">$${item.price.toFixed(2)} c/u</span>
              </div>
              
              {item.saleType === 'bulk' ? (
                <div className="order-item-controls bulk-controls">
                  <input 
                    type="number" 
                    className="order-item-quantity-input" 
                    placeholder="Cantidad"
                    value={item.quantity === null ? '' : item.quantity}
                    onChange={(e) => handleBulkInputChange(item.id, e.target.value)}
                  />
                  <span>{item.bulkData?.purchase?.unit || 'kg'}</span>
                  <button className="remove-item-btn" onClick={() => removeItem(item.id)}>X</button>
                </div>
              ) : (
                <div className="order-item-controls">
                  <button className="quantity-btn decrease" onClick={() => handleQuantityChange(item.id, -1)}>-</button>
                  <span className="quantity-value">{item.quantity}</span>
                  <button className="quantity-btn increase" onClick={() => handleQuantityChange(item.id, 1)}>+</button>
                  <button className="remove-item-btn" onClick={() => removeItem(item.id)}>X</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="order-total-container">
        <div className="total-display">
          <span className="total-label">Total:</span>
          <span id="pos-total" className="total-amount">${total.toFixed(2)}</span>
        </div>
        <button id="process-order-btn" className="btn btn-process" onClick={onOpenPayment}>Procesar</button>
        <button 
          id="clear-order-btn" 
          className="btn btn-clear" 
          onClick={clearOrder} // ¡Acción directa!
        >
          Limpiar
        </button>
      </div>
    </div>
  );
}