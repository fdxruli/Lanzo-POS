import {
  getLineRevenue,
  normalizeFinancialNumber,
  summarizeFinancialSales
} from '../sales/financialPolicy';

export const DIAGNOSTIC_TYPES = Object.freeze({
  INVENTORY: 'inventory',
  FINANCIAL: 'financial',
  CUSTOMERS: 'customers'
});

export const DIAGNOSTIC_DATE_RANGES = Object.freeze({
  TODAY: 'today',
  LAST_7_DAYS: 'last7days',
  LAST_30_DAYS: 'last30days',
  THIS_MONTH: 'thisMonth',
  LAST_MONTH: 'lastMonth'
});

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_SALE_STATUSES = new Set(['closed', 'completed', 'fulfilled']);
const EXCLUDED_SALE_STATUS_WORDS = ['cancel', 'revert', 'reverse', 'void', 'anul'];

const isValidDate = (date) => date instanceof Date && Number.isFinite(date.getTime());

const getTimeZoneParts = (date, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);

    return parts.reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = Number(part.value);
      return result;
    }, {});
  } catch {
    return getTimeZoneParts(date, 'UTC');
  }
};

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = getTimeZoneParts(date, timeZone);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallClockAsUtc - date.getTime();
};

const localPartsToUtc = (parts, timeZone) => {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0
  );
  const first = new Date(guess - getTimeZoneOffsetMs(new Date(guess), timeZone));
  const second = getTimeZoneOffsetMs(first, timeZone);
  return new Date(guess - second);
};

const shiftCalendarDate = (parts, days) => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  };
};

const startOfMonth = (parts, monthOffset = 0) => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + monthOffset, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  };
};

export const getDiagnosticPeriod = (
  rangeType = DIAGNOSTIC_DATE_RANGES.LAST_7_DAYS,
  { now = new Date(), timezone = DEFAULT_BUSINESS_TIMEZONE, customStart = null, customEnd = null } = {}
) => {
  const safeNow = isValidDate(new Date(now)) ? new Date(now) : new Date();
  const today = getTimeZoneParts(safeNow, timezone);
  const todayStart = { ...today, hour: 0, minute: 0, second: 0, millisecond: 0 };
  const tomorrow = shiftCalendarDate(todayStart, 1);

  let startParts = todayStart;
  let endParts = tomorrow;

  switch (rangeType) {
    case DIAGNOSTIC_DATE_RANGES.TODAY:
      break;
    case DIAGNOSTIC_DATE_RANGES.LAST_7_DAYS:
      startParts = shiftCalendarDate(todayStart, -7);
      break;
    case DIAGNOSTIC_DATE_RANGES.LAST_30_DAYS:
      startParts = shiftCalendarDate(todayStart, -30);
      break;
    case DIAGNOSTIC_DATE_RANGES.THIS_MONTH:
      startParts = startOfMonth(today);
      endParts = startOfMonth(today, 1);
      break;
    case DIAGNOSTIC_DATE_RANGES.LAST_MONTH:
      startParts = startOfMonth(today, -1);
      endParts = startOfMonth(today);
      break;
    case 'custom': {
      const customFrom = new Date(customStart || safeNow);
      const customTo = new Date(customEnd || new Date(customFrom.getTime() + DAY_MS));
      if (isValidDate(customFrom) && isValidDate(customTo)) {
        return {
          from: customFrom.toISOString(),
          to: customTo.toISOString(),
          timezone,
          rangeType
        };
      }
      break;
    }
    default:
      break;
  }

  return {
    from: localPartsToUtc(startParts, timezone).toISOString(),
    to: localPartsToUtc(endParts, timezone).toISOString(),
    timezone,
    rangeType
  };
};

