import { db, STORES } from './db/dexie';
import {
  EXPIRY_DAYS_THRESHOLD,
  getAvailableStock
} from './db/utils';
import { daysBetween } from '../utils/dateUtils';
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

const getExpiryDays = (targetDate, now) => {
  if (!targetDate) return null;
  try {
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    return daysBetween(todayUTC, targetDate);
  } catch (err) {
    return null;
  }
};

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

  const [catalogSize, lowStockProducts, expiringBatches] = await Promise.all([
    database.table(STORES.MENU).count(),
    database.table(STORES.MENU)
      .where('lowStockAlertStatus')
      .equals(1)
      .limit(limit)
      .toArray(),
    database.table(STORES.PRODUCT_BATCHES)
      .where('[activeStockStatus+alertTargetDate]')
      .between([1, lowerExpiryKey], [1, upperExpiryKey], true, true)
      .limit(limit)
      .toArray()
  ]);

  const productIds = Array.from(new Set(
    expiringBatches.map(batch => batch.productId).filter(Boolean)
  ));
  const products = productIds.length > 0
    ? await database.table(STORES.MENU).bulkGet(productIds)
    : [];
  const productsById = new Map(
    products.filter(Boolean).map(product => [product.id, product])
  );

  const stockAlerts = lowStockProducts.map(product => ({
    id: `stock-${product.id}`,
    type: 'low-stock',
    productId: product.id,
    productName: product.name || 'Producto sin nombre',
    availableStock: getAvailableStock(product),
    urgency: 1,
    route: '/productos'
  }));

  const expiryAlerts = expiringBatches.flatMap(batch => {
    const product = productsById.get(batch.productId);
    if (!product || product.isActive === false) return [];

    const expiryDays = getExpiryDays(
      batch.alertTargetDate || batch.expiryDate,
      now
    );
    if (expiryDays === null || expiryDays < 0 || expiryDays > EXPIRY_DAYS_THRESHOLD) {
      return [];
    }

    return [{
      id: `expiry-${batch.id}`,
      type: 'expiry',
      productId: batch.productId,
      productName: product.name || 'Producto sin nombre',
      expiryDays,
      urgency: expiryDays === 0 ? 0 : 1,
      route: '/productos'
    }];
  });

  return {
    catalogSize,
    alerts: [...stockAlerts, ...expiryAlerts]
      .sort((left, right) => left.urgency - right.urgency)
      .slice(0, limit)
  };
}
