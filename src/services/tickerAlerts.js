import { db, STORES } from './db/dexie';
import {
  EXPIRY_DAYS_THRESHOLD,
  getAvailableStock
} from './db/utils';

export const TICKER_ALERT_POLL_INTERVAL_MS = 5 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  const parsedTarget = new Date(targetDate);
  if (Number.isNaN(parsedTarget.getTime())) return null;

  return Math.round(
    (startOfLocalDay(parsedTarget).getTime() - startOfLocalDay(now).getTime())
      / MS_PER_DAY
  );
};

export async function queryTickerInventoryAlerts({
  limit = 8,
  now = new Date(),
  database = db
} = {}) {
  if (!database.isOpen()) await database.open();

  const expiryLimit = new Date(now);
  expiryLimit.setDate(expiryLimit.getDate() + EXPIRY_DAYS_THRESHOLD);

  const lowerExpiryKey = toLocalDateKey(now);
  const upperExpiryKey = `${toLocalDateKey(expiryLimit)}\uffff`;

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
