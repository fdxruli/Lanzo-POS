import { showConfirmModal, showMessageModal } from '../../services/utils';
import CloudKitchenMonitorRest8 from './CloudKitchenMonitorRest8';

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);
const ACTIVE_ITEM_TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);

const normalizeOrderStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const getOrderStatus = (order = {}) => normalizeOrderStatus(order.fulfillmentStatus || order.status);
const getOrderItems = (order = {}) => (Array.isArray(order.items) ? order.items : []);
const getItemId = (item = {}) => item.id || item.restaurantOrderItemId || item.restaurant_order_item_id || null;
const getItemStatus = (item = {}) => normalizeOrderStatus(item.status || item.fulfillmentStatus || item.fulfillment_status || 'pending');
const getActiveOrderItems = (order = {}) => getOrderItems(order).filter((item) => getItemStatus(item) !== 'cancelled');

const getCloudOrderProgress = (order = {}) => {
  const activeItems = getActiveOrderItems(order);
  const pendingItems = activeItems.filter((item) => getItemStatus(item) === 'pending');
  const preparingItems = activeItems.filter((item) => getItemStatus(item) === 'preparing');
  const readyItems = activeItems.filter((item) => getItemStatus(item) === 'ready');

  return {
    activeItems,
    pendingItems,
    preparingItems,
    readyItems,
    hasActiveItems: activeItems.length > 0,
    hasPendingItems: pendingItems.length > 0,
    hasPreparingItems: preparingItems.length > 0,
    allReady: activeItems.length > 0 && readyItems.length === activeItems.length
  };
};

const getCloudStatusAction = (order) => {
  const status = getOrderStatus(order);
  if (TERMINAL_STATUSES.has(status)) return null;

  const progress = getCloudOrderProgress(order);
  if (status === 'ready' && (!progress.hasActiveItems || progress.allReady)) {
    return { nextStatus: 'delivered', label: 'Marcar entregado', className: 'deliver' };
  }

  if (progress.hasPendingItems) {
    return {
      nextStatus: 'preparing',
      label: progress.hasPreparingItems || progress.readyItems.length > 0 ? 'Preparar faltantes' : 'Marcar en preparación',
      className: 'advance'
    };
  }

  if (progress.hasPreparingItems) return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };
  if (progress.allReady) return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };

  return null;
};

const shouldAdvanceItemForOrderStatus = (item, nextStatus) => {
  const itemStatus = getItemStatus(item);
  if (itemStatus === nextStatus || itemStatus === 'cancelled') return false;
  if (nextStatus === 'preparing') return itemStatus === 'pending';
  if (nextStatus === 'ready') return itemStatus === 'preparing';
  if (nextStatus === 'delivered') return !ACTIVE_ITEM_TERMINAL_STATUSES.has(itemStatus);
  return false;
};

const getItemsToAdvanceForOrderStatus = (order, nextStatus) => (
  getOrderItems(order).filter((item) => getItemId(item) && shouldAdvanceItemForOrderStatus(item, nextStatus))
);

export default function CloudKitchenMonitorRest8Container({ kitchenCloud }) {
  const handleAdvanceStatus = async (order) => {
    const action = getCloudStatusAction(order);
    if (!action) return;

    const itemsToAdvance = getItemsToAdvanceForOrderStatus(order, action.nextStatus);
    for (const item of itemsToAdvance) {
      const itemId = getItemId(item);
      const itemResult = await kitchenCloud.changeOrderItemStatus({
        restaurantOrderId: order.id,
        restaurantOrderItemId: itemId,
        status: action.nextStatus
      });
      if (itemResult?.success === false) {
        showMessageModal(itemResult.message || kitchenCloud.error || 'No pudimos actualizar todos los items de la comanda.', null, { type: 'error' });
        return;
      }
    }

    const result = await kitchenCloud.changeOrderStatus({
      restaurantOrderId: order.id,
      status: action.nextStatus
    });
    if (result?.success === false) {
      showMessageModal(result.message || kitchenCloud.error || 'No pudimos actualizar la comanda.', null, { type: 'error' });
    }
  };

  const handleItemStatusChange = async (order, item, status) => {
    const itemId = getItemId(item);
    if (!order?.id || !itemId) {
      showMessageModal('No pudimos identificar el item de la comanda. Actualiza cocina e intenta de nuevo.', null, { type: 'error' });
      return;
    }

    const result = await kitchenCloud.changeOrderItemStatus({
      restaurantOrderId: order.id,
      restaurantOrderItemId: itemId,
      status
    });
    if (result?.success === false) {
      showMessageModal(result.message || kitchenCloud.error || 'No pudimos actualizar el item.', null, { type: 'error' });
    }
  };

  const handleCancelItemStatus = async (order, item) => {
    const itemId = getItemId(item);
    if (!order?.id || !itemId) {
      showMessageModal('No pudimos identificar el item de la comanda. Actualiza cocina e intenta de nuevo.', null, { type: 'error' });
      return;
    }

    if (!(await showConfirmModal('¿Cancelar este item en cocina? El cajero deberá revisar la cuenta si aplica.', {
      title: 'Cancelar item',
      confirmButtonText: 'Sí, cancelar item',
      cancelButtonText: 'Volver'
    }))) return;

    const result = await kitchenCloud.changeOrderItemStatus({
      restaurantOrderId: order.id,
      restaurantOrderItemId: itemId,
      status: 'cancelled'
    });
    if (result?.success === false) {
      showMessageModal(result.message || kitchenCloud.error || 'No pudimos cancelar el item.', null, { type: 'error' });
    } else {
      showMessageModal('Item cancelado en cocina. Recuerda revisar la cuenta si aplica.', null, { type: 'success' });
    }
  };

  const handleCancelOrder = async (order) => {
    if (!(await showConfirmModal('¿Cancelar esta comanda en cocina?', {
      title: 'Cancelar comanda',
      confirmButtonText: 'Sí, cancelar',
      cancelButtonText: 'Volver'
    }))) return;

    const result = await kitchenCloud.changeOrderStatus({
      restaurantOrderId: order.id,
      status: 'cancelled'
    });
    if (result?.success === false) {
      showMessageModal(result.message || kitchenCloud.error || 'No pudimos cancelar la comanda.', null, { type: 'error' });
    } else {
      showMessageModal('Comanda cancelada en cocina', null, { type: 'success' });
    }
  };

  const handleArchiveOrder = async (order) => {
    const status = getOrderStatus(order);
    if (!TERMINAL_STATUSES.has(status)) {
      showMessageModal('Solo se pueden archivar comandas entregadas o canceladas.', null, { type: 'error' });
      return;
    }

    if (!(await showConfirmModal('Esta acción solo ocultará la comanda de vistas operativas. Los registros relacionados se conservan.', {
      title: 'Archivar comanda',
      confirmButtonText: 'Archivar comanda',
      cancelButtonText: 'Volver'
    }))) return;

    const result = await kitchenCloud.archiveOrder(order);
    if (result?.success === false) {
      showMessageModal(result.message || kitchenCloud.error || 'No pudimos archivar la comanda.', null, { type: 'error' });
      return;
    }
    showMessageModal('Comanda archivada', null, { type: 'success' });
  };

  return (
    <CloudKitchenMonitorRest8
      kitchenCloud={kitchenCloud}
      onAdvanceStatus={handleAdvanceStatus}
      onCancelOrder={handleCancelOrder}
      onChangeItemStatus={handleItemStatusChange}
      onCancelItemStatus={handleCancelItemStatus}
      onArchiveOrder={handleArchiveOrder}
    />
  );
}
