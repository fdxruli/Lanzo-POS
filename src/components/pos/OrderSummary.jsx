// src/components/pos/OrderSummary.jsx
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  CheckCircle2,
  CircleDot,
  Clock,
  Columns2,
  CreditCard,
  MapPin,
  Save,
  ShieldAlert,
  Table2,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import {
  buildRestaurantCloudStatusSummary,
  RESTAURANT_CLOUD_STATUS_EVENT,
  useRestaurantOrderCloudStatus
} from '../../hooks/restaurant/useRestaurantOrderCloudStatus';
import { db, STORES } from '../../services/db/dexie';
import {
  getRestaurantCloudItemLocalLineId,
  isCartItemCancelledByKitchen
} from '../../services/restaurant/restaurantOrderReconciliation';
import {
  applyKitchenCancelledItemsAdjustment,
  persistKitchenCancelledItemsAdjustment
} from '../../services/restaurant/restaurantOrderAccountAdjustment';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { getOrderQuantityInputProps } from '../../utils/quantityInputStep';
import { formatSelectedModifiersForDisplay } from '../../utils/restaurantModifierDisplay';
import OrderDiscountPanel from './OrderDiscountPanel';
import EcommercePosDraftBanner from './EcommercePosDraftBanner';
import './OrderSummary.css';
import './OrderSummaryRestInv2.css';

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

const normalizeRestaurantItemStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const RESTAURANT_ITEM_STATUS_META = {
  pending: { Icon: Clock, fallbackLabel: 'Pendiente' },
  preparing: { Icon: CircleDot, fallbackLabel: 'Preparando' },
  ready: { Icon: CheckCircle2, fallbackLabel: 'Listo' },
  delivered: { Icon: CheckCircle2, fallbackLabel: 'Entregado' },
  cancelled: { Icon: XCircle, fallbackLabel: 'Cancelado' },
};

const getRestaurantItemStatusMeta = (status) => (
  RESTAURANT_ITEM_STATUS_META[status] || RESTAURANT_ITEM_STATUS_META.pending
);

const getRestaurantItemAreaName = (item = {}) => (
  item.stationName
  || item.station_name
  || item.areaName
  || item.area_name
  || item.preparationAreaName
  || item.preparation_area_name
  || item.stationId
  || item.station_id
  || 'Cocina'
);

