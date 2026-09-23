import { db } from './db/dexie';
import {
  queryLocalInventoryOperationalSnapshot
} from './localInventoryOperationalAlerts';
import { INVENTORY_OPERATIONAL_TYPES } from './inventoryOperationalAlerts';
import { ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE } from './ecommerce/ecommercePublishedStockAlertConstants';

export const TICKER_ALERT_POLL_INTERVAL_MS = 5 * 60 * 1000;

export function buildEcommercePublishedStockTickerAlert(snapshot) {
  const count = Number(snapshot?.outOfStockCount || 0);
  if (
    snapshot?.success !== true
    || snapshot?.portalStatus !== 'published'
    || count <= 0
  ) {
    return null;
  }

  return {
    id: 'ecommerce-published-out-of-stock',
    type: 'ecommerce-published-out-of-stock',
    count,
    urgency: 1,
    route: ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE
  };
}

export const toTickerInventoryAlert = (alert) => {
  if (alert.type === INVENTORY_OPERATIONAL_TYPES.LOW_STOCK) {
    return {
      id: `stock-${alert.productId}`,
      type: 'low-stock',
      productId: alert.productId,
      productName: alert.productName,
      availableStock: alert.availableStock,
      minStock: alert.minStock,
      urgency: 1,
      route: '/productos'
    };
  }

  if (alert.type === INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK) {
    return {
      id: `stock-${alert.productId}`,
      type: 'out-of-stock',
      productId: alert.productId,
      productName: alert.productName,
      availableStock: alert.availableStock,
      minStock: alert.minStock,
      urgency: 0,
      route: '/productos'
    };
  }

  if (alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED) {
    return {
      id: `expiry-${alert.batchId}`,
      type: 'expired',
      productId: alert.productId,
      productName: alert.productName,
      batchId: alert.batchId,
      expiryDays: alert.daysUntilExpiry,
      urgency: 0,
      route: '/productos'
    };
  }

  return {
    id: `expiry-${alert.batchId}`,
    type: 'expiry',
    productId: alert.productId,
    productName: alert.productName,
    batchId: alert.batchId,
    expiryDays: alert.daysUntilExpiry,
    urgency: alert.expiresToday ? 0 : 1,
    route: '/productos'
  };
};

export const mapInventoryOperationalAlertsForTicker = (alerts = []) => (
  (Array.isArray(alerts) ? alerts : []).map(toTickerInventoryAlert)
);

export async function queryTickerInventoryAlerts({
  limit = 8,
  now = new Date(),
  database = db
} = {}) {
  const snapshot = await queryLocalInventoryOperationalSnapshot({
    now,
    database
  });

  return {
    catalogSize: snapshot.catalogSize,
    alerts: mapInventoryOperationalAlertsForTicker(snapshot.alerts).slice(0, limit)
  };
}
