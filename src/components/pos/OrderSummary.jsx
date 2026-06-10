// src/components/pos/OrderSummary.jsx
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  Columns2,
  CreditCard,
  Save,
  ShieldAlert,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { db, STORES } from '../../services/db/dexie';
import './OrderSummary.css';

const generateStoreCode = (companyName) => {
  if (!companyName || typeof companyName !== 'string') return 'LZ';
  const nameParts = companyName.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return 'LZ';
  if (nameParts.length >= 2) {
    return nameParts[0][0] + nameParts[1][0];
  }

  const word = nameParts[0];
  return word.length === 1 ? `${word}X` : word.substring(0, 2);
};

export default function OrderSummary({
  onOpenPayment,
  onOpenSplit,
  onOpenLayaway,
  isMobileModal,
  onClose,
  showRestaurantActions = false,
  canSplitOrder = false,
  onSaveOpenOrder,
  onOpenTables,
  activeTablesCount = 0,
  kitchenRejectedOpenCount = 0,
}) {
  const currentOrderItems = useActiveOrders((state) => (
    state.currentOrderId ? state.activeOrders.get(state.currentOrderId)?.items : undefined
  ));
  const order = currentOrderItems || [];
  const tableData = useActiveOrders((state) => (
    state.currentOrderId ? state.activeOrders.get(state.currentOrderId)?.tableData || '' : ''
  ));
  const isEditMode = useActiveOrders((state) => (
    state.currentOrderId ? Boolean(state.activeOrders.get(state.currentOrderId)?.isSaved) : false
  ));
  const updateItemQuantity = useActiveOrders((state) => state.updateItemQuantity);
  const removeItem = useActiveOrders((state) => state.removeItem);
  const getTotalPrice = useActiveOrders((state) => state.getTotalPrice);
  const setTableData = useActiveOrders((state) => state.setTableData);
  const features = useFeatureConfig();

  const [estimatedFolio, setEstimatedFolio] = useState('');

  useEffect(() => {
    const fetchEstimatedFolio = async () => {
      try {
        let nextSeq = 1;
        const seqRecord = await db.table(STORES.SEQUENCES).get('sale_folio');
        if (seqRecord) {
          nextSeq = seqRecord.value + 1;
        }

        let storeCode = 'LZ';
        let terminalId = '01';

        const companies = await db.table(STORES.COMPANY).toArray();
        if (companies.length > 0) {
          const company = companies[0];
          const companyName = company.name || company.business_name || '';

          storeCode = company.storeCode || generateStoreCode(companyName);
          terminalId = company.terminalId || '01';
        }

        setEstimatedFolio(`${storeCode}-${terminalId}-${String(nextSeq).padStart(6, '0')}`);
      } catch (error) {
        console.error('Error fetching estimated folio:', error);
      }
    };

    fetchEstimatedFolio();
  }, [order.length]);

  const total = getTotalPrice();
  const tablesBadgeTotal = activeTablesCount + kitchenRejectedOpenCount;

  const handleQuantityChange = (id, change) => {
    const item = order.find((orderItem) => orderItem.id === id);
    if (!item) return;

    if (item.saleType === 'unit' || !item.saleType) {
      const newQuantity = (item.quantity || 0) + change;
      if (newQuantity <= 0) removeItem(id);
      else updateItemQuantity(id, newQuantity);
    }
  };

  const handleBulkInputChange = (id, value) => {
    const newQuantity = parseFloat(value);
    if (newQuantity === 0) {
      removeItem(id);
    } else {
      updateItemQuantity(id, Number.isNaN(newQuantity) || newQuantity < 0 ? null : newQuantity);
    }
  };

  const handleOpenTables = () => {
    if (isMobileModal) onClose?.();
    onOpenTables?.();
  };

  const handleCancelOrder = () => {
    const confirmMessage = (isEditMode && showRestaurantActions)
      ? '¿Descartar los cambios no guardados y salir de la mesa?'
      : '¿Vaciar carrito?';

    if (window.confirm(confirmMessage)) {
      useActiveOrders.getState().cancelCurrentOrder();
      if (isMobileModal) onClose?.();
    }
  };

  return (
    <div
      className={`pos-order-container${isMobileModal ? ' pos-order-container--mobile' : ''}${isEditMode && showRestaurantActions ? ' pos-order-container--editing' : ''}`}
    >
      <header className="summary-header">
        <div className="summary-header-copy">
          <h2 className="summary-title">
            {showRestaurantActions
              ? (isEditMode ? `Editando: ${tableData || 'Mesa'}` : (isMobileModal ? 'Tu Pedido' : 'Resumen del Pedido'))
              : (tableData ? `Orden: ${tableData}` : (isMobileModal ? 'Tu Pedido' : 'Resumen del Pedido'))}
          </h2>

          {estimatedFolio && !isEditMode && (
            <p className="summary-folio">
              Folio estimado: <strong>{estimatedFolio}</strong>
            </p>
          )}

          {isEditMode && showRestaurantActions && (
            <span className="summary-edit-badge">Pedido guardado</span>
          )}
        </div>

        <div className="summary-header-actions">
          {showRestaurantActions && onOpenTables && (
            <button
              type="button"
              onClick={handleOpenTables}
              className={`btn-mesas-header${isMobileModal ? ' btn-mesas-header--mobile' : ''}${kitchenRejectedOpenCount > 0 ? ' btn-mesas-header--kitchen-rejected' : ''}`}
              title={
                kitchenRejectedOpenCount > 0
                  ? 'Hay comandas rechazadas en cocina'
                  : 'Ver mesas'
              }
            >
              <Table2 size={18} aria-hidden="true" />
              Mesas
              {tablesBadgeTotal > 0 && (
                <span className="active-tables-count">{tablesBadgeTotal}</span>
              )}
            </button>
          )}

          {isMobileModal && (
            <button
              type="button"
              onClick={onClose}
              className="summary-close-btn"
              aria-label="Cerrar carrito"
            >
              <ChevronDown size={26} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {isEditMode && showRestaurantActions && (
        <div className="order-edit-notice" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Estás modificando un pedido guardado. Actualiza la mesa para conservar los cambios.
          </span>
        </div>
      )}

      {showRestaurantActions && (
        <div className="table-identifier-field">
          <label htmlFor="order-table-identifier">Mesa o identificador</label>
          <input
            id="order-table-identifier"
            type="text"
            className="table-identifier-input"
            placeholder="Ej. Mesa 4, Barra o Juan"
            value={tableData || ''}
            onChange={(event) => setTableData(event.target.value)}
          />
        </div>
      )}

      {order.length === 0 ? (
        <p className="empty-message">No hay productos en el pedido</p>
      ) : (
        <>
          <div className="order-list">
            {order.map((item) => {
              const itemClasses = `order-item${item.exceedsStock ? ' exceeds-stock' : ''}`;
              const hasModifiers = item.selectedModifiers && item.selectedModifiers.length > 0;
              const quantity = item.quantity || 1;
              const lineTotal = item.price * quantity;
              const isUnitSale = item.saleType === 'unit' || !item.saleType;

              return (
                <div key={item.id} className={itemClasses}>
                  <div className="order-item-info">
                    <div className="order-item-header">
                      <span className="order-item-name">
                        {item.name}
                        {item.priceWarning && (
                          <span
                            className="price-warning-icon"
                            title="Precio de mayoreo bloqueado por costo alto"
                          >
                            <ShieldAlert size={17} aria-hidden="true" />
                          </span>
                        )}
                      </span>

                      <strong className={`order-item-line-total${item.priceWarning ? ' order-item-line-total--warning' : ''}`}>
                        ${lineTotal.toFixed(2)}
                      </strong>
                    </div>

                    {hasModifiers && (
                      <div className="order-item-modifiers">
                        {item.selectedModifiers.map((modifier) => (
                          <span key={modifier.id || modifier.name} className="modifier-tag">
                            + {modifier.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.notes && (
                      <div className="order-item-notes">Nota: {item.notes}</div>
                    )}

                    <div className="order-item-price">
                      ${item.price.toFixed(2)} {isUnitSale ? 'c/u' : 'por unidad'}
                    </div>

                    {item.exceedsStock && (
                      <div className="stock-error-container">
                        <div className="stock-error-text">
                          <strong>
                            <AlertTriangle size={15} aria-hidden="true" />
                            Stock insuficiente
                          </strong>
                          <span>Solo quedan <b>{item.stock}</b> disponibles.</span>
                        </div>
                        <button
                          type="button"
                          className="btn-fix-stock"
                          onClick={() => updateItemQuantity(item.id, item.stock)}
                          title="Ajustar cantidad al máximo disponible"
                        >
                          Ajustar a {item.stock}
                        </button>
                      </div>
                    )}
                  </div>

                  {isUnitSale ? (
                    <div className="order-item-controls" aria-label={`Cantidad de ${item.name}`}>
                      <button
                        type="button"
                        className="quantity-btn"
                        onClick={() => handleQuantityChange(item.id, -1)}
                        aria-label={`Quitar una unidad de ${item.name}`}
                      >
                        −
                      </button>
                      <span className="quantity-display">{item.quantity}</span>
                      <button
                        type="button"
                        className="quantity-btn"
                        onClick={() => handleQuantityChange(item.id, 1)}
                        aria-label={`Agregar una unidad de ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <div className="order-item-controls order-item-controls--bulk">
                      <button
                        type="button"
                        className="btn-remove-item"
                        onClick={() => removeItem(item.id)}
                        title="Eliminar del pedido"
                        aria-label={`Eliminar ${item.name} del pedido`}
                      >
                        <Trash2 size={19} aria-hidden="true" />
                      </button>
                      <input
                        type="number"
                        className="bulk-input"
                        value={item.quantity || ''}
                        onChange={(event) => handleBulkInputChange(item.id, event.target.value)}
                        placeholder="0.0"
                        step="0.1"
                        min="0"
                        aria-label={`Cantidad de ${item.name}`}
                      />
                      <span className="unit-label">
                        {item.bulkData?.purchase?.unit?.toUpperCase() || 'KG'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <footer className="order-checkout">
            <div className="order-total">
              <span>Total</span>
              <span className="total-price">${total.toFixed(2)}</span>
            </div>

            <div className={`order-actions${showRestaurantActions ? ' order-actions--restaurant' : ''}`}>
              <button
                type="button"
                className="order-action-btn order-action-btn--primary"
                onClick={onOpenPayment}
              >
                <CreditCard size={21} aria-hidden="true" />
                <span>Cobrar</span>
                <strong>${total.toFixed(2)}</strong>
              </button>

              {showRestaurantActions && (
                <button
                  type="button"
                  className={`order-action-btn order-action-btn--save${isEditMode ? ' order-action-btn--update' : ''}`}
                  onClick={onSaveOpenOrder}
                  disabled={typeof onSaveOpenOrder !== 'function'}
                >
                  <Save size={19} aria-hidden="true" />
                  {isEditMode ? 'Actualizar Mesa' : 'Guardar/Enviar a Cocina'}
                </button>
              )}

              {showRestaurantActions && canSplitOrder && isEditMode && (
                <button
                  type="button"
                  className="order-action-btn order-action-btn--split"
                  onClick={onOpenSplit}
                  disabled={typeof onOpenSplit !== 'function'}
                >
                  <Columns2 size={19} aria-hidden="true" />
                  Dividir Cuenta
                </button>
              )}

              {features.hasLayaway && (
                <button
                  type="button"
                  className="order-action-btn order-action-btn--layaway"
                  onClick={onOpenLayaway}
                  title="Crear Apartado (Requiere Cliente)"
                >
                  <Bookmark size={19} aria-hidden="true" />
                  Apartar
                </button>
              )}

              <button
                type="button"
                className="order-action-btn order-action-btn--danger"
                onClick={handleCancelOrder}
              >
                <X size={19} aria-hidden="true" />
                {(isEditMode && showRestaurantActions) ? 'Salir sin guardar' : 'Cancelar'}
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
