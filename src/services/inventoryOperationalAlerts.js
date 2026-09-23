import {
  daysBetween,
  extractCalendarDate,
  getBatchExpiryStatus
} from '../utils/dateUtils';
import {
  getOperationalStockSnapshot,
  normalizeStock
} from './inventoryStock';

export const LOW_STOCK_THRESHOLD = 5;
export const EXPIRY_DAYS_THRESHOLD = 7;

export const INVENTORY_OPERATIONAL_TYPES = Object.freeze({
  OUT_OF_STOCK: 'out_of_stock',
  LOW_STOCK: 'low_stock',
  EXPIRED: 'expired',
  EXPIRING: 'expiring'
});

export const INVENTORY_OPERATIONAL_SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  WARNING: 'warning'
});

const TYPE_PRIORITY = Object.freeze({
  [INVENTORY_OPERATIONAL_TYPES.EXPIRED]: 0,
  [INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK]: 1,
  expiring_today: 2,
  [INVENTORY_OPERATIONAL_TYPES.LOW_STOCK]: 3,
  [INVENTORY_OPERATIONAL_TYPES.EXPIRING]: 4
});

const isMissingValue = (value) => value === null || value === undefined || value === '';

const isProductStockTracked = (product) => (
  (product?.trackStock ?? product?.track_stock) === true
);

const isProductActive = (product) => (
  (product?.isActive ?? product?.is_active) !== false
);

const getLocalCalendarDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const resolveOperationalMinStock = (product) => {
  const rawValue = product?.minStock ?? product?.min_stock;

  if (isMissingValue(rawValue)) {
    return {
      valid: true,
      value: LOW_STOCK_THRESHOLD,
      source: 'legacy_fallback'
    };
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return {
      valid: false,
      value: null,
      source: 'invalid'
    };
  }

  return {
    valid: true,
    value: normalizeStock(numericValue),
    source: 'configured'
  };
};

const buildStockAlert = (product) => {
  if (!product || !isProductStockTracked(product) || !isProductActive(product)) {
    return null;
  }

  const stock = getOperationalStockSnapshot(product);
  if (!stock.valid) return null;

  const minimum = resolveOperationalMinStock(product);
  const base = {
    productId: product.id ?? product.productId ?? null,
    productName: product.name || product.productName || 'Producto sin nombre',
    availableStock: stock.availableStock,
    physicalStock: stock.physicalStock,
    committedStock: stock.committedStock,
    minStock: minimum.value,
    minStockSource: minimum.source
  };

  if (stock.availableStock <= 0) {
    return {
      ...base,
      type: INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK,
      severity: INVENTORY_OPERATIONAL_SEVERITY.CRITICAL
    };
  }

  if (minimum.valid && stock.availableStock <= minimum.value) {
    return {
      ...base,
      type: INVENTORY_OPERATIONAL_TYPES.LOW_STOCK,
      severity: INVENTORY_OPERATIONAL_SEVERITY.WARNING
    };
  }

  return null;
};

const isRelevantBatch = (batch) => {
  if (!batch || (batch?.isActive ?? batch?.is_active) === false || batch?.status === 'inactive' || (batch?.isArchived ?? batch?.is_archived) === true) {
    return false;
  }

  if (batch?.activeStockStatus === 0 || batch?.active_stock_status === 0) {
    return false;
  }

  const stock = getOperationalStockSnapshot({
    stock: batch?.stock ?? batch?.quantity,
    committedStock: batch?.committedStock ?? batch?.committed_stock
  });

  return stock.valid && stock.physicalStock > 0;
};

const buildExpiryAlert = (product, batch, now, expiryDaysThreshold) => {
  if (!product || !isProductActive(product) || !isProductStockTracked(product) || !isRelevantBatch(batch)) {
    return null;
  }

  const expiryDate = batch?.alertTargetDate
    ?? batch?.alert_target_date
    ?? batch?.expiryDate
    ?? batch?.expiry_date
    ?? null;

  if (!expiryDate) return null;

  const status = getBatchExpiryStatus(expiryDate, now);
  if (status === 'missing' || status === 'invalid') return null;

  const expiryCalendarDate = extractCalendarDate(expiryDate);
  const todayCalendarDate = getLocalCalendarDate(now);
  if (!expiryCalendarDate || !todayCalendarDate) return null;

  const daysUntilExpiry = daysBetween(todayCalendarDate, expiryCalendarDate);
  if (status === 'valid' && daysUntilExpiry > expiryDaysThreshold) return null;

  const stock = getOperationalStockSnapshot({
    stock: batch?.stock ?? batch?.quantity,
    committedStock: batch?.committedStock ?? batch?.committed_stock
  });

  const common = {
    productId: product.id ?? batch.productId ?? batch.product_id ?? null,
    productName: product.name || product.productName || 'Producto sin nombre',
    batchId: batch.id ?? null,
    availableStock: stock.valid ? stock.availableStock : null,
    expiryDate,
    daysUntilExpiry,
    expiresToday: status === 'expires_today'
  };

  if (status === 'expired') {
    return {
      ...common,
      type: INVENTORY_OPERATIONAL_TYPES.EXPIRED,
      severity: INVENTORY_OPERATIONAL_SEVERITY.CRITICAL
    };
  }

  return {
    ...common,
    type: INVENTORY_OPERATIONAL_TYPES.EXPIRING,
    severity: status === 'expires_today'
      ? INVENTORY_OPERATIONAL_SEVERITY.CRITICAL
      : INVENTORY_OPERATIONAL_SEVERITY.WARNING
  };
};

