import { db, STORES } from './db/dexie';
import {
  compareInventoryOperationalAlerts,
  EXPIRY_DAYS_THRESHOLD,
  getInventoryOperationalState,
  INVENTORY_OPERATIONAL_TYPES
} from './inventoryOperationalAlerts';
import { ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE } from './ecommerce/ecommercePublishedStockAlertConstants';

export const TICKER_ALERT_POLL_INTERVAL_MS = 5 * 60 * 1000;

const startOfLocalDay = (date) => (
  new Date(date.getFullYear(), date.getMonth(), date.getDate())
);

const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const uniqueById = (items = []) => Array.from(
  new Map(items.filter(Boolean).map((item) => [item.id, item])).values()
);

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

const toTickerInventoryAlert = (alert) => {
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

export async function queryTickerInventoryAlerts({
  limit = 8,
  now = new Date(),
  database = db
} = {}) {
  if (!database.isOpen()) await database.open();

  const expiryLimit = new Date(now);
  expiryLimit.setDate(expiryLimit.getDate() + EXPIRY_DAYS_THRESHOLD);

  const lowerExpiryKey = toLocalDateKey(startOfLocalDay(now));
  const upperExpiryKey = `${toLocalDateKey(expiryLimit)}￿`;

  const [
    products,
    upcomingBatches,
    expiredBatches
  ] = await Promise.all([
    database.table(STORES.MENU).toArray(),
    database.table(STORES.PRODUCT_BATCHES)
      .where('[activeStockStatus+alertTargetDate]')
      .between([1, lowerExpiryKey], [1, upperExpiryKey], true, true)
      .limit(limit)
      .toArray(),
    database.table(STORES.PRODUCT_BATCHES)
      .where('[activeStockStatus+alertTargetDate]')
      .between([1, ''], [1, lowerExpiryKey], true, false)
      .reverse()
      .limit(limit)
      .toArray()
  ]);

  const catalogSize = products.length;
  const candidateBatches = uniqueById([...upcomingBatches, ...expiredBatches]);
  const productsById = new Map(
    products.filter(Boolean).map((product) => [product.id, product])
  );

  const domainAlerts = [];

  products.forEach((product) => {
    const { alerts } = getInventoryOperationalState({ product, now });
    const stockAlert = alerts.find((alert) => (
      alert.type === INVENTORY_OPERATIONAL_TYPES.LOW_STOCK
      || alert.type === INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK
    ));
    if (stockAlert) domainAlerts.push(stockAlert);
  });

  candidateBatches.forEach((batch) => {
    const product = productsById.get(batch.productId);
    if (!product) return;

    const { alerts } = getInventoryOperationalState({ product, batch, now });
    const expiryAlert = alerts.find((alert) => (
      alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED
      || alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING
    ));
    if (expiryAlert) domainAlerts.push(expiryAlert);
  });

  return {
    catalogSize,
    alerts: domainAlerts
      .sort(compareInventoryOperationalAlerts)
      .slice(0, limit)
      .map(toTickerInventoryAlert)
  };
}
