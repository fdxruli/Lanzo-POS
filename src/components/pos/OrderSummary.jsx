// src/components/pos/OrderSummary.jsx
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
        // El store (useOrderStore.jsx) se encargará de validar
        // si la newQuantity excede el stock.
        updateItemQuantity(id, newQuantity);
      }
    }
  };

  const handleBulkInputChange = (id, value) => {
    const newQuantity = parseFloat(value);
    // El store validará esta cantidad
    updateItemQuantity(id, isNaN(newQuantity) || newQuantity < 0 ? null : newQuantity);
  };

  return (
    <div className="pos-order-container">
      <h2>Resumen del Pedido</h2>
      
      {order.length === 0 ? (
        <p className="empty-message">No hay productos en el pedido</p>
      ) : (
        <>
          <div className="order-list">
            {order.map(item => {
              
              // --- ¡AQUÍ ESTÁ LA CORRECCIÓN 1! ---
              // Añadimos la clase 'exceeds-stock' dinámicamente
              const itemClasses = `order-item ${item.exceedsStock ? 'exceeds-stock' : ''}`;

              return (
                <div key={item.id} className={itemClasses}>
                  <div className="order-item-info">
                    <div className="order-item-name">{item.name}</div>
                    <div className="order-item-price">
                      ${item.price.toFixed(2)} c/u
                    </div>
                    
                    {/* --- ¡AQUÍ ESTÁ LA CORRECCIÓN 2! --- */}
                    {/* Mostramos un mensaje visual de advertencia */}
                    {item.exceedsStock && (
                      <div className="stock-warning exceeds-stock-warning">
                        ¡Stock excedido! (Disponibles: {item.stock})
                      </div>
                    )}
                  </div>

                  {item.saleType === 'unit' ? (
                    <div className="order-item-controls">
                      <button 
                        className="quantity-btn" 
                        onClick={() => handleQuantityChange(item.id, -1)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/>
                        </svg>
                      </button>
                      
                      <span className="quantity-display">{item.quantity}</span>
                      
                      <button 
                        className="quantity-btn" 
                        onClick={() => handleQuantityChange(item.id, 1)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="order-item-controls">
                      <input
                        type="number"
                        className="bulk-input"
                        value={item.quantity || ''}
                        onChange={(e) => handleBulkInputChange(item.id, e.target.value)}
                        placeholder="0.0"
                        step="0.1"
                        min="0"
                      />
                      <span className="unit-label">kg</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="order-total">
            <span>Total:</span>
            <span className="total-price">${total.toFixed(2)}</span>
          </div>

          <button className="process-btn" onClick={onOpenPayment}>
            Procesar
          </button>
          
          <button className="clear-btn" onClick={clearOrder}>
            Limpiar
          </button>
        </>
      )}
    </div>
  );
}
