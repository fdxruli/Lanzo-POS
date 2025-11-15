// src/components/pos/OrderSummary.jsx
import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';
import './OrderSummary.css'

// ✅ PRUEBA DE DIAGNÓSTICO
console.log('Componentes Lucide importados:', { Minus, Plus });

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
              
              // Añadimos la clase 'exceeds-stock' dinámicamente
              const itemClasses = `order-item ${item.exceedsStock ? 'exceeds-stock' : ''}`;

              return (
                <div key={item.id} className={itemClasses}>
                  <div className="order-item-info">
                    <div className="order-item-name">{item.name}</div>
                    <div className="order-item-price">
                      ${item.price.toFixed(2)} c/u
                    </div>
                    
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
                        aria-label="Disminuir cantidad"
                      >
                        −
                      </button>
                      
                      <span className="quantity-display">{item.quantity}</span>
                      
                      <button 
                        className="quantity-btn" 
                        onClick={() => handleQuantityChange(item.id, 1)}
                        aria-label="Aumentar cantidad"
                      >
                        +
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