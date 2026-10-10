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
import { useState, useMemo, useRef } from 'react';
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
import { getProductUnitShortLabel, resolveProductSaleUnit } from '../../utils/productUnitConfiguration';
import { formatSelectedModifiersForDisplay } from '../../utils/restaurantModifierDisplay';
import { canPerformRefunds } from '../../services/auth/salesPermissionPolicy';
import { captureRefundsActorHandle } from '../../services/auth/refundsActorAuthorization';
import { handlePosActorAuthorityError } from '../../hooks/pos/posActorAuthorityUi';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { isOriginRestaurantTable, isRestaurantCloudTableShadow } from '../../services/restaurant/restaurantCloudTableGuards';
import { useRestaurantTableCapabilities } from '../../hooks/restaurant/useRestaurantTableCapabilities';
import { showInputPromptModal } from '../common/InputPromptModal';
import OrderDiscountPanel from './OrderDiscountPanel';
import EcommercePosDraftBanner from './EcommercePosDraftBanner';
import './OrderSummary.css';
import './OrderSummaryRestInv2.css';

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
  const actorRuntime = useActorRuntimeSnapshot();
  const canManageRefunds = canPerformRefunds(actorRuntime);
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
  const total = getTotalPrice();
  const tablesBadgeTotal = activeTablesCount + kitchenRejectedOpenCount;
  const isEcommerceDraft = currentOrder?.origin === 'ecommerce';
  const tableCapabilities = useRestaurantTableCapabilities(currentOrder);
  const isRemoteTableReview = isRestaurantCloudTableShadow(currentOrder)
    || (isEditMode && Boolean(tableData) && !tableCapabilities.canEditTable);
  const isTableReview = isRemoteTableReview;
  const isOriginTable = isOriginRestaurantTable(currentOrder);
  const tableActionPending = useRef(false);
  const [isTableActionPending, setIsTableActionPending] = useState(false);
  const closingRemoteReview = useRef(false);
  const [isClosingRemoteReview, setIsClosingRemoteReview] = useState(false);
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
    if (isRemoteTableReview) return;
    const item = order.find((orderItem, index) => getCartLineId(orderItem, index) === lineId);
    if (!item) return;

    if (item.saleType === 'unit' || !item.saleType) {
      const newQuantity = (item.quantity || 0) + change;
      if (newQuantity <= 0) removeItem(lineId);
      else updateItemQuantity(lineId, newQuantity);
    }
  };

  const handleRemoveKitchenCancelledItems = async () => {
    if (isRemoteTableReview) return;
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
    if (isRemoteTableReview) return;
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
    if (isOriginTable || isRemoteTableReview) return;
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

    let actorHandle = null;
    if (isEditMode) {
      if (!canManageRefunds) return;
      try {
        actorHandle = captureRefundsActorHandle();
      } catch (error) {
        if (handlePosActorAuthorityError(error, 'cancel_order')) return;
        showMessageModal('No tienes permiso vigente para anular esta venta.', null, { type: 'error' });
        return;
      }
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
      await useActiveOrders.getState().cancelCurrentOrder({ actorHandle });
      if (isMobileModal) onClose?.();
    } catch (error) {
      if (handlePosActorAuthorityError(error, 'cancel_order')) return;
      console.error('Error cancelando orden:', error);
      showMessageModal(
        error?.message || 'No se pudo cancelar la orden. Intenta cerrar el cobro activo y vuelve a intentar.',
        null,
        { type: 'warning' }
      );
    }
  };

  const handleOriginTableAction = async (destructive) => {
    if (tableActionPending.current || !isOriginTable || (destructive && !canManageRefunds)) return;
    const id = currentOrderId;
    const snapshot = currentOrder;
    tableActionPending.current = true;
    setIsTableActionPending(true);
    try {
      const actor = destructive ? captureRefundsActorHandle() : actorRuntimeController.capture();
      const confirmed = await showConfirmModal(destructive
        ? 'Esta acción cancelará la mesa y liberará sus reservas pendientes. No se registrará una venta. ¿Deseas continuar?'
        : 'Se descartarán los cambios que no hayas guardado. La mesa seguirá abierta con su última versión guardada.', {
        title: destructive ? 'Cancelar mesa' : 'Salir sin guardar',
        ...(destructive ? { type: 'warning' } : {}),
        confirmButtonText: destructive ? 'Sí, cancelar mesa' : 'Salir sin guardar',
        cancelButtonText: destructive ? 'Volver' : 'Seguir editando'
      });
      if (!confirmed) return;
      actor.assertCurrent(destructive ? 'refunds' : undefined);
      let reason;
      if (destructive) {
        reason = await showInputPromptModal({ title: 'Cancelar mesa', message: 'Escribe el motivo de cancelación.', required: true });
        actor.assertCurrent('refunds');
        if (!reason) return;
      }
      const state = useActiveOrders.getState();
      if (state.activeOrders.get(id) !== snapshot || state.currentOrderId !== id) return;
      if (destructive) await state.cancelOrder(id, { actorHandle: actor, reason });
      else await state.discardTableEditSession(id, snapshot);
      if (isMobileModal) onClose?.();
    } catch (error) {
      if (handlePosActorAuthorityError(error, destructive ? 'cancel_order' : 'exit_table')) return;
      showMessageModal(error?.message || 'No se pudo completar la acción. Actualiza las mesas e intenta nuevamente.', null, { type: 'warning' });
    } finally {
      tableActionPending.current = false;
      setIsTableActionPending(false);
    }
  };
  const handleExitTableWithoutSaving = () => handleOriginTableAction(false);
  const handleCancelTable = () => handleOriginTableAction(true);

  const handleCloseRemoteReview = async () => {
    if (closingRemoteReview.current) return;
    const state = useActiveOrders.getState();
    const orderId = currentOrderId;
    const shadow = state.activeOrders.get(orderId);
    if (state.currentOrderId !== orderId || !shadow) return;
    if (!isRestaurantCloudTableShadow(shadow)) {
      try { await state.discardTableEditSession(orderId, shadow); }
      catch (error) { showMessageModal(error.message, null, { type: 'warning' }); }
      return;
    }

    closingRemoteReview.current = true;
    setIsClosingRemoteReview(true);
    try {
      // Session/scope continuity only: closing a local view requires no refunds permission.
      const actor = actorRuntimeController.capture();
      if (shadow.restaurantCloudTenantId !== actor.tenant.opaqueId
        || shadow.tenantOpaqueId !== actor.tenant.opaqueId) return;
      const confirmed = await showConfirmModal(
        'La mesa se quitará de este dispositivo, pero seguirá abierta y disponible en Mesas.',
        {
          title: 'Cerrar revisión',
          confirmButtonText: 'Cerrar revisión',
          cancelButtonText: 'Seguir revisando'
        }
      );
      if (!confirmed) return;
      actor.assertCurrent();
      const latest = useActiveOrders.getState();
      // A replaced/reloaded shadow is a different review, even if its ID was reused.
      if (latest.activeOrders.get(orderId) !== shadow || !isRestaurantCloudTableShadow(shadow)) return;
      const wasCurrent = latest.currentOrderId === orderId;
      await latest.removeOrder(orderId);
      actor.assertCurrent();
      if (wasCurrent && isMobileModal) onClose?.();
    } catch (error) {
      if (handlePosActorAuthorityError(error, 'close_remote_review')) return;
      showMessageModal('No se pudo cerrar la revisión. Intenta nuevamente.', null, { type: 'warning' });
    } finally {
      closingRemoteReview.current = false;
      setIsClosingRemoteReview(false);
    }
  };

  return (
    <div
      className={`pos-order-container${isMobileModal ? ' pos-order-container--mobile' : ''}${showRestaurantActions ? ' pos-order-container--restaurant' : ''}${isEditMode && showRestaurantActions ? ' pos-order-container--editing' : ''}${isEcommerceDraft ? ' pos-order-container--ecommerce' : ''}`}
    >
      <header className="summary-header">
        <div className="summary-header-copy">
          <h2 className="summary-title">
            {showRestaurantActions
              ? (isRemoteTableReview ? `Revisando: ${tableData || 'Mesa'}` : isEditMode ? `Editando: ${tableData || 'Mesa'}` : (isMobileModal ? 'Tu Pedido' : 'Resumen del Pedido'))
              : (tableData ? `Orden: ${tableData}` : (isMobileModal ? 'Tu Pedido' : 'Resumen del Pedido'))}
          </h2>

          {!isEditMode && (
            <p className="summary-folio">
              Folio POS: <strong>{currentOrder?.posFolio || currentOrder?.pos_folio || 'se asigna al confirmar'}</strong>
            </p>
          )}

          {isEditMode && showRestaurantActions && (
            <span className="summary-edit-badge">{isRemoteTableReview ? 'Vista Cloud · Solo lectura' : 'Pedido guardado'}</span>
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
              disabled={isRemoteTableReview}
              title={isRemoteTableReview ? 'Solo se puede cambiar el nombre desde la sesión de origen.' : undefined}
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
            {isRemoteTableReview
              ? 'Vista sincronizada de solo lectura. Puedes revisar y cobrar. Para editar productos o cancelar, utiliza la sesión de origen.'
              : 'Estás modificando un pedido guardado. Actualiza la mesa para conservar los cambios.'}
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
              const quantityInputProps = getOrderQuantityInputProps(item);
              const usesDirectQuantityInput = item.saleType === 'bulk' || quantityInputProps.step !== '1';
              const isUnitSale = !usesDirectQuantityInput;
              const saleUnit = resolveProductSaleUnit(item);
              const saleUnitLabel = getProductUnitShortLabel(saleUnit);
              const displayQuantity = usesDirectQuantityInput ? Number(quantity).toFixed(3) : quantity;
              const isFractioned = item.conversionFactor?.enabled === true;

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
                      {displayQuantity} {saleUnitLabel} × ${item.price.toFixed(2)}/{saleUnitLabel}
                    </div>
                    {isFractioned && <div className="order-item-sale-mode">Fraccionado · Venta por {saleUnitLabel}</div>}

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
                          disabled={isRemoteTableReview}
                          title={isRemoteTableReview ? 'Mesa en modo solo lectura' : 'Ajustar cantidad al máximo disponible'}
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
                        {!isRemoteTableReview && !isAccountAdjustedForKitchenCancelledItems && (
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

                  {!isRemoteTableReview && (isUnitSale ? (
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
                  ))}
                </div>
              );
            })}
          </div>
      )}

      </div>

      {!isEcommerceDraft && !isRemoteTableReview && order.length > 0 && isDiscountModalOpen && (
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

            <OrderDiscountPanel
              compact
              restaurant={showRestaurantActions}
              embedded
              defaultExpanded
            />
          </div>
        </div>
      )}

      {(order.length > 0 || isRemoteTableReview || isOriginTable) && (
          <footer className="order-checkout">
            {!isEcommerceDraft && !isRemoteTableReview && order.length > 0 && (
              <div className="order-discount-trigger-row">
                <OrderDiscountPanel
                  compact
                  restaurant={showRestaurantActions}
                  triggerOnly
                  onOpen={() => setIsDiscountModalOpen(true)}
                />
              </div>
            )}
            <div className="order-total">
              <div className="order-total-copy">
                <span>Total</span>
              </div>
              <span className="total-price">${total.toFixed(2)}</span>
            </div>

            <div className={`order-actions${showRestaurantActions ? ' order-actions--restaurant' : ''}`}>
              {order.length > 0 && (!isEditMode || !tableData || tableCapabilities.canCheckoutTable) && (
              <button
                type="button"
                className="order-action-btn order-action-btn--primary"
                onClick={onOpenPayment}
              >
                <CreditCard size={21} aria-hidden="true" />
                <span>Cobrar</span>
              </button>
              )}

              {showRestaurantActions && !isTableReview && order.length > 0 && (
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

              {showRestaurantActions && tableCapabilities.canSplitTable && canSplitOrder && isEditMode && order.length > 0 && (
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

              {!isTableReview && features.hasLayaway && order.length > 0 && (
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

              {isRemoteTableReview && (
                <button
                  type="button"
                  className="order-action-btn"
                  onClick={handleCloseRemoteReview}
                  disabled={isClosingRemoteReview}
                >
                  <X size={19} aria-hidden="true" />
                  Cerrar revisión
                </button>
              )}

              {isOriginTable && (
                <button type="button" className="order-action-btn" onClick={handleExitTableWithoutSaving}
                  disabled={isTableActionPending}>
                  <X size={19} aria-hidden="true" />
                  Salir sin guardar
                </button>
              )}
              {isOriginTable && tableCapabilities.canCancelTable && canManageRefunds && (
                <button type="button" className="order-action-btn order-action-btn--danger" onClick={handleCancelTable}
                  disabled={isTableActionPending}>
                  <Trash2 size={19} aria-hidden="true" />
                  Cancelar mesa
                </button>
              )}
              {!isOriginTable && !isRemoteTableReview && (!isEditMode || isEcommerceDraft || canManageRefunds) && (
                <button
                  type="button"
                  className="order-action-btn order-action-btn--danger"
                  onClick={handleCancelOrder}
                >
                  <X size={19} aria-hidden="true" />
                  {isEcommerceDraft ? 'Liberar borrador' : 'Cancelar'}
                </button>
              )}
            </div>
          </footer>
      )}
    </div>
  );
}
