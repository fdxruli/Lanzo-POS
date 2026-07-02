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
import { useState, useEffect, useMemo } from 'react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import {
  buildRestaurantCloudStatusSummary,
  RESTAURANT_CLOUD_STATUS_EVENT,
  useRestaurantOrderCloudStatus
} from '../../hooks/restaurant/useRestaurantOrderCloudStatus';
import { db, STORES } from '../../services/db/dexie';
import { isCartItemCancelledByKitchen } from '../../services/restaurant/restaurantOrderReconciliation';
import {
  applyKitchenCancelledItemsAdjustment,
  persistKitchenCancelledItemsAdjustment
} from '../../services/restaurant/restaurantOrderAccountAdjustment';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { getOrderQuantityInputProps } from '../../utils/quantityInputStep';
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
  const currentOrderId = useActiveOrders((state) => state.currentOrderId);
  const currentOrderItems = useActiveOrders((state) => (
    state.currentOrderId ? state.activeOrders.get(state.currentOrderId)?.items : undefined
  ));
  const order = useMemo(() => currentOrderItems || [], [currentOrderItems]);
  const tableData = useActiveOrders((state) => (
    state.currentOrderId ? state.activeOrders.get(state.currentOrderId)?.tableData || '' : ''
  ));
  const isEditMode = useActiveOrders((state) => (
    state.currentOrderId ? Boolean(state.activeOrders.get(state.currentOrderId)?.isSaved) : false
  ));
  const updateItemQuantity = useActiveOrders((state) => state.updateItemQuantity);
  const updateCurrentOrderItems = useActiveOrders((state) => state.updateCurrentOrderItems);
  const removeItem = useActiveOrders((state) => state.removeItem);
  const getTotalPrice = useActiveOrders((state) => state.getTotalPrice);
  const setTableData = useActiveOrders((state) => state.setTableData);
  const features = useFeatureConfig();
  const cloudStatus = useRestaurantOrderCloudStatus({
    localOrderId: currentOrderId,
    enabled: Boolean(showRestaurantActions && isEditMode && currentOrderId)
  });
  const cloudItems = useMemo(
    () => (Array.isArray(cloudStatus.items) ? cloudStatus.items : []),
    [cloudStatus.items]
  );
  const showCloudStatusPanel = cloudStatus.isCloudStatusEnabled && (
    cloudStatus.isLoading || cloudStatus.error || cloudStatus.cloudOrder
  );

  const [estimatedFolio, setEstimatedFolio] = useState('');
  const [isAdjustingKitchenCancelledItems, setIsAdjustingKitchenCancelledItems] = useState(false);
  const cancelledKitchenAdjustmentPreview = useMemo(
    () => applyKitchenCancelledItemsAdjustment({
      orderId: currentOrderId,
      orderItems: order,
      cloudItems
    }),
    [cloudItems, currentOrderId, order]
  );

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

  const handleQuantityChange = (lineId, change) => {
    const item = order.find((orderItem, index) => getCartLineId(orderItem, index) === lineId);
    if (!item) return;

    if (item.saleType === 'unit' || !item.saleType) {
      const newQuantity = (item.quantity || 0) + change;
      if (newQuantity <= 0) removeItem(lineId);
      else updateItemQuantity(lineId, newQuantity);
    }
  };

  const handleRemoveKitchenCancelledItems = async () => {
    if (!currentOrderId || !isEditMode) {
      showMessageModal('Primero carga una mesa guardada para ajustar cancelaciones de cocina.', null, { type: 'warning' });
      return;
    }

    setIsAdjustingKitchenCancelledItems(true);
    try {
      const refreshed = await cloudStatus.refresh({ force: true });
      if (refreshed?.success === false) {
        showMessageModal(
          refreshed.message || 'No se pudo verificar cocina cloud. Intenta de nuevo antes de ajustar la cuenta.',
          null,
          { type: 'warning' }
        );
        return;
      }

      const latestSummary = buildRestaurantCloudStatusSummary(refreshed?.order || cloudStatus.cloudOrder);
      if (!latestSummary.hasCancelledItems) {
        showMessageModal('Cocina ya no reporta items cancelados para esta mesa.', null, { type: 'success' });
        return;
      }

      const adjustment = applyKitchenCancelledItemsAdjustment({
        orderId: currentOrderId,
        orderItems: order,
        cloudItems: latestSummary.items
      });

      if (!adjustment.success) {
        showMessageModal(adjustment.message, null, { type: 'warning' });
        return;
      }

      if (!adjustment.changed) {
        showMessageModal('Los items cancelados por cocina ya no están en la cuenta.', null, { type: 'success' });
        return;
      }

      const confirmed = await showConfirmModal(
        `Cocina canceló ${latestSummary.cancelledItems.length} item(s). ¿Quieres retirarlos de la cuenta local?`,
        {
          title: 'Retirar cancelados de la cuenta',
          type: 'warning',
          confirmButtonText: 'Sí, retirar',
          cancelButtonText: 'Volver'
        }
      );

      if (!confirmed) return;

      updateCurrentOrderItems(adjustment.kept);

      const activeOrderState = useActiveOrders.getState().activeOrders.get(currentOrderId);
      const saveResult = await useActiveOrders.getState().saveOrderAsOpen(currentOrderId, {
        ...activeOrderState,
        id: currentOrderId,
        items: adjustment.kept,
        isSaved: true
      });

      if (!saveResult?.success) {
        showMessageModal(saveResult?.message || 'No se pudo guardar la mesa ajustada.', null, { type: 'error' });
        return;
      }

      const auditResult = await persistKitchenCancelledItemsAdjustment({
        orderId: currentOrderId,
        audit: adjustment.audit
      });
      if (auditResult?.success === false) {
        console.warn('[REST.6] No se pudo guardar auditoría local de ajuste:', auditResult.message);
      }

      const persistedSale = await db.table(STORES.SALES).get(currentOrderId);
      const persistedItems = Array.isArray(persistedSale?.items) ? persistedSale.items : adjustment.kept;
      useActiveOrders.getState().updateOrderItems(currentOrderId, persistedItems);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(RESTAURANT_CLOUD_STATUS_EVENT));
      }
      await cloudStatus.refresh({ force: true });

      showMessageModal(
        `Cuenta actualizada. Se retiraron ${adjustment.removedCount} item(s) cancelados por cocina.`,
        null,
        { type: 'success' }
      );
    } catch (error) {
      console.error('[REST.6] Error ajustando cancelados en OrderSummary:', error);
      showMessageModal(error?.message || 'No se pudo ajustar la cuenta.', null, { type: 'error' });
    } finally {
      setIsAdjustingKitchenCancelledItems(false);
    }
  };

  const handleBulkInputChange = (lineId, value) => {
    const newQuantity = parseFloat(value);
    if (newQuantity === 0) {
      removeItem(lineId);
    } else {
      updateItemQuantity(lineId, Number.isNaN(newQuantity) || newQuantity < 0 ? null : newQuantity);
    }
  };

  const handleOpenTables = () => {
    if (isMobileModal) onClose?.();
    onOpenTables?.();
  };

  const handleCancelOrder = async () => {
    const confirmMessage = (isEditMode && showRestaurantActions)
      ? '¿Descartar los cambios no guardados y salir de la mesa?'
      : '¿Vaciar carrito?';

    const confirmed = await showConfirmModal(confirmMessage, {
      title: isEditMode && showRestaurantActions ? 'Salir sin guardar' : 'Vaciar carrito',
      confirmButtonText: isEditMode && showRestaurantActions ? 'Si, salir' : 'Si, vaciar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirmed) return;

    try {
      await useActiveOrders.getState().cancelCurrentOrder();
      if (isMobileModal) onClose?.();
    } catch (error) {
      console.error('Error cancelando orden:', error);
      showMessageModal(
        error?.message || 'No se pudo cancelar la orden. Intenta cerrar el cobro activo y vuelve a intentar.',
        null,
        { type: 'warning' }
      );
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

      {showCloudStatusPanel && (
        <section
          className={`order-cloud-status-panel${cloudStatus.hasCancelledItems ? ' order-cloud-status-panel--warning' : ''}${cloudStatus.isCancelled ? ' order-cloud-status-panel--danger' : ''}${cloudStatus.isReady ? ' order-cloud-status-panel--ready' : ''}`}
          aria-label="Estado de cocina cloud"
        >
          <div className="order-cloud-status-header">
            <span className="order-cloud-status-title">Cocina cloud</span>
            {cloudStatus.cloudOrder && (
              <span className={`order-cloud-status-badge order-cloud-status-badge--${cloudStatus.status}`}>
                {cloudStatus.isCancelled ? 'Comanda cancelada' : cloudStatus.statusLabel}
              </span>
            )}
          </div>

          {cloudStatus.isLoading && !cloudStatus.cloudOrder && (
            <p className="order-cloud-status-copy">Verificando estado operativo…</p>
          )}

          {cloudStatus.error && (
            <p className="order-cloud-status-copy order-cloud-status-copy--warning">
              {cloudStatus.error}
            </p>
          )}

          {cloudStatus.cloudOrder && (
            <>
              {cloudStatus.isReady && !cloudStatus.hasCancelledItems && (
                <p className="order-cloud-status-copy">La comanda está lista en cocina.</p>
              )}
              {cloudStatus.hasPendingItems && (
                <p className="order-cloud-status-copy order-cloud-status-copy--warning">
                  Hay items pendientes en cocina. Confirma antes de cobrar.
                </p>
              )}
              {cloudStatus.hasPreparingItems && (
                <p className="order-cloud-status-copy order-cloud-status-copy--warning">
                  Hay items en preparación. La comanda aún no está marcada como lista.
                </p>
              )}
              {cloudStatus.hasCancelledItems && (
                <div className="order-cloud-status-action-block">
                  <p className="order-cloud-status-copy order-cloud-status-copy--danger">
                    Esta mesa tiene items cancelados en cocina. Puedes retirarlos de la cuenta antes de cobrar.
                  </p>
                  <button
                    type="button"
                    className="order-cloud-adjust-btn"
                    onClick={handleRemoveKitchenCancelledItems}
                    disabled={isAdjustingKitchenCancelledItems}
                  >
                    {isAdjustingKitchenCancelledItems ? 'Ajustando…' : 'Retirar cancelados'}
                  </button>
                  {cancelledKitchenAdjustmentPreview.code === 'KITCHEN_CANCELLED_ITEMS_UNMATCHED' && (
                    <p className="order-cloud-status-copy order-cloud-status-copy--warning">
                      Hay cancelaciones de cocina que no coinciden con una línea local. Revisa manualmente.
                    </p>
                  )}
                  {cancelledKitchenAdjustmentPreview.code === 'KITCHEN_CANCELLED_ITEMS_EMPTY_ACCOUNT' && (
                    <p className="order-cloud-status-copy order-cloud-status-copy--warning">
                      Si retiras todo, la cuenta quedaría vacía. Anula la venta si cocina canceló toda la comanda.
                    </p>
                  )}
                  {cancelledKitchenAdjustmentPreview.success && !cancelledKitchenAdjustmentPreview.changed && (
                    <p className="order-cloud-status-copy">
                      Los items cancelados en cocina ya no están en la cuenta.
                    </p>
                  )}
                </div>
              )}

              {cloudItems.length > 0 && (
                <div className="order-cloud-items-list">
                  {cloudItems.map((item) => {
                    const itemStatus = String(item?.status || 'pending').toLowerCase();
                    const isCancelledItem = itemStatus === 'cancelled';
                    const cloudItemKey = item.id
                      || item.orderItemId
                      || item.order_item_id
                      || item.localLineId
                      || item.local_line_id
                      || item.lineId
                      || item.line_id
                      || item.cartItemId
                      || `${item.productName || item.name || 'producto'}-${item.stationName || item.stationId || 'cocina'}-${itemStatus}-${item.quantity || 0}`;
                    return (
                      <div
                        key={cloudItemKey}
                        className={`order-cloud-item${isCancelledItem ? ' order-cloud-item--cancelled' : ''}`}
                      >
                        <div className="order-cloud-item-main">
                          <span className="order-cloud-item-qty">{item.quantity}x</span>
                          <span className="order-cloud-item-name">{item.productName || item.name || 'Producto'}</span>
                        </div>
                        <div className="order-cloud-item-meta">
                          <span>{item.stationName || 'Cocina'}</span>
                          <span className={`order-cloud-item-badge order-cloud-item-badge--${itemStatus}`}>
                            {cloudStatus.getItemStatusLabel(itemStatus)}
                          </span>
                        </div>
                        {isCancelledItem && (
                          <div className="order-cloud-item-warning">Ajustar cuenta si aplica</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
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
            {order.map((item, index) => {
              const lineId = getCartLineId(item, index);
              const itemClasses = `order-item${item.exceedsStock ? ' exceeds-stock' : ''}`;
              const isKitchenCancelled = isCartItemCancelledByKitchen(item, index, cloudItems);
              const hasModifiers = item.selectedModifiers && item.selectedModifiers.length > 0;
              const quantity = item.quantity || 1;
              const lineTotal = item.price * quantity;
              const isUnitSale = item.saleType === 'unit' || !item.saleType;
              const quantityInputProps = getOrderQuantityInputProps(item);

              return (
                <div key={lineId} className={`${itemClasses}${isKitchenCancelled ? ' order-item--kitchen-cancelled' : ''}`}>
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
                          onClick={() => updateItemQuantity(lineId, item.stock)}
                          title="Ajustar cantidad al máximo disponible"
                        >
                          Ajustar a {item.stock}
                        </button>
                      </div>
                    )}

                    {isKitchenCancelled && (
                      <div className="order-item-kitchen-cancelled">
                        <AlertTriangle size={15} aria-hidden="true" />
                        Cancelado por cocina. Quitar de la cuenta antes de cobrar.
                      </div>
                    )}
                  </div>

                  {isUnitSale ? (
                    <div className="order-item-controls" aria-label={`Cantidad de ${item.name}`}>
                      <button
                        type="button"
                        className="quantity-btn"
                        onClick={() => handleQuantityChange(lineId, -1)}
                        aria-label={`Quitar una unidad de ${item.name}`}
                      >
                        −
                      </button>
                      <span className="quantity-display">{item.quantity}</span>
                      <button
                        type="button"
                        className="quantity-btn"
                        onClick={() => handleQuantityChange(lineId, 1)}
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
                        onClick={() => removeItem(lineId)}
                        title="Eliminar del pedido"
                        aria-label={`Eliminar ${item.name} del pedido`}
                      >
                        <Trash2 size={19} aria-hidden="true" />
                      </button>
                      <input
                        type="number"
                        className="bulk-input"
                        value={item.quantity || ''}
                        onChange={(event) => handleBulkInputChange(lineId, event.target.value)}
                        placeholder="0.0"
                        step={quantityInputProps.step}
                        inputMode={quantityInputProps.inputMode}
                        min="0"
                        aria-label={`Cantidad de ${item.name}`}
                      />
                      <span className="unit-label">
                        {quantityInputProps.unit.toUpperCase()}
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
