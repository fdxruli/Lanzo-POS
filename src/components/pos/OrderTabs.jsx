import { useState } from 'react';
import { Star, Plus, Check } from 'lucide-react';
import './OrderTabs.css';

const OrderTabs = ({
  activeOrders,
  currentOrderId,
  onSwitchOrder,
  inventoryConflictNotice = null,
  onDismissInventoryNotice,
  onOpenInventorySource,
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
      {inventoryConflictNotice && (
        <div className="order-tabs-inventory-notice" role="alert">
          <div className="order-tabs-inventory-notice__heading">
            <strong>Sin unidades disponibles para esta venta</strong>
            <button
              type="button"
              className="order-tabs-inventory-notice__close"
              onClick={onDismissInventoryNotice}
              aria-label="Cerrar aviso de inventario"
            >×</button>
          </div>
          <p><strong>{inventoryConflictNotice.productName}</strong></p>
          {inventoryConflictNotice.availableBeforeCarts !== null && (
            <p>Disponibles para vender según inventario local, antes de otras ventas: <strong>{inventoryConflictNotice.availableBeforeCarts}</strong>.</p>
          )}
          {inventoryConflictNotice.sourceCount > 0 && inventoryConflictNotice.provisionalInOtherCarts !== null && (
            <p>
              Utilizadas provisionalmente en {inventoryConflictNotice.singleSourceLabel
                ? inventoryConflictNotice.singleSourceLabel
                : inventoryConflictNotice.sourceCount === 1 ? 'otra venta abierta' : 'otras ventas abiertas'}:
              {' '}<strong>{inventoryConflictNotice.provisionalInOtherCarts}</strong>.
            </p>
          )}
          {inventoryConflictNotice.freeInThisCart !== null && (
            <p>Libres para esta venta: <strong>{inventoryConflictNotice.freeInThisCart}</strong>.</p>
          )}
          <p>
            {inventoryConflictNotice.sourceCount > 0
              ? inventoryConflictNotice.sourceCount === 1
                ? 'Para continuar, abre la otra venta, reduce o elimina allí el producto y vuelve a agregarlo en esta venta.'
                : 'Para continuar, revisa las otras ventas abiertas, libera las unidades necesarias y vuelve a agregarlas aquí.'
              : 'No hay disponibilidad suficiente según el inventario local. Revisa existencias, lotes y reservas formales antes de volver a intentarlo.'}
          </p>
          <div className="order-tabs-inventory-notice__actions">
            {inventoryConflictNotice.sourceOrderId && (
              <button type="button" onClick={onOpenInventorySource} className="order-tabs-inventory-notice__open">
                Abrir {inventoryConflictNotice.singleSourceLabel || 'la otra venta'}
              </button>
            )}
            <span>No se agregó el producto ni se modificó el inventario.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderTabs;
