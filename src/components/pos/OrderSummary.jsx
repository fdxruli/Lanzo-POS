// src/components/pos/OrderSummary.jsx
import React from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { ChevronDown } from 'lucide-react'; // Importamos icono para cerrar
import './OrderSummary.css';

// Agregamos props: isMobileModal y onClose
export default function OrderSummary({ onOpenPayment, isMobileModal, onClose }) {
  const order = useOrderStore((state) => state.order);
  const { updateItemQuantity, removeItem, clearOrder, getTotalPrice } = useOrderStore.getState();
  const total = getTotalPrice();

  const handleQuantityChange = (id, change) => {
    const item = order.find(i => i.id === id);
    if (!item) return;
    if (item.saleType === 'unit' || !item.saleType) {
      const newQuantity = (item.quantity || 0) + change;
      if (newQuantity <= 0) removeItem(id);
      else updateItemQuantity(id, newQuantity);
    }
  };

  const handleBulkInputChange = (id, value) => {
    const newQuantity = parseFloat(value);
    updateItemQuantity(id, isNaN(newQuantity) || newQuantity < 0 ? null : newQuantity);
  };

  return (
    <div className="pos-order-container" style={isMobileModal ? { height: '100%', boxShadow: 'none', border: 'none' } : {}}>

      {/* --- CABECERA ESPECIAL PARA MÓVIL --- */}
      {isMobileModal && (
        <div className="mobile-summary-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Tu Pedido</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', padding: '5px' }}>
            <ChevronDown size={24} />
          </button>
        </div>
      )}

      {!isMobileModal && <h2>Resumen del Pedido</h2>}

      {order.length === 0 ? (
        <p className="empty-message">No hay productos en el pedido</p>
      ) : (
        <>
          <div className="order-list">
            {order.map(item => {
              const itemClasses = `order-item ${item.exceedsStock ? 'exceeds-stock' : ''}`;
              const hasModifiers = item.selectedModifiers && item.selectedModifiers.length > 0;

              return (
                <div key={item.id} className={itemClasses}>
                  <div className="order-item-info">
                    <div className="order-item-header">
                      <span className="order-item-name">{item.name}</span>
                      {item.exceedsStock && (
                        <span className="stock-alert-icon" title={`Stock insuficiente. Disponibles: ${item.stock}`}>⚠️</span>
                      )}
                    </div>
                    {hasModifiers && (
                      <div className="order-item-modifiers">
                        {item.selectedModifiers.map((mod, idx) => (
                          <span key={idx} className="modifier-tag">+ {mod.name}</span>
                        ))}
                      </div>
                    )}
                    {item.notes && <div className="order-item-notes">📝 {item.notes}</div>}
                    <div className="order-item-price">${item.price.toFixed(2)} c/u</div>
                  </div>

                  {(item.saleType === 'unit' || !item.saleType) ? (
                    <div className="order-item-controls">
                      <button className="quantity-btn" onClick={() => handleQuantityChange(item.id, -1)}>−</button>
                      <span className="quantity-display">{item.quantity}</span>
                      <button className="quantity-btn" onClick={() => handleQuantityChange(item.id, 1)}>+</button>
                    </div>
                  ) : (
                    <div className="order-item-controls">
                      <input
                        type="number" className="bulk-input"
                        value={item.quantity || ''}
                        onChange={(e) => handleBulkInputChange(item.id, e.target.value)}
                        placeholder="0.0" step="0.1" min="0"
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
            <button className="process-btn" onClick={onOpenPayment}>Cobrar</button>
            <button className="clear-btn" onClick={() => {
              if (window.confirm('¿Vaciar carrito?')) {
                clearOrder();
                if (isMobileModal) onClose(); // Cerrar modal si se vacía
              }
            }}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}