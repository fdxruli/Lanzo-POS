import { db } from './db/dexie';
import {
  queryLocalInventoryOperationalSnapshot
} from './localInventoryOperationalAlerts';
import {
  INVENTORY_OPERATIONAL_SEVERITY,
  INVENTORY_OPERATIONAL_TYPES
} from './inventoryOperationalAlerts';
import { ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE } from './ecommerce/ecommercePublishedStockAlertConstants';

export const TICKER_ALERT_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_TICKER_MAX_VISIBLE = 8;

const TICKER_SOURCE_PRIORITY = Object.freeze({
  inventory: 0,
  ecommerce: 1,
  backup: 2
});

const TICKER_STOCK_TYPES = new Set(['low-stock', 'out-of-stock']);
const TICKER_EXPIRY_TYPES = new Set(['expired', 'expiry']);

const getUrgency = (alert) => (
  alert?.severity === INVENTORY_OPERATIONAL_SEVERITY.CRITICAL ? 0 : 1
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

export const toTickerInventoryAlert = (alert, canonicalOrder = 0) => {
  if (!alert) return null;

  const common = {
    incidentId: alert.incidentId || null,
    source: 'inventory',
    canonicalOrder,
    severity: alert.severity,
    productId: alert.productId,
    productName: alert.productName,
    urgency: getUrgency(alert)
  };

  if (alert.type === INVENTORY_OPERATIONAL_TYPES.LOW_STOCK) {
    return {
      ...common,
      id: `stock-${alert.productId}`,
      type: 'low-stock',
      availableStock: alert.availableStock,
      minStock: alert.minStock
    };
  }

  if (alert.type === INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK) {
    return {
      ...common,
      id: `stock-${alert.productId}`,
      type: 'out-of-stock',
      availableStock: alert.availableStock,
      minStock: alert.minStock
    };
  }

  if (alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED) {
    return {
      ...common,
      id: `expiry-${alert.batchId}`,
      type: 'expired',
      batchId: alert.batchId,
      expiryDays: alert.daysUntilExpiry
    };
  }

  if (alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING) {
    return {
      ...common,
      id: `expiry-${alert.batchId}`,
      type: 'expiry',
      batchId: alert.batchId,
      expiryDays: alert.daysUntilExpiry
    };
  }

  return null;
};

export const mapInventoryOperationalAlertsForTicker = (alerts = []) => {
  const seenIncidents = new Set();

  return (Array.isArray(alerts) ? alerts : []).reduce((mapped, alert, index) => {
    const tickerAlert = toTickerInventoryAlert(alert, index);
    if (!tickerAlert) return mapped;

    const identity = tickerAlert.incidentId || tickerAlert.id;
    if (identity && seenIncidents.has(identity)) return mapped;
    if (identity) seenIncidents.add(identity);

    mapped.push(tickerAlert);
    return mapped;
  }, []);
};

const normalizeUrgency = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : 99
);

const normalizeCanonicalOrder = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER
);

const getTickerSource = (alert) => {
  if (alert?.source) return alert.source;
  if (alert?.type === 'ecommerce-published-out-of-stock') return 'ecommerce';
  if (String(alert?.id || '').startsWith('backup-')) return 'backup';
  return 'unknown';
};

export const compareLocalTickerAlerts = (left, right) => {
  const urgencyDiff = normalizeUrgency(left?.urgency) - normalizeUrgency(right?.urgency);
  if (urgencyDiff !== 0) return urgencyDiff;

  if (left?.source === 'inventory' && right?.source === 'inventory') {
    const canonicalDiff = (
      normalizeCanonicalOrder(left?.canonicalOrder)
      - normalizeCanonicalOrder(right?.canonicalOrder)
    );
    if (canonicalDiff !== 0) return canonicalDiff;
  }

  const sourceDiff = (
    (TICKER_SOURCE_PRIORITY[getTickerSource(left)] ?? 99)
    - (TICKER_SOURCE_PRIORITY[getTickerSource(right)] ?? 99)
  );
  if (sourceDiff !== 0) return sourceDiff;

  return String(left?.id || left?.incidentId || '').localeCompare(
    String(right?.id || right?.incidentId || '')
  );
};

export const selectLocalTickerAlerts = (
  alerts = [],
  { limit = DEFAULT_TICKER_MAX_VISIBLE } = {}
) => {
  const unique = [];
  const seen = new Set();

  (Array.isArray(alerts) ? alerts : []).forEach((alert, index) => {
    if (!alert) return;
    const identity = alert.incidentId || alert.id || `ticker-anonymous:${index}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    unique.push(alert);
  });

  return unique
    .sort(compareLocalTickerAlerts)
    .slice(0, Math.max(0, Number(limit) || 0));
};

export const getTickerInventoryNavigationRoute = (
  alert,
  { canReadReports = false, canReadProducts = false } = {}
) => {
  if (!alert || alert.source !== 'inventory') return null;

  if (canReadReports) {
    if (TICKER_STOCK_TYPES.has(alert.type)) return '/ventas?tab=restock';
    if (TICKER_EXPIRY_TYPES.has(alert.type)) return '/ventas?tab=expiration';
  }

  return canReadProducts ? '/productos' : null;
};

export async function queryTickerInventoryAlerts({
  limit = DEFAULT_TICKER_MAX_VISIBLE,
  now = new Date(),
  database = db
} = {}) {
  const snapshot = await queryLocalInventoryOperationalSnapshot({
    now,
    database
  });

  return {
    catalogSize: snapshot.catalogSize,
    alerts: selectLocalTickerAlerts(
      mapInventoryOperationalAlertsForTicker(snapshot.alerts),
      { limit }
    )
  };
}
