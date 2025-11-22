// src/components/pos/OrderSummary.jsx
import React from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import './OrderSummary.css';

export default function OrderSummary({ onOpenPayment }) {
  // 1. Conectamos al store
  const order = useOrderStore((state) => state.order);

  // 2. Traemos las acciones
  const { updateItemQuantity, removeItem, clearOrder, getTotalPrice } = useOrderStore.getState();

  // 3. Calculamos el total
  const total = getTotalPrice();

  // Handlers
  const handleQuantityChange = (id, change) => {
    const item = order.find(i => i.id === id);
    if (!item) return;

    // Si es venta por unidad
    if (item.saleType === 'unit' || !item.saleType) {
      const newQuantity = (item.quantity || 0) + change;
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
      <h2>Resumen del Pedido</h2>

      {order.length === 0 ? (
        <p className="empty-message">No hay productos en el pedido</p>
      ) : (
        <>
          <div className="order-list">
            {order.map(item => {
              const itemClasses = `order-item ${item.exceedsStock ? 'exceeds-stock' : ''}`;

              // Verificar si tiene modificadores para mostrar
              const hasModifiers = item.selectedModifiers && item.selectedModifiers.length > 0;

              return (
                <div key={item.id} className={itemClasses}>
                  <div className="order-item-info">
                    <div className="order-item-header">
                      <span className="order-item-name">{item.name}</span>
                      {/* Si hay stock bajo/excedido, mostrar alerta pequeña */}
                      {item.exceedsStock && (
                        <span className="stock-alert-icon" title={`Stock insuficiente. Disponibles: ${item.stock}`}>⚠️</span>
                      )}
                    </div>

                    {/* --- SECCIÓN NUEVA: MODIFICADORES --- */}
                    {hasModifiers && (
                      <div className="order-item-modifiers">
                        {item.selectedModifiers.map((mod, idx) => (
                          <span key={idx} className="modifier-tag">
                            + {mod.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* --- SECCIÓN NUEVA: NOTAS --- */}
                    {item.notes && (
                      <div className="order-item-notes">
                        📝 {item.notes}
                      </div>
                    )}

                    <div className="order-item-price">
                      ${item.price.toFixed(2)} c/u
                    </div>
                  </div>

                  {/* Controles de Cantidad (Igual que antes) */}
                  {(item.saleType === 'unit' || !item.saleType) ? (
                    <div className="order-item-controls">
                      <button
                        className="quantity-btn"
                        onClick={() => handleQuantityChange(item.id, -1)}
                      >
                        −
                      </button>
                      <span className="quantity-display">{item.quantity}</span>
                      <button
                        className="quantity-btn"
                        onClick={() => handleQuantityChange(item.id, 1)}
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
                      <span className="unit-label">{item.bulkData?.purchase?.unit || 'kg'}</span>
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

          <div className="order-actions">
            <button className="process-btn" onClick={onOpenPayment}>
              Cobrar
            </button>
            <button className="clear-btn" onClick={clearOrder}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}