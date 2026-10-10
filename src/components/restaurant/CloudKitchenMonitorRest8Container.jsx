import { showConfirmModal, showMessageModal } from '../../services/utils';
import CloudKitchenMonitorRest8 from './CloudKitchenMonitorRest8';

const TERMINAL = new Set(['delivered', 'cancelled']);
const normalizeStatus = (value) => {
  const status = String(value || 'pending').trim().toLowerCase();
  if (status === 'open' || status === 'sent' || status === 'sent_to_kitchen') return 'pending';
  if (status === 'completed') return 'delivered';
  return status || 'pending';
};
const getOrderStatus = (order = {}) => normalizeStatus(order.fulfillmentStatus || order.status);
const getItems = (order = {}) => (Array.isArray(order.items) ? order.items : []);
const getItemId = (item = {}) => item.id || item.restaurantOrderItemId || item.restaurant_order_item_id || null;
const getItemStatus = (item = {}) => normalizeStatus(item.status || item.fulfillmentStatus || item.fulfillment_status || 'pending');

const getProgress = (order = {}) => {
  const activeItems = getItems(order).filter((item) => getItemStatus(item) !== 'cancelled');
  const pendingItems = activeItems.filter((item) => getItemStatus(item) === 'pending');
  const preparingItems = activeItems.filter((item) => getItemStatus(item) === 'preparing');
  const readyItems = activeItems.filter((item) => getItemStatus(item) === 'ready');
  return { activeItems, pendingItems, preparingItems, readyItems, allReady: activeItems.length > 0 && activeItems.length === readyItems.length };
};

const getOrderAction = (order) => {
  const status = getOrderStatus(order);
  if (TERMINAL.has(status)) return null;
  const progress = getProgress(order);
  if (status === 'ready' || progress.allReady) return { nextStatus: 'delivered' };
  if (progress.pendingItems.length > 0) return { nextStatus: 'preparing' };
  if (progress.preparingItems.length > 0) return { nextStatus: 'ready' };
  return null;
};

const shouldAdvanceItem = (item, nextStatus) => {
  const status = getItemStatus(item);
  if (status === nextStatus || status === 'cancelled') return false;
  if (nextStatus === 'preparing') return status === 'pending';
  if (nextStatus === 'ready') return status === 'preparing';
  if (nextStatus === 'delivered') return !TERMINAL.has(status);
  return false;
};

export default function CloudKitchenMonitorRest8Container({ kitchenCloud }) {
  const handleAdvanceStatus = async (order) => {
    const action = getOrderAction(order);
    if (!action) return;

    for (const item of getItems(order).filter((entry) => getItemId(entry) && shouldAdvanceItem(entry, action.nextStatus))) {
      const result = await kitchenCloud.changeOrderItemStatus({
        restaurantOrderId: order.id,
        restaurantOrderItemId: getItemId(item),
        status: action.nextStatus
      });
      if (result?.success === false) {
        showMessageModal(result.message || kitchenCloud.error || 'No pudimos actualizar todos los items de la comanda.', null, { type: 'error' });
        return;
      }
    }

    const result = await kitchenCloud.changeOrderStatus({ restaurantOrderId: order.id, status: action.nextStatus });
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
    const result = await kitchenCloud.changeOrderItemStatus({ restaurantOrderId: order.id, restaurantOrderItemId: itemId, status });
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
    const result = await kitchenCloud.changeOrderItemStatus({ restaurantOrderId: order.id, restaurantOrderItemId: itemId, status: 'cancelled' });
    if (result?.success === false) {
      showMessageModal(result.message || kitchenCloud.error || 'No pudimos cancelar el item.', null, { type: 'error' });
    } else {
      showMessageModal('Item cancelado en cocina. Recuerda revisar la cuenta si aplica.', null, { type: 'success' });
    }
  };

  const handleCancelOrder = async (order) => {
    const activeItems = getItems(order).filter((item) => getItemStatus(item) !== 'cancelled');
    if (!activeItems.length || activeItems.some((item) => !getItemId(item)
      || !['pending', 'preparing'].includes(getItemStatus(item)))) {
      showMessageModal('Solo se pueden rechazar productos pendientes o en preparación. Revisa los productos o solicita la cancelación de la mesa desde Mesas.', null, { type: 'warning' });
      return;
    }
    if (!(await showConfirmModal('¿Rechazar los productos de esta comanda? La mesa seguirá abierta y el cajero deberá revisar la cuenta.', {
      title: 'Rechazar productos',
      confirmButtonText: 'Sí, rechazar productos',
      cancelButtonText: 'Volver'
    }))) return;
    for (const item of activeItems) {
      const result = await kitchenCloud.changeOrderItemStatus({ restaurantOrderId: order.id,
        restaurantOrderItemId: getItemId(item), status: 'cancelled' });
      if (result?.success !== true) {
        showMessageModal(result?.message || 'No se pudieron rechazar todos los productos. Actualiza cocina y revisa la cuenta.', null, { type: 'warning' });
        return;
      }
    }
    showMessageModal('Productos rechazados en cocina. La mesa sigue abierta; revisa la cuenta desde Mesas.', null, { type: 'success' });
  };

  const handleArchiveOrder = async (order) => {
    if (!TERMINAL.has(getOrderStatus(order))) {
      showMessageModal('Solo se pueden archivar comandas entregadas o canceladas.', null, { type: 'error' });
      return;
    }
    if (!(await showConfirmModal('Esta acción solo ocultará la comanda de vistas activas. No borra ventas, caja ni inventario.', {
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