export const formatDiagnosticPeriodLabel = (rangeType) => ({
  [DIAGNOSTIC_DATE_RANGES.TODAY]: 'Hoy',
  [DIAGNOSTIC_DATE_RANGES.LAST_7_DAYS]: 'Últimos 7 días',
  [DIAGNOSTIC_DATE_RANGES.LAST_30_DAYS]: 'Últimos 30 días',
  [DIAGNOSTIC_DATE_RANGES.THIS_MONTH]: 'Este mes',
  [DIAGNOSTIC_DATE_RANGES.LAST_MONTH]: 'Mes anterior'
}[rangeType] || 'Periodo seleccionado');

const parseTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : null;
};

const isWithinPeriod = (value, period) => {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return false;
  return timestamp >= new Date(period.from) && timestamp < new Date(period.to);
};

const valueFrom = (row, keys = []) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return null;
};

const numberFrom = (row, keys = [], fallback = 0) => normalizeFinancialNumber(valueFrom(row, keys), fallback);

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const saleStatus = (sale = {}) => String(
  sale.status || sale.fulfillmentStatus || sale.lifecycleStatus || ''
).trim().toLowerCase();

export const isExcludedDiagnosticSale = (sale = {}) => {
  const statuses = [
    sale.status,
    sale.fulfillmentStatus,
    sale.lifecycleStatus,
    sale.reversalStatus,
    sale.reversal_status
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return statuses.some((status) => EXCLUDED_SALE_STATUS_WORDS.some((word) => status.includes(word)))
    || sale.cancelled === true
    || sale.isCancelled === true
    || sale.isReverted === true;
};

const isDiagnosticSale = (sale = {}) => {
  const status = saleStatus(sale);
  const hasExplicitStatus = Boolean(status);
  const isClosed = !hasExplicitStatus || CLOSED_SALE_STATUSES.has(status);
  const isTest = String(sale.id || '').includes('TEST_')
    || String(sale.customerId || '').toUpperCase() === 'GENERIC'
    || (sale.items || []).some((item) => String(item.id || '').includes('TEST_'));

  return isClosed && !isTest && !isExcludedDiagnosticSale(sale);
};

const saleIdentity = (sale = {}) => {
  const ecommerceId = valueFrom(sale, [
    'ecommerceOrderId',
    'ecommerce_order_id',
    'sourceOrderId',
    'source_order_id'
  ]);
  if (ecommerceId) return `ecommerce:${ecommerceId}`;
  return sale.id ? `sale:${sale.id}` : null;
};

const preferSale = (current, candidate) => {
  if (!current) return candidate;
  const currentShadow = String(current?.sourceMode || current?.source_mode || '').toLowerCase() === 'shadow';
  const candidateShadow = String(candidate?.sourceMode || candidate?.source_mode || '').toLowerCase() === 'shadow';
  if (currentShadow !== candidateShadow) return candidateShadow ? current : candidate;
  return current;
};

export const filterDiagnosticSales = (sales = [], period) => {
  const deduped = new Map();
  const withoutIdentity = [];

  (Array.isArray(sales) ? sales : []).forEach((sale) => {
    if (!isWithinPeriod(sale.timestamp || sale.soldAt || sale.createdAt, period)) return;
    if (!isDiagnosticSale(sale)) return;
    const identity = saleIdentity(sale);
    if (!identity) {
      withoutIdentity.push(sale);
      return;
    }
    deduped.set(identity, preferSale(deduped.get(identity), sale));
  });

  return [...deduped.values(), ...withoutIdentity];
};

const normalizeSaleForFinancialPolicy = (sale) => ({
  ...sale,
  status: sale.status === 'closed' || sale.status === 'completed' ? sale.status : 'completed',
  items: Array.isArray(sale.items) ? sale.items.map((item) => ({
    ...item,
    cost: item.cost ?? item.unitCost ?? item.unit_cost
  })) : []
});

const getProductId = (item = {}) => item.parentId || item.parent_id || item.productId || item.product_id || item.id;
const getProductName = (item = {}) => item.name || item.productName || item.product_name || 'Producto sin nombre';

const buildCoverage = ({ sales = [], products = [], customers = [], missingFields = [] } = {}) => ({
  salesAnalyzed: sales.length,
  productsAnalyzed: products.length,
  customersAnalyzed: customers.length,
  missingFields: Array.from(new Set(missingFields.filter(Boolean)))
});

const finding = ({ id, severity = 'info', title, description, evidence = [], formula, actionLabel, actionRoute }) => ({
  id,
  severity,
  title,
  description,
  evidence,
  formula,
  actionLabel,
  actionRoute
});

const buildInventoryDiagnostic = ({ period, menu = [], wasteLogs = [], batches = [], inventoryEvents = [], sales = [] }) => {
  const products = (Array.isArray(menu) ? menu : []).filter((product) => product.isActive !== false);
  const filteredSales = filterDiagnosticSales(sales, period);
  const filteredWaste = (Array.isArray(wasteLogs) ? wasteLogs : []).filter((waste) => (
    isWithinPeriod(waste.timestamp || waste.createdAt || waste.date, period)
  ));
  const soldProductIds = new Set(filteredSales.flatMap((sale) => (
    Array.isArray(sale.items) ? sale.items.map(getProductId).filter(Boolean) : []
  )));
  const movedProductIds = new Set((Array.isArray(inventoryEvents) ? inventoryEvents : [])
    .filter((event) => isWithinPeriod(event.timestamp || event.createdAt || event.date, period))
    .map((event) => valueFrom(event, ['productId', 'product_id']))
    .filter(Boolean));
  const missingFields = [];
  const stockNegativeProducts = [];
  const outOfStockProducts = [];
  const lowStockProducts = [];
  const committedProducts = [];
  const noMovementProducts = [];
  const capitalByProduct = [];
  let capitalDetained = 0;

  products.forEach((product) => {
    if (product.trackStock === false) return;
    const rawStock = valueFrom(product, ['stock', 'currentStock']);
    const rawCommitted = valueFrom(product, ['committedStock', 'committed_stock']);
    const stock = normalizeFinancialNumber(rawStock, 0);
    const committedStock = normalizeFinancialNumber(rawCommitted, 0);
    const availableStock = stock - committedStock;
    const minStockValue = valueFrom(product, ['minStock', 'min_stock']);
    const minStock = normalizeFinancialNumber(minStockValue, 0);
    const productId = product.id || product.productId;
    const productName = product.name || product.productName || 'Producto sin nombre';

    if (!hasValue(rawStock)) missingFields.push('stock');
    if (!hasValue(rawCommitted)) missingFields.push('committed_stock');
    if (!hasValue(minStockValue)) missingFields.push('min_stock');
    if (stock < 0) stockNegativeProducts.push({ id: productId, name: productName, stock });
    if (stock <= 0) outOfStockProducts.push({ id: productId, name: productName, stock });
    if (availableStock <= minStock && stock > 0) {
      lowStockProducts.push({ id: productId, name: productName, stock, committedStock, availableStock, minStock });
    }
    if (committedStock > 0) {
      committedProducts.push({ id: productId, name: productName, committedStock, availableStock });
    }
    if (stock > 0 && !soldProductIds.has(productId) && !movedProductIds.has(productId)) {
      noMovementProducts.push({ id: productId, name: productName, stock });
    }

    const rawCost = valueFrom(product, ['cost', 'unitCost', 'unit_cost']);
    if (stock > 0 && !hasValue(rawCost)) {
      missingFields.push(`cost:${productId || productName}`);
    } else if (stock > 0) {
      const cost = normalizeFinancialNumber(rawCost, Number.NaN);
      if (Number.isFinite(cost)) {
        const value = Math.max(availableStock, 0) * cost;
        capitalDetained += value;
        capitalByProduct.push({ id: productId, name: productName, value });
      } else {
        missingFields.push(`cost:${productId || productName}`);
      }
    }
  });

  const normalizedBatches = [
    ...(Array.isArray(batches) ? batches : []),
    ...products.flatMap((product) => product.batches || product.lots || [])
  ];
  const asOf = new Date(period.to);
  const expiringLots = normalizedBatches
    .filter((batch) => batch && batch.isActive !== false && Number(batch.stock || 0) > 0)
    .map((batch) => {
      const expiryDate = parseTimestamp(valueFrom(batch, ['expiryDate', 'expirationDate', 'expiresAt']));
      if (!expiryDate) return null;
      const days = Math.ceil((expiryDate.getTime() - asOf.getTime()) / DAY_MS);
      return {
        id: batch.id,
        productId: batch.productId,
        productName: batch.productName || 'Producto con lote',
        stock: numberFrom(batch, ['stock']),
        expiryDate: expiryDate.toISOString(),
        daysUntilExpiry: days,
        cost: numberFrom(batch, ['cost', 'unitCost', 'unit_cost'], 0)
      };
    })
    .filter(Boolean)
    .filter((batch) => batch.daysUntilExpiry <= 60)
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const wasteAmount = filteredWaste.reduce((sum, waste) => {
    const rawAmount = valueFrom(waste, ['lossAmount', 'amount', 'cost']);
    if (!hasValue(rawAmount)) missingFields.push('waste_amount');
    return sum + normalizeFinancialNumber(rawAmount, 0);
  }, 0);
  const wasteProducts = new Set(filteredWaste.map((waste) => valueFrom(waste, ['productId', 'product_id', 'productName']))).size;
  const findings = [];

  if (stockNegativeProducts.length > 0) findings.push(finding({
    id: 'inventory-negative-stock',
    severity: 'critical',
    title: 'Hay stock negativo',
    description: `${stockNegativeProducts.length} producto(s) tienen existencias por debajo de cero.`,
    evidence: stockNegativeProducts.slice(0, 5),
    formula: 'stock < 0',
    actionLabel: 'Revisar inventario',
    actionRoute: '/inventario'
  }));
  if (outOfStockProducts.length > 0) findings.push(finding({
    id: 'inventory-out-of-stock',
    severity: 'critical',
    title: 'Productos sin stock',
    description: `${outOfStockProducts.length} producto(s) registrados tienen stock cero o negativo.`,
    evidence: outOfStockProducts.slice(0, 5),
    formula: 'stock <= 0',
    actionLabel: 'Ver productos',
    actionRoute: '/productos'
  }));
  if (lowStockProducts.length > 0) findings.push(finding({
    id: 'inventory-low-stock',
    severity: 'warning',
    title: 'Stock bajo',
    description: `${lowStockProducts.length} producto(s) están en o por debajo de su mínimo disponible.`,
    evidence: lowStockProducts.slice(0, 5),
    formula: 'stock - committed_stock <= min_stock',
    actionLabel: 'Revisar reabastecimiento',
    actionRoute: '/productos'
  }));
  if (committedProducts.length > 0) findings.push(finding({
    id: 'inventory-committed-stock',
    severity: 'info',
    title: 'Stock comprometido',
    description: `${committedProducts.length} producto(s) tienen unidades reservadas o comprometidas.`,
    evidence: committedProducts.slice(0, 5),
    formula: 'stock disponible = stock - committed_stock',
    actionLabel: 'Ver inventario',
    actionRoute: '/inventario'
  }));
  if (noMovementProducts.length > 0) findings.push(finding({
    id: 'inventory-no-movement',
    severity: 'warning',
    title: 'Productos sin movimiento',
    description: `${noMovementProducts.length} producto(s) con stock no aparecen en ventas del periodo.`,
    evidence: noMovementProducts.slice(0, 5),
    formula: 'stock > 0 y producto no vendido en el periodo',
    actionLabel: 'Analizar productos',
    actionRoute: '/reportes'
  }));
  if (wasteAmount > 0) findings.push(finding({
    id: 'inventory-waste',
    severity: 'warning',
    title: 'Merma registrada',
    description: `Se registraron $${wasteAmount.toFixed(2)} en mermas durante el periodo.`,
    evidence: [{ amount: wasteAmount, records: filteredWaste.length, products: wasteProducts }],
    formula: 'suma(lossAmount | amount | cost)',
    actionLabel: 'Ver mermas',
    actionRoute: '/ventas?tab=waste'
  }));
  if (expiringLots.length > 0) findings.push(finding({
    id: 'inventory-expiration-risk',
    severity: expiringLots.some((lot) => lot.daysUntilExpiry <= 30) ? 'critical' : 'warning',
    title: 'Lotes próximos a caducar',
    description: `${expiringLots.length} lote(s) con existencia caducan en los próximos 60 días.`,
    evidence: expiringLots.slice(0, 5),
    formula: '0 <= días hasta caducidad <= 60',
    actionLabel: 'Revisar lotes',
    actionRoute: '/lotes'
  }));
  if (products.length === 0) findings.push(finding({
    id: 'inventory-no-data',
    severity: 'info',
    title: 'Sin datos de inventario',
    description: 'No hay productos disponibles para calcular este diagnóstico.',
    evidence: [],
    formula: 'productos analizados = 0',
    actionLabel: 'Ver productos',
    actionRoute: '/productos'
  }));

  return {
    metrics: {
      productsWithoutStock: outOfStockProducts.length,
      stockNegative: stockNegativeProducts.length,
      lowStock: lowStockProducts.length,
      committedStock: committedProducts.reduce((sum, product) => sum + product.committedStock, 0),
      productsWithoutMovement: noMovementProducts.length,
      capitalDetained,
      wasteAmount,
      wasteRecords: filteredWaste.length,
      expiringLots: expiringLots.length,
      productsAtRisk: new Set([
        ...stockNegativeProducts.map((product) => product.id),
        ...outOfStockProducts.map((product) => product.id),
        ...lowStockProducts.map((product) => product.id),
        ...expiringLots.map((lot) => lot.productId)
      ].filter(Boolean)).size,
      capitalByProduct: capitalByProduct.sort((a, b) => b.value - a.value).slice(0, 10)
    },
    coverage: buildCoverage({ sales: filteredSales, products, missingFields }),
    findings,
    warnings: missingFields.length > 0
      ? ['Hay campos faltantes o inválidos; no se sustituyeron silenciosamente por valores confiables.']
      : []
  };
};

const getDiscount = (sale = {}) => {
  const direct = valueFrom(sale, ['discountTotal', 'discount_total', 'discount']);
  if (hasValue(direct) && typeof direct !== 'object') return normalizeFinancialNumber(direct, 0);
  return (sale.items || []).reduce((sum, item) => {
    const value = valueFrom(item, ['discountAmount', 'discount_amount', 'discount']);
    return sum + normalizeFinancialNumber(typeof value === 'object' ? value?.amount : value, 0);
  }, 0);
};

const getSalePayments = (sale = {}) => {
  if (Array.isArray(sale.payments) && sale.payments.length > 0) {
    return sale.payments.map((payment) => ({
      method: payment.method || payment.paymentMethod || payment.payment_method || 'No especificado',
      amount: normalizeFinancialNumber(payment.amount ?? payment.total, 0)
    }));
  }
  return [{
    method: sale.paymentMethod || sale.payment_method || 'No especificado',
    amount: normalizeFinancialNumber(sale.total, 0)
  }];
};

const buildSalesBreakdown = (sales, timezone) => {
  const byDay = new Map();
  const byHour = new Map();
  const byChannel = new Map();
  const payments = new Map();
  const products = new Map();

  sales.forEach((sale) => {
    const parts = getTimeZoneParts(new Date(sale.timestamp || sale.soldAt || sale.createdAt), timezone);
    const day = new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: timezone }).format(new Date(sale.timestamp || sale.soldAt || sale.createdAt));
    const hour = parts.hour;
    const channel = sale.salesChannel || sale.sales_channel || sale.orderType || sale.order_type || 'Mostrador';
    const revenue = normalizeFinancialNumber(sale.total, 0);
    const increment = (map, key, values) => {
      const current = map.get(key) || { count: 0, revenue: 0 };
      map.set(key, { count: current.count + 1, revenue: current.revenue + values.revenue });
    };
    increment(byDay, day, { revenue });
    increment(byHour, hour, { revenue });
    increment(byChannel, channel, { revenue });

    getSalePayments(sale).forEach((payment) => {
      const current = payments.get(payment.method) || { count: 0, revenue: 0 };
      payments.set(payment.method, {
        count: current.count + 1,
        revenue: current.revenue + payment.amount
      });
    });

    (sale.items || []).forEach((item) => {
      const id = getProductId(item) || getProductName(item);
      const current = products.get(id) || { id, name: getProductName(item), quantity: 0, revenue: 0 };
      products.set(id, {
        ...current,
        quantity: current.quantity + normalizeFinancialNumber(item.quantity, 0),
        revenue: current.revenue + normalizeFinancialNumber(getLineRevenue(item), 0)
      });
    });
  });

  const methodRows = Array.from(payments.entries()).map(([method, data]) => ({ method, ...data }));
  const paymentRevenue = methodRows.reduce((sum, row) => sum + row.revenue, 0);
  const paymentMethods = methodRows
    .map((row) => ({ ...row, percentage: paymentRevenue > 0 ? (row.revenue / paymentRevenue) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    byDay: Object.fromEntries(byDay),
    byHour: Object.fromEntries(Array.from(byHour.entries()).sort(([a], [b]) => Number(a) - Number(b))),
    byChannel: Array.from(byChannel.entries()).map(([channel, data]) => ({ channel, ...data })).sort((a, b) => b.revenue - a.revenue),
    paymentMethods,
    topProducts: Array.from(products.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
  };
};

const buildFinancialDiagnostic = ({ period, timezone, sales = [] }) => {
  const filteredSales = filterDiagnosticSales(sales, period);
  const normalizedSales = filteredSales.map(normalizeSaleForFinancialPolicy);
  const summary = summarizeFinancialSales(normalizedSales);
  const breakdown = buildSalesBreakdown(normalizedSales, timezone);
  const missingCostRevenue = summary.unconfirmedRevenue;
  const hasMissingCosts = summary.hasMissingCosts;
  const missingFields = hasMissingCosts ? ['pos_sale_items.unit_cost'] : [];
  const findings = [];

  if (filteredSales.length === 0) findings.push(finding({
    id: 'financial-no-sales',
    severity: 'info',
    title: 'Sin ventas en el periodo',
    description: 'No hay ventas cerradas y no canceladas para calcular indicadores financieros.',
    evidence: [],
    formula: 'ventas incluidas = 0',
    actionLabel: 'Ver ventas',
    actionRoute: '/ventas'
  }));
  if (hasMissingCosts) findings.push(finding({
    id: 'financial-missing-costs',
    severity: 'warning',
    title: 'Costos incompletos',
    description: `Hay $${missingCostRevenue.toFixed(2)} de venta sin costo unitario confirmado; la utilidad y el margen se marcan como incompletos.`,
    evidence: [{ missingCostRevenue, missingCostItems: summary.missingCostItems }],
    formula: 'costo de venta = suma(quantity × pos_sale_items.unit_cost) sólo cuando el costo existe',
    actionLabel: 'Revisar productos',
    actionRoute: '/productos'
  }));
  if (breakdown.topProducts.length > 0) findings.push(finding({
    id: 'financial-top-contributors',
    severity: 'info',
    title: 'Productos con mayor contribución',
    description: 'Estos productos concentran la mayor venta neta del periodo.',
    evidence: breakdown.topProducts.slice(0, 5),
    formula: 'contribución = suma(lineTotal o price × quantity)',
    actionLabel: 'Abrir reportes',
    actionRoute: '/reportes'
  }));

  return {
    metrics: {
      netSales: summary.totalRevenue,
      salesCount: summary.totalSales,
      averageTicket: summary.totalSales > 0 ? summary.totalRevenue / summary.totalSales : 0,
      costOfSales: summary.confirmedCost,
      grossProfit: hasMissingCosts ? null : summary.confirmedProfit,
      grossMargin: hasMissingCosts ? null : summary.confirmedMarginPct,
      confirmedGrossProfit: summary.confirmedProfit,
      discounts: filteredSales.reduce((sum, sale) => sum + getDiscount(sale), 0),
      missingCostRevenue,
      missingCostItems: summary.missingCostItems,
      costCoverage: summary.totalRevenue > 0 ? (summary.confirmedRevenue / summary.totalRevenue) * 100 : 100,
      itemsSold: summary.itemsSold,
      paymentMethods: breakdown.paymentMethods,
      byDay: breakdown.byDay,
      byHour: breakdown.byHour,
      byChannel: breakdown.byChannel,
      topProducts: breakdown.topProducts
    },
    coverage: buildCoverage({ sales: filteredSales, missingFields }),
    findings,
    warnings: hasMissingCosts
      ? ['La utilidad y el margen no se presentan como completos porque faltan costos unitarios.']
      : []
  };
};

const buildCustomersDiagnostic = ({ period, customers = [], sales = [] }) => {
  const registeredCustomers = Array.isArray(customers) ? customers.filter((customer) => customer?.isActive !== false) : [];
  const filteredSales = filterDiagnosticSales(sales, period);
  const customerMap = new Map(registeredCustomers.map((customer) => [customer.id, customer]));
  const visits = new Map();
  const spend = new Map();
  let anonymousSales = 0;
  let anonymousRevenue = 0;
  let pendingBalance = 0;

  filteredSales.forEach((sale) => {
    const customerId = sale.customerId || sale.customer_id;
    const total = normalizeFinancialNumber(sale.total, 0);
    pendingBalance += normalizeFinancialNumber(valueFrom(sale, ['balanceDue', 'balance_due', 'pendingBalance']), 0);
    if (!customerId || String(customerId).toUpperCase() === 'MOSTRADOR' || !customerMap.has(customerId)) {
      anonymousSales += 1;
      anonymousRevenue += total;
      return;
    }
    const current = spend.get(customerId) || { visits: 0, revenue: 0 };
    visits.set(customerId, (visits.get(customerId) || 0) + 1);
    spend.set(customerId, { visits: current.visits + 1, revenue: current.revenue + total });
  });

  const activeCustomers = Array.from(visits.keys());
  const recurrentCustomers = activeCustomers.filter((id) => (visits.get(id) || 0) >= 2);
  const totalDebt = registeredCustomers.reduce((sum, customer) => sum + normalizeFinancialNumber(valueFrom(customer, ['debt', 'balance', 'balanceDue']), 0), 0);
  const customersWithoutRecentActivity = registeredCustomers.filter((customer) => !visits.has(customer.id));
  const customerDistribution = Array.from(spend.entries()).map(([customerId, data]) => ({
    customerId,
    customerName: customerMap.get(customerId)?.name || 'Cliente registrado',
    ...data,
    averageTicket: data.visits > 0 ? data.revenue / data.visits : 0
  })).sort((a, b) => b.revenue - a.revenue);
  const missingFields = registeredCustomers.some((customer) => !hasValue(customer.id)) ? ['customers.id'] : [];
  const findings = [];

  if (recurrentCustomers.length > 0) findings.push(finding({
    id: 'customers-recurrent',
    severity: 'info',
    title: 'Clientes recurrentes',
    description: `${recurrentCustomers.length} cliente(s) compraron al menos dos veces en el periodo.`,
    evidence: [{ recurrentCustomers: recurrentCustomers.length, activeCustomers: activeCustomers.length }],
    formula: 'cliente recurrente = compras del periodo >= 2',
    actionLabel: 'Ver clientes',
    actionRoute: '/clientes'
  }));
  if (customersWithoutRecentActivity.length > 0) findings.push(finding({
    id: 'customers-inactive',
    severity: 'warning',
    title: 'Clientes sin actividad reciente',
    description: `${customersWithoutRecentActivity.length} cliente(s) registrados no tienen compras en el periodo.`,
    evidence: [{ customers: customersWithoutRecentActivity.length }],
    formula: 'cliente registrado sin venta vinculada en el periodo',
    actionLabel: 'Revisar clientes',
    actionRoute: '/clientes'
  }));
  if (totalDebt > 0 || pendingBalance > 0) findings.push(finding({
    id: 'customers-pending-balances',
    severity: 'warning',
    title: 'Saldos pendientes',
    description: `La deuda registrada suma $${totalDebt.toFixed(2)} y los pendientes del periodo suman $${pendingBalance.toFixed(2)}.`,
    evidence: [{ totalDebt, pendingBalance }],
    formula: 'deuda total = suma(debt | balance | balanceDue)',
    actionLabel: 'Ver clientes',
    actionRoute: '/clientes'
  }));
  if (registeredCustomers.length === 0) findings.push(finding({
    id: 'customers-no-data',
    severity: 'info',
    title: 'Sin clientes registrados',
    description: 'No hay clientes registrados para calcular recurrencia o saldos.',
    evidence: [],
    formula: 'clientes registrados = 0',
    actionLabel: 'Abrir clientes',
    actionRoute: '/clientes'
  }));

  return {
    metrics: {
      registeredCustomers: registeredCustomers.length,
      activeCustomers: activeCustomers.length,
      recurrentCustomers: recurrentCustomers.length,
      purchaseFrequency: activeCustomers.length > 0
        ? activeCustomers.reduce((sum, customerId) => sum + visits.get(customerId), 0) / activeCustomers.length
        : 0,
      averageTicket: filteredSales.length > 0
        ? filteredSales.reduce((sum, sale) => sum + normalizeFinancialNumber(sale.total, 0), 0) / filteredSales.length
        : 0,
      pendingBalances: pendingBalance,
      totalDebt,
      customersWithoutRecentActivity: customersWithoutRecentActivity.length,
      anonymousSales,
      anonymousRevenue,
      salesByCustomer: customerDistribution
    },
    coverage: buildCoverage({ sales: filteredSales, customers: registeredCustomers, missingFields }),
    findings,
    warnings: []
  };
};

export const resolveDiagnosticSource = (reportSource = null, { sales = [], products = [], customers = [], wasteLogs = [] } = {}) => {
  const mode = String(reportSource?.mode || 'local');
  const hasLocalData = [sales, products, customers, wasteLogs].some((rows) => Array.isArray(rows) && rows.length > 0);
  if (mode === 'cloud' || mode === 'cloud_final' || mode === 'cache') return hasLocalData ? 'mixed' : 'cloud';
  return 'local';
};

export const buildDiagnosticResult = ({
  diagnosticType,
  period,
  timezone = DEFAULT_BUSINESS_TIMEZONE,
  source = 'local',
  generatedAt = new Date().toISOString(),
  sales = [],
  menu = [],
  customers = [],
  wasteLogs = [],
  batches = [],
  inventoryEvents = []
} = {}) => {
  let calculated;
  if (diagnosticType === DIAGNOSTIC_TYPES.INVENTORY) {
    calculated = buildInventoryDiagnostic({ period, menu, wasteLogs, batches, inventoryEvents, sales });
  } else if (diagnosticType === DIAGNOSTIC_TYPES.FINANCIAL) {
    calculated = buildFinancialDiagnostic({ period, timezone, sales });
  } else if (diagnosticType === DIAGNOSTIC_TYPES.CUSTOMERS) {
    calculated = buildCustomersDiagnostic({ period, customers, sales });
  } else {
    throw new Error(`Unknown diagnostic type: ${diagnosticType}`);
  }

  return {
    diagnosticType,
    period: { ...period, timezone },
    source,
    generatedAt,
    coverage: calculated.coverage,
    metrics: calculated.metrics,
    findings: calculated.findings,
    warnings: calculated.warnings
  };
};

export const __private__ = {
    buildInventoryDiagnostic,
  buildFinancialDiagnostic,
  buildCustomersDiagnostic,
  isDiagnosticSale,
  getTimeZoneParts,
  localPartsToUtc
};
