import React, { useState } from 'react';
import { Star, X, Plus, Check } from 'lucide-react';
import './OrderTabs.css';

const OrderTabs = ({
  activeOrders,
  currentOrderId,
  onSwitchOrder,
  onCreateOrder,
  isPausing
}) => {
  const [showNewOrderForm, setShowNewOrderForm] = useState(false);
  const [newOrderName, setNewOrderName] = useState('');

  // Transform Map to Array for easy rendering
  const ordersList = Array.from(activeOrders.values());

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    onCreateOrder(newOrderName.trim() || null);
    setNewOrderName('');
    setShowNewOrderForm(false);
  };

  return (
    <div className="order-tabs-container">
      <div className="order-tabs-scroll-area">
        {ordersList.map(order => {
          const isActive = order.id === currentOrderId;
          const itemCount = (order.items || []).reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);

          // Generate a display name
          const shortId = order.id.replace('sal-', '').substring(0, 4).toUpperCase();
          const displayName = order.tableData || `Orden #${shortId}`;

          return (
            <div
              key={order.id}
              className={`order-tab ${isActive ? 'active' : ''} ${isPausing && isActive ? 'pausing' : ''}`}
              onClick={() => !isActive && onSwitchOrder(order.id)}
              role="button"
              tabIndex={0}
              aria-selected={isActive}
            >
              <div className="order-tab-content">
                {isActive && <Star className="active-icon" size={14} fill="currentColor" aria-hidden="true" />}
                <span className="order-tab-name" title={displayName}>{displayName}</span>
                {itemCount > 0 && (
                  <span className="order-tab-badge" aria-label={`${itemCount} artículos`}>
                    {itemCount}
                  </span>
                )}
              </div>

              <div className="order-tab-total">
                ${Number(order.total || 0).toFixed(2)}
              </div>
            </div>
          );
        })}

        {!showNewOrderForm ? (
          <button
            className="order-tab-add"
            onClick={() => setShowNewOrderForm(true)}
            aria-label="Crear nueva orden"
          >
            <Plus size={16} />
            <span>Nueva Orden</span>
          </button>
        ) : (
          <form className="order-tab-form" onSubmit={handleCreateSubmit}>
            <input
              autoFocus
              type="text"
              placeholder="Nombre (opcional)"
              value={newOrderName}
              onChange={e => setNewOrderName(e.target.value)}
              onBlur={(e) => {
                // Delay hiding to allow submit button click to register
                if (!e.relatedTarget || e.relatedTarget.type !== 'submit') {
                  if (!newOrderName.trim()) setShowNewOrderForm(false);
                }
              }}
              aria-label="Nombre de la nueva orden"
            />
            <button type="submit" className="btn-confirm-add" title="Confirmar nueva orden">
              <Check size={16} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default OrderTabs;
