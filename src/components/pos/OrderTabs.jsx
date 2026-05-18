import React, { useState } from 'react';
import './OrderTabs.css';

const OrderTabs = ({
  activeOrders,
  currentOrderId,
  onSwitchOrder,
  onCreateOrder,
  onDeleteOrder,
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

  const handleDeleteClick = (e, orderId) => {
    e.stopPropagation(); // prevent switching tab

    // Buscar la orden para ver si tiene items
    const orderToClose = activeOrders.get(orderId);
    const itemCount = (orderToClose?.items || []).reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);

    // CORRECCIÓN: Evitar re-declaración y sobrescritura de confirmMsg
    const confirmMsg = itemCount === 0
      ? '¿Deseas eliminar esta pestaña vacía?'
      : '¿Deseas cancelar esta orden? Se quitará de órdenes abiertas.';

    if (window.confirm(confirmMsg)) {
      onDeleteOrder(orderId);
    }
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
            >
              <div className="order-tab-content">
                {isActive && <span className="active-icon">★</span>}
                <span className="order-tab-name">{displayName}</span>
                {itemCount > 0 && <span className="order-tab-badge">{itemCount}</span>}
              </div>

              <div className="order-tab-total">
                ${Number(order.total || 0).toFixed(2)}
              </div>

              {!isActive && (
                <button
                  className="order-tab-close"
                  onClick={(e) => handleDeleteClick(e, order.id)}
                  title="Eliminar orden"
                  disabled={isPausing}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {!showNewOrderForm ? (
          <button
            className="order-tab-add"
            onClick={() => setShowNewOrderForm(true)}
          >
            + Nueva Orden
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
            />
            <button type="submit" className="btn-confirm-add">✓</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default OrderTabs;