const renderModifierTags = (labels = [], keyPrefix = 'modifier') => (
  labels.map((label, index) => (
    <span key={`${keyPrefix}-modifier-${index}`} className="modifier-tag">
      {label}
    </span>
  ))
);

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
  const navigate = useNavigate();
  const currentOrderId = useActiveOrders((state) => state.currentOrderId);
  const currentOrder = useActiveOrders((state) => (
    state.currentOrderId ? state.activeOrders.get(state.currentOrderId) || null : null
  ));
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
  const cloudItemsByLineId = useMemo(() => {
    const itemsByLineId = new Map();
    cloudItems.forEach((item) => {
      const lineId = getRestaurantCloudItemLocalLineId(item);
      if (lineId && !itemsByLineId.has(lineId)) {
        itemsByLineId.set(lineId, item);
      }
    });
    return itemsByLineId;
  }, [cloudItems]);

  const [estimatedFolio, setEstimatedFolio] = useState('');
  const [isAdjustingKitchenCancelledItems, setIsAdjustingKitchenCancelledItems] = useState(false);
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const cancelledKitchenAdjustmentPreview = useMemo(
    () => applyKitchenCancelledItemsAdjustment({
      orderId: currentOrderId,
      orderItems: order,
      cloudItems
    }),
    [cloudItems, currentOrderId, order]
  );
  const isAccountAdjustedForKitchenCancelledItems = Boolean(
    cloudStatus.hasCancelledItems
    && cancelledKitchenAdjustmentPreview.success
    && !cancelledKitchenAdjustmentPreview.changed
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
  const isEcommerceDraft = currentOrder?.origin === 'ecommerce';
  const ecommerceLocalSubtotal = useMemo(() => order.reduce(
    (sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)),
    0
  ), [order]);
  const ecommerceWarnings = useMemo(() => {
    if (!isEcommerceDraft) return [];
    const warnings = [];
    if (Math.abs(ecommerceLocalSubtotal - Number(currentOrder.expectedSubtotal || 0)) > 0.009) {
      warnings.push('El subtotal local no coincide con el subtotal ecommerce.');
    }
    if (order.some((item) => Math.abs(Number(item.currentPosPrice || 0) - Number(item.ecommerceSnapshotPrice || 0)) > 0.009)) {
      warnings.push('Hay precios POS actuales diferentes al precio aceptado por el cliente.');
    }
    if (order.some((item) => item.needsInventoryResolution)) {
      warnings.push('Hay productos con lote pendiente de resolver en la siguiente fase.');
    }
    if (order.some((item) => item.ecommerceProductMissing)) {
      warnings.push('Hay un producto faltante en el catálogo local.');
    }
    return warnings;
  }, [currentOrder, ecommerceLocalSubtotal, isEcommerceDraft, order]);

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

      const activeOrderState = useActiveOrders.getState().activeOrders.get(currentOrderId);
      const adjustedOrderSnapshot = {
        ...activeOrderState,
        id: currentOrderId,
        items: adjustment.kept,
        isSaved: true
      };
      const saveResult = await useActiveOrders.getState().saveOrderAsOpen(currentOrderId, adjustedOrderSnapshot);

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
    if (isEcommerceDraft) {
      const confirmed = await showConfirmModal(
        'El pedido seguirá aceptado en la bandeja y podrá prepararse nuevamente. No se registrará ninguna venta.',
        {
          title: 'Liberar borrador',
          type: 'warning',
          confirmButtonText: 'Liberar borrador',
          cancelButtonText: 'Volver'
        }
      );
      if (!confirmed) return;

      const result = await useActiveOrders.getState().releaseEcommerceDraft(currentOrderId, 'released_from_pos');
      if (result?.success === false) {
        showMessageModal(result.message || 'No se pudo liberar el borrador. Intenta nuevamente.', null, { type: 'error' });
        return;
      }
      if (isMobileModal) onClose?.();
      showMessageModal('Borrador liberado. El pedido continúa aceptado.', null, { type: 'success' });
      return;
    }

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
      className={`pos-order-container${isMobileModal ? ' pos-order-container--mobile' : ''}${showRestaurantActions ? ' pos-order-container--restaurant' : ''}${isEditMode && showRestaurantActions ? ' pos-order-container--editing' : ''}`}
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
      </header>

      <div className={showRestaurantActions ? 'restaurant-order-scroll' : 'order-summary-main'}>
      {isEcommerceDraft && (
        <EcommercePosDraftBanner
          order={currentOrder}
          warnings={ecommerceWarnings}
          onOpenDetail={() => navigate(`/pedidos-online?order=${currentOrder.ecommerceOrderId}`)}
        />
      )}
      {isEditMode && showRestaurantActions && (
        <div className="order-edit-notice" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Estás modificando un pedido guardado. Actualiza la mesa para conservar los cambios.
          </span>
        </div>
      )}


      {order.length === 0 ? (
        <p className="empty-message">No hay productos en el pedido</p>
      ) : (
          <div className="order-list">
            {order.map((item, index) => {
              const lineId = getCartLineId(item, index);
              const itemClasses = `order-item${item.exceedsStock ? ' exceeds-stock' : ''}`;
              const cloudItem = cloudItemsByLineId.get(String(lineId || '').trim()) || null;
              const kitchenMetaItem = cloudItem || item;
              const cloudItemStatus = normalizeRestaurantItemStatus(cloudItem?.status);
              const statusMeta = getRestaurantItemStatusMeta(cloudItemStatus);
              const StatusIcon = statusMeta.Icon;
              const stationName = getRestaurantItemAreaName(kitchenMetaItem);
              const statusLabel = cloudItem
                ? cloudStatus.getItemStatusLabel(cloudItemStatus) || statusMeta.fallbackLabel
                : statusMeta.fallbackLabel;
              const hasKitchenArea = showRestaurantActions && Boolean(
                cloudItem
                || item.stationName
                || item.station_name
                || item.areaName
                || item.area_name
                || item.preparationAreaName
                || item.preparation_area_name
                || item.stationId
                || item.station_id
              );
              const isKitchenCancelled = cloudItemStatus === 'cancelled' || isCartItemCancelledByKitchen(item, index, cloudItems);
              const modifierLabels = formatSelectedModifiersForDisplay(item.selectedModifiers);
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

                    {modifierLabels.length > 0 && (
                      <div className="order-item-modifiers" aria-label="Extras seleccionados">
                        <span className="order-item-modifiers-label">Extras:</span>
                        {renderModifierTags(modifierLabels, lineId)}
                      </div>
                    )}

                    {item.notes && (
                      <div className="order-item-notes">Nota: {item.notes}</div>
                    )}

                    <div className="order-item-price">
                      ${item.price.toFixed(2)} {isUnitSale ? 'c/u' : 'por unidad'}
                    </div>

                    {showRestaurantActions && (cloudItem || hasKitchenArea) && (
                      <div className="order-item-kitchen-tags" aria-label="Estado de cocina">
                        {hasKitchenArea && (
                          <span className="order-item-kitchen-tag order-item-kitchen-tag--area">
                            <MapPin size={13} aria-hidden="true" />
                            {stationName}
                          </span>
                        )}
                        {cloudItem && (
                          <span className={`order-item-kitchen-tag order-item-kitchen-tag--${cloudItemStatus}`}>
                            <StatusIcon size={13} aria-hidden="true" />
                            {statusLabel}
                          </span>
                        )}
                      </div>
                    )}

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
                        <div className="order-item-kitchen-cancelled-copy">
                          <AlertTriangle size={15} aria-hidden="true" />
                          <span>Cancelado por cocina. Quitar de la cuenta antes de cobrar.</span>
                        </div>
                        {!isAccountAdjustedForKitchenCancelledItems && (
                          <button
                            type="button"
                            className="order-item-kitchen-adjust-btn"
                            onClick={handleRemoveKitchenCancelledItems}
                            disabled={isAdjustingKitchenCancelledItems}
                          >
                            {isAdjustingKitchenCancelledItems ? 'Ajustando...' : 'Retirar'}
                          </button>
                        )}
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
      )}

      </div>

      {showRestaurantActions && order.length > 0 && isDiscountModalOpen && (
        <div
          className="order-discount-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-discount-modal-title"
          onClick={() => setIsDiscountModalOpen(false)}
        >
          <div className="order-discount-modal-sheet" onClick={(event) => event.stopPropagation()}>
            <header className="order-discount-modal-header">
              <h3 id="order-discount-modal-title">Descuentos</h3>
              <button
                type="button"
                className="order-discount-modal-close"
                onClick={() => setIsDiscountModalOpen(false)}
                aria-label="Cerrar descuentos"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </header>

            <OrderDiscountPanel compact restaurant embedded defaultExpanded />
          </div>
        </div>
      )}

      {order.length > 0 && (
          <footer className="order-checkout">
            <div className="order-total">
              <div className="order-total-copy">
                <span>Total</span>
                {showRestaurantActions && (
                  <div className="order-discount-mobile-slot">
                    <OrderDiscountPanel
                      compact
                      restaurant
                      triggerOnly
                      onOpen={() => setIsDiscountModalOpen(true)}
                    />
                  </div>
                )}
              </div>
              <span className="total-price">${total.toFixed(2)}</span>
            </div>

            {showRestaurantActions && (
              <div className="order-discount-desktop-slot">
                <OrderDiscountPanel compact restaurant embedded />
              </div>
            )}

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
                {isEcommerceDraft ? 'Liberar borrador' : ((isEditMode && showRestaurantActions) ? 'Salir sin guardar' : 'Cancelar')}
              </button>
            </div>
          </footer>
      )}
    </div>
  );
}
