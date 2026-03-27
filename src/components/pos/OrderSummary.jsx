// src/components/pos/OrderSummary.jsx
import { useOrderStore } from '../../store/useOrderStore';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig'
import './OrderSummary.css';

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
}) {
  const order = useOrderStore((state) => state.order);
  const tableData = useOrderStore((state) => state.tableData);
  const activeOrderId = useOrderStore((state) => state.activeOrderId);
  const isEditMode = Boolean(activeOrderId);
  const features = useFeatureConfig();
  // Nos aseguramos de tener 'removeItem' disponible
  const { updateItemQuantity, removeItem, clearSession, getTotalPrice, setTableData } = useOrderStore.getState();
  const total = getTotalPrice();

  const handleQuantityChange = (id, change) => {
    // ... (lógica existente para unitarios)
    const item = order.find(i => i.id === id);
    if (!item) return;
    if (item.saleType === 'unit' || !item.saleType) {
      const newQuantity = (item.quantity || 0) + change;
      if (newQuantity <= 0) removeItem(id);
      else updateItemQuantity(id, newQuantity);
    }
  };

  const handleBulkInputChange = (id, value) => {
    // ... (lógica existente para granel)
    const newQuantity = parseFloat(value);
    // Opcional: Si escriben 0, lo borramos también
    if (newQuantity === 0) {
      removeItem(id);
    } else {
      updateItemQuantity(id, isNaN(newQuantity) || newQuantity < 0 ? null : newQuantity);
    }
  };

  return (
    <div className="pos-order-container" style={isMobileModal ? { height: '100%', boxShadow: 'none', border: 'none' } : {}}>

      {/* Encabezado Unificado (Escritorio y Móvil) */}
      <div className="summary-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '15px',
        borderBottom: isMobileModal ? '1px solid var(--border-color)' : 'none',
        paddingBottom: isMobileModal ? '10px' : '0',
        // ESTILOS DINÁMICOS DE EDICIÓN
        backgroundColor: isEditMode ? '#fffbeb' : 'transparent',
        border: isEditMode ? '2px dashed #f59e0b' : 'none',
        padding: isEditMode ? '10px' : '0',
        borderRadius: isEditMode ? '8px' : '0'
      }}>
        <h2 style={{ margin: 0, fontSize: isMobileModal ? '1.2rem' : '1.5rem', color: isEditMode ? '#b45309' : 'inherit' }}>
          {isEditMode ? `✏️ Editando: ${tableData || 'Mesa'}` : (isMobileModal ? 'Tu Pedido' : 'Resumen del Pedido')}
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {!isMobileModal && showRestaurantActions && (
            <button
              onClick={onOpenTables}
              className="btn-mesas-header"
            >
              Mesas
              {activeTablesCount > 0 && (
                <span className="active-tables-count">
                  {activeTablesCount}
                </span>
              )}
            </button>
          )}

          {isMobileModal && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', padding: '5px', cursor: 'pointer' }}>
              <ChevronDown size={24} />
            </button>
          )}
        </div>
      </div>

      {/* Banner de advertencia si intenta cambiar el nombre mientras edita */}
      {isEditMode && showRestaurantActions && (
        <div style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '8px 15px', fontSize: '0.85rem', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold' }}>
          Estás modificando un pedido ya guardado. No olvides Actualizar la Mesa.
        </div>
      )}

      {/* --- NUEVO: INPUT PARA IDENTIFICAR LA MESA --- */}
      {showRestaurantActions && (
        <div style={{ padding: '0 15px 10px 15px', borderBottom: '1px solid var(--border-color)' }}>
          <input
            type="text"
            className="table-identifier-input" /* <-- Usamos una clase nueva */
            placeholder="Identificador (Ej. Mesa 4, Barra, Juan)"
            value={tableData || ''}
            onChange={(e) => setTableData(e.target.value)}
          />
        </div>
      )}

      {order.length === 0 ? (
        <p className="empty-message">No hay productos en el pedido</p>
      ) : (
        <>
          <div className="order-list">
            {order.map(item => {
              // ... (código de clases y modificadores igual) ...
              const itemClasses = `order-item ${item.exceedsStock ? 'exceeds-stock' : ''}`;
              const hasModifiers = item.selectedModifiers && item.selectedModifiers.length > 0;

              return (
                <div key={item.id} className={itemClasses}>
                  <div className="order-item-info">
                    <div className="order-item-header">
                      <span className="order-item-name">
                        {item.name}

                        {/* Agregamos el icono AQUÍ, dentro de tu span original para que herede la alineación */}
                        {item.priceWarning && (
                          <span
                            title="⚠️ Precio de Mayoreo bloqueado por Costo Alto"
                            style={{
                              marginLeft: '8px',
                              cursor: 'help',
                              fontSize: '0.9em' /* Un poco más chico que el texto para que se vea elegante */
                            }}
                          >
                            🛡️
                          </span>
                        )}
                      </span>
                      {item.exceedsStock && (
                        <div className="stock-error-container">
                          <div className="stock-error-text">
                            <strong>⚠️ Stock Insuficiente</strong>
                            <span>Solo quedan <b>{item.stock}</b> disponibles.</span>
                          </div>
                          {/* Botón inteligente para ajustar automáticamente al máximo */}
                          <button
                            className="btn-fix-stock"
                            onClick={() => updateItemQuantity(item.id, item.stock)}
                            title="Ajustar cantidad al máximo disponible"
                          >
                            Ajustar a {item.stock}
                          </button>
                        </div>
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
                    <div className="order-item-price">
                      <span style={{
                        color: item.priceWarning ? '#d97706' : 'inherit',
                        fontWeight: item.priceWarning ? 'bold' : 'inherit'
                      }}>
                        ${(item.price * (item.quantity || 1)).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {(item.saleType === 'unit' || !item.saleType) ? (
                    <div className="order-item-controls">
                      <button className="quantity-btn" onClick={() => handleQuantityChange(item.id, -1)}>−</button>
                      <span className="quantity-display">{item.quantity}</span>
                      <button className="quantity-btn" onClick={() => handleQuantityChange(item.id, 1)}>+</button>
                    </div>
                  ) : (
                    <div className="order-item-controls">

                      {/* --- NUEVO BOTÓN ELIMINAR PARA GRANEL --- */}
                      <button
                        className="btn-remove-item"
                        onClick={() => removeItem(item.id)}
                        title="Eliminar del pedido"
                      >
                        <Trash2 size={18} />
                      </button>
                      {/* -------------------------------------- */}

                      <input
                        type="number" className="bulk-input"
                        value={item.quantity || ''}
                        onChange={(e) => handleBulkInputChange(item.id, e.target.value)}
                        placeholder="0.0" step="0.1" min="0"
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

          {/* ... (Totales y botones inferiores siguen igual) ... */}
          <div className="order-total">
            <span>Total:</span>
            <span className="total-price">${total.toFixed(2)}</span>
          </div>

          <div className="order-actions">
            {showRestaurantActions && (
              <button
                className="process-btn save-open-btn"
                onClick={onSaveOpenOrder}
                disabled={typeof onSaveOpenOrder !== 'function'}
                style={{ backgroundColor: isEditMode ? '#f59e0b' : '' }} // Destacar el botón de actualizar
              >
                {isEditMode ? 'Actualizar Mesa' : 'Guardar/Enviar a Cocina'}
              </button>
            )}

            {showRestaurantActions && canSplitOrder && (
              <button
                className="process-btn split-btn"
                onClick={onOpenSplit}
                disabled={typeof onOpenSplit !== 'function'}
              >
                Dividir Cuenta
              </button>
            )}

            <button
              className={showRestaurantActions ? 'btn-secondary' : 'process-btn'}
              onClick={onOpenPayment}
            >
              Cobrar
            </button>
            {features.hasLayaway && (
              <button
                className="btn-layaway"
                onClick={onOpenLayaway}
                title="Crear Apartado (Requiere Cliente)"
              >
                Apartar
              </button>
            )}
            <button className="clear-btn" onClick={() => {
              const confirmMessage = isEditMode
                ? '¿Descartar los cambios no guardados y salir de la mesa?'
                : '¿Vaciar carrito?';

              if (window.confirm(confirmMessage)) {
                clearSession();
                if (isMobileModal) onClose();
              }
            }}>
              {isEditMode ? 'Salir sin guardar' : 'Cancelar'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
