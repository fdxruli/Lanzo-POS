import Logger from '../Logger';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { SYNC_ENTITY_TYPES } from '../sync/syncConstants';

const RESTAURANT_ORDERS_UPDATED_EVENT = 'lanzo:restaurant-orders-cloud-updated';
let registered = false;

const isRestaurantOrderEvent = (event = {}) => {
  const entityType = event.entity_type || event.entityType || event.entity;
  return entityType === SYNC_ENTITY_TYPES.RESTAURANT_ORDER
    || entityType === SYNC_ENTITY_TYPES.RESTAURANT_ORDER_ITEM;
};

const notifyRestaurantOrdersCloudChanged = (events = []) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(RESTAURANT_ORDERS_UPDATED_EVENT, {
    detail: {
      source: 'pos_sync_events',
      events
    }
  }));
};

export const restaurantOrdersSyncHandler = {
  async onEvents(events = []) {
    const restaurantEvents = (Array.isArray(events) ? events : []).filter(isRestaurantOrderEvent);
    if (restaurantEvents.length === 0) {
      return { skipped: true, notified: false };
    }

    notifyRestaurantOrdersCloudChanged(restaurantEvents);
    return { success: true, notified: true, events: restaurantEvents.length };
  }
};

export const registerRestaurantOrdersSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.RESTAURANT_ORDER, restaurantOrdersSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.RESTAURANT_ORDER_ITEM, restaurantOrdersSyncHandler);
  registered = true;
  Logger.log('[RestaurantOrders/Sync] Handler REST.3 registrado. Realtime avisa y KDS refresca por RPC.');
  return true;
};

registerRestaurantOrdersSyncHandler();

export default restaurantOrdersSyncHandler;