export const getInventoryOperationalState = ({
  product,
  batch = null,
  now = new Date(),
  expiryDaysThreshold = EXPIRY_DAYS_THRESHOLD
} = {}) => {
  const stockSnapshot = getOperationalStockSnapshot(product);
  const minimum = resolveOperationalMinStock(product);
  const stockApplicable = Boolean(product)
    && isProductStockTracked(product)
    && isProductActive(product);
  const stockAlert = buildStockAlert(product);
  const expiryAlert = batch
    ? buildExpiryAlert(product, batch, now, expiryDaysThreshold)
    : null;

  let stockType = 'healthy';
  if (!stockApplicable) stockType = 'not_applicable';
  else if (!stockSnapshot.valid || (!minimum.valid && stockSnapshot.availableStock > 0)) {
    stockType = 'unknown';
  }

  return {
    stock: stockAlert
      ? {
          type: stockAlert.type,
          severity: stockAlert.severity,
          availableStock: stockAlert.availableStock,
          physicalStock: stockAlert.physicalStock,
          committedStock: stockAlert.committedStock,
          minStock: stockAlert.minStock,
          minStockSource: stockAlert.minStockSource
        }
      : {
          type: stockType,
          severity: null,
          ...stockSnapshot,
          minStock: minimum.value,
          minStockSource: minimum.source
        },
    expiry: expiryAlert
      ? {
          type: expiryAlert.type,
          severity: expiryAlert.severity,
          expiryDate: expiryAlert.expiryDate,
          daysUntilExpiry: expiryAlert.daysUntilExpiry,
          expiresToday: expiryAlert.expiresToday
        }
      : {
          type: 'none',
          severity: null,
          expiryDate: batch?.alertTargetDate
            ?? batch?.alert_target_date
            ?? batch?.expiryDate
            ?? batch?.expiry_date
            ?? null,
          daysUntilExpiry: null,
          expiresToday: false
        },
    alerts: [stockAlert, expiryAlert].filter(Boolean)
  };
};

const severityPriority = (severity) => (
  severity === INVENTORY_OPERATIONAL_SEVERITY.CRITICAL ? 0 : 1
);

const getTypePriority = (alert) => {
  if (alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING && alert.expiresToday) {
    return TYPE_PRIORITY.expiring_today;
  }
  return TYPE_PRIORITY[alert.type] ?? 99;
};

export const compareInventoryOperationalAlerts = (left, right) => {
  const severityDiff = severityPriority(left?.severity) - severityPriority(right?.severity);
  if (severityDiff !== 0) return severityDiff;

  const typeDiff = getTypePriority(left) - getTypePriority(right);
  if (typeDiff !== 0) return typeDiff;

  const leftDays = Number.isFinite(left?.daysUntilExpiry) ? left.daysUntilExpiry : Number.POSITIVE_INFINITY;
  const rightDays = Number.isFinite(right?.daysUntilExpiry) ? right.daysUntilExpiry : Number.POSITIVE_INFINITY;
  if (leftDays !== rightDays) return leftDays - rightDays;

  const productDiff = String(left?.productName || '').localeCompare(String(right?.productName || ''));
  if (productDiff !== 0) return productDiff;

  return String(left?.batchId || left?.productId || '').localeCompare(
    String(right?.batchId || right?.productId || '')
  );
};

export const buildInventoryOperationalAlerts = ({
  products = [],
  batches = [],
  now = new Date(),
  expiryDaysThreshold = EXPIRY_DAYS_THRESHOLD
} = {}) => {
  const productList = Array.isArray(products) ? products : [];
  const batchList = Array.isArray(batches) ? batches : [];
  const productsById = new Map(productList.map((product) => [product?.id, product]));
  const alerts = [];

  productList.forEach((product) => {
    const state = getInventoryOperationalState({ product, now, expiryDaysThreshold });
    if (state.alerts[0]) alerts.push(state.alerts[0]);
  });

  batchList.forEach((batch) => {
    const product = productsById.get(batch?.productId ?? batch?.product_id);
    if (!product) return;

    const state = getInventoryOperationalState({
      product,
      batch,
      now,
      expiryDaysThreshold
    });
    const expiryAlert = state.alerts.find((alert) => (
      alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED
      || alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING
    ));
    if (expiryAlert) alerts.push(expiryAlert);
  });

  return alerts.sort(compareInventoryOperationalAlerts);
};

export const getLowStockAlertStatusFromOperationalState = (product) => {
  const { stock } = getInventoryOperationalState({ product });
  return stock.type === INVENTORY_OPERATIONAL_TYPES.LOW_STOCK ? 1 : 0;
};
