import { useState } from 'react';
import { Star, Plus, Check } from 'lucide-react';
import './OrderTabs.css';

const OrderTabs = ({
  activeOrders,
  currentOrderId,
  onSwitchOrder,
  onCreateOrder,
  canCreateOrder = true,
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
          let displayName = '';
          const shortId = order.id.replace('sal-', '').substring(0, 4).toUpperCase();
          
          if (order.origin === 'ecommerce' && order.ecommerceOrderCode) {
            displayName = `Online ${order.ecommerceOrderCode}`;
          } else if (order.folio && order.tableData) {
            displayName = `${order.tableData} | F-${order.folio}`;
          } else if (order.folio) {
            displayName = `Folio ${order.folio}`;
          } else if (order.tableData) {
            displayName = order.tableData;
          } else {
            displayName = `Orden #${shortId}`;
          }

          return (
            <button
              type="button"
              key={order.id}
              className={`order-tab ${isActive ? 'active' : ''} ${isPausing && isActive ? 'pausing' : ''}`}
              onClick={() => !isActive && onSwitchOrder(order.id)}
              aria-current={isActive ? 'true' : undefined}
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
            </button>
          );
        })}

        {canCreateOrder && (!showNewOrderForm ? (
          <button
            type="button"
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
        ))}
      </div>
    </div>
  );
};

export default OrderTabs;
