import { isMissingUnitCost } from '../sales/financialPolicy';
import { normalizeValidSales } from './salesProfitabilityAnalytics';

const DEFAULT_TIMEZONE = 'America/Mexico_City';
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 5000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number'
    ? value
    : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveNumber = (value) => {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
};

const textOrNull = (value, maxLength = 180) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, maxLength);
  return text || null;
};

const parseCalendarDate = (value) => {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    throw new Error('SALES_PROFITABILITY_DATE_INVALID');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error('SALES_PROFITABILITY_DATE_INVALID');
  }
  return { year, month, day };
};

export const addCalendarDays = (value, days) => {
  const { year, month, day } = parseCalendarDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
};

const assertTimeZone = (timeZone) => {
  const zone = textOrNull(timeZone, 120) || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
  } catch {
    throw new Error('SALES_PROFITABILITY_TIMEZONE_INVALID');
  }
  return zone;
};

const getZonedParts = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);

  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
};

const getTimeZoneOffsetMs = (instant, timeZone) => {
  const parts = getZonedParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return representedAsUtc - instant.getTime();
};

export const localDayStartToUtcIso = (calendarDate, timeZone = DEFAULT_TIMEZONE) => {
  const zone = assertTimeZone(timeZone);
  const { year, month, day } = parseCalendarDate(calendarDate);
  const targetWallClock = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let candidateMs = targetWallClock;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(candidateMs), zone);
    const nextMs = targetWallClock - offsetMs;
    if (Math.abs(nextMs - candidateMs) < 1) {
      candidateMs = nextMs;
      break;
    }
    candidateMs = nextMs;
  }

  const candidate = new Date(candidateMs);
  const parts = getZonedParts(candidate, zone);
  if (
    parts.year !== year
    || parts.month !== month
    || parts.day !== day
    || parts.hour !== 0
    || parts.minute !== 0
    || parts.second !== 0
  ) {
    throw new Error('SALES_PROFITABILITY_TIMEZONE_BOUNDARY_INVALID');
  }

  return candidate.toISOString();
};

export const buildSalesProfitabilityQueryRange = (period = {}) => {
  const from = period.from || period.dateFrom;
  const to = period.to || period.dateTo;
  const timezone = assertTimeZone(period.timezone || DEFAULT_TIMEZONE);
  parseCalendarDate(from);
  parseCalendarDate(to);

  return {
    calendar: { from, to },
    timezone,
    fromInclusiveUtc: localDayStartToUtcIso(from, timezone),
    toExclusiveUtc: localDayStartToUtcIso(addCalendarDays(to, 1), timezone)
  };
};

const rowsFromReport = (report) => {
  if (Array.isArray(report)) return report;
  const source = asRecord(report);
  if (Array.isArray(source.rows)) return source.rows;
  if (Array.isArray(source.sales)) return source.sales;
  if (Array.isArray(source.data)) return source.data;
  return [];
};

const hasMoreFromReport = (report, offset, pageRows) => {
  const source = asRecord(report);
  if (source.has_more !== undefined) return source.has_more === true;
  if (source.hasMore !== undefined) return source.hasMore === true;
  const total = finiteNumber(source.total_count ?? source.totalCount);
  return total !== null ? offset + pageRows.length < total : pageRows.length > 0;
};

const sourceMode = (report) => textOrNull(report?.source?.mode ?? report?.source?.sourceMode, 40) || 'mixed';

const sourceIsComplete = (report) => {
  const mode = sourceMode(report);
  const stale = report?.source?.stale === true;
  return !stale && (mode === 'cloud_final' || mode === 'cloud' || mode === 'local');
};

const reportWarnings = (report) => {
  const source = asRecord(report);
  const direct = Array.isArray(source.warnings) ? source.warnings : [];
  const nested = Array.isArray(source.source?.warnings) ? source.source.warnings : [];
  return Array.from(new Set([...direct, ...nested].filter(Boolean).map(String)));
};

const loadAllPages = async ({
  loader,
  filters,
  pageSize = DEFAULT_PAGE_SIZE,
  maxRows = DEFAULT_MAX_ROWS
}) => {
  const rows = [];
  const warnings = [];
  const modes = new Set();
  let offset = 0;
  let hasMore = true;
  let sourceComplete = true;
  let lastReport = null;

  while (hasMore && rows.length < maxRows) {
    const remaining = maxRows - rows.length;
    const limit = Math.min(pageSize, remaining);
    const report = await loader({ ...filters, limit, offset });
    lastReport = report;
    const pageRows = rowsFromReport(report);
    rows.push(...pageRows);
    reportWarnings(report).forEach((warning) => warnings.push(warning));
    modes.add(sourceMode(report));
    sourceComplete = sourceComplete && sourceIsComplete(report);
    hasMore = hasMoreFromReport(report, offset, pageRows);

    if (!hasMore) break;
    if (pageRows.length === 0) {
      sourceComplete = false;
      break;
    }
    offset += pageRows.length;
  }

  const truncated = hasMore && rows.length >= maxRows;
  return {
    rows,
    truncated,
    paginationComplete: !truncated && !hasMore,
    sourceComplete,
    sourceMode: modes.size === 1 ? Array.from(modes)[0] : 'mixed',
    warnings: Array.from(new Set(warnings)),
    totalCount: finiteNumber(lastReport?.total_count ?? lastReport?.totalCount) ?? rows.length
  };
};

const saleKeys = (sale = {}) => [
  sale.id,
  sale.sale_id,
  sale.cloudSaleId,
  sale.cloud_sale_id,
  sale.localSaleId,
  sale.local_sale_id
].filter((value) => value !== null && value !== undefined && String(value).trim()).map(String);

const profitSaleKey = (row = {}) => textOrNull(
  row.sale_id ?? row.saleId ?? row.cloud_sale_id ?? row.cloudSaleId,
  180
);

const expectedItems = (sale = {}) => {
  const embedded = Array.isArray(sale.items)
    ? sale.items.length
    : (Array.isArray(sale.sale_items) ? sale.sale_items.length : 0);
  return Math.max(
    finiteNumber(sale.itemsCount ?? sale.items_count ?? sale.item_count) ?? embedded,
    0
  );
};

const reportedUnits = (sale = {}) => Math.max(
  finiteNumber(
    sale.itemsQuantity
      ?? sale.items_quantity
      ?? sale.units
      ?? sale.units_count
      ?? sale.quantity_total
  ) ?? 0,
  0
);

export const normalizeSalesProfitLine = (row = {}) => {
  const source = asRecord(row);
  const quantity = positiveNumber(source.quantity ?? source.qty);
  const lineTotal = finiteNumber(source.line_total ?? source.lineTotal ?? source.total ?? source.net_total);
  const costSource = textOrNull(source.cost_source ?? source.costSource, 60)?.toLowerCase() || 'missing';
  const profitStatus = textOrNull(source.profit_status ?? source.profitStatus, 60)?.toLowerCase() || 'incomplete';
  const unitCost = finiteNumber(source.unit_cost ?? source.unitCost);
  const movementCost = finiteNumber(source.movement_cost ?? source.movementCost);
  const invalidEvidence = quantity === null || quantity <= 0 || profitStatus === 'incomplete';

  let lineCost = null;
  let costStatus = 'incomplete';
  if (!invalidEvidence && costSource === 'inventory_movement' && !isMissingUnitCost(movementCost)) {
    lineCost = movementCost;
    costStatus = 'definitive';
  } else if (!invalidEvidence && costSource === 'sale_item_snapshot' && !isMissingUnitCost(unitCost)) {
    lineCost = unitCost * quantity;
    costStatus = 'estimated';
  }

  const normalizedProfitStatus = lineCost === null ? 'incomplete' : profitStatus;

  return {
    saleKey: profitSaleKey(source),
    productName: textOrNull(source.product_name ?? source.productName ?? source.name, 180) || 'Producto sin nombre',
    quantity: quantity ?? 0,
    lineTotal,
    unitPrice: quantity && lineTotal !== null ? lineTotal / quantity : null,
    lineCost,
    unitCost: quantity && lineCost !== null ? lineCost / quantity : null,
    costSource: lineCost === null ? 'missing' : costSource,
    costStatus: lineCost === null ? 'incomplete' : costStatus,
    profitStatus: normalizedProfitStatus,
    costKnown: lineCost !== null
  };
};

const buildProductEvidence = (lines) => {
  const products = new Map();

  lines.forEach((line) => {
    const product = products.get(line.productName) || {
      name: line.productName,
      quantity: 0,
      netSales: 0,
      knownCost: 0,
      knownSales: 0,
      detailLines: 0,
      missingCostLines: 0,
      statuses: new Set(),
      sources: new Set()
    };
    product.quantity += line.quantity;
    product.netSales += line.lineTotal ?? 0;
    product.detailLines += 1;
    product.statuses.add(line.costStatus);
    product.sources.add(line.costSource);
    if (line.costKnown) {
      product.knownCost += line.lineCost;
      product.knownSales += line.lineTotal ?? 0;
    } else {
      product.missingCostLines += 1;
    }
    products.set(line.productName, product);
  });

  return Array.from(products.values())
    .map((product) => {
      const costStatus = product.missingCostLines > 0
        ? 'incomplete'
        : (product.statuses.has('estimated') ? 'estimated' : 'definitive');
      const costSource = product.missingCostLines > 0
        ? 'missing'
        : product.sources.size === 1
          ? Array.from(product.sources)[0]
          : product.sources.has('sale_item_snapshot')
            ? 'sale_item_snapshot'
            : product.sources.has('inventory_movement')
              ? 'inventory_movement'
              : 'missing';
      return {
        name: product.name,
        quantity: product.quantity,
        netSales: product.netSales,
        knownCost: product.knownCost,
        knownSales: product.knownSales,
        detailLines: product.detailLines,
        missingCostLines: product.missingCostLines,
        costStatus,
        costSource,
        costKnown: product.missingCostLines === 0
      };
    })
    .sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name, 'es'));
};

const mergeProfitLinesIntoHistory = ({ historyRows, profitRows }) => {
  const validRows = normalizeValidSales({ rows: historyRows }).rows;
  const validRowSet = new Set(validRows);
  const sales = historyRows.map((sale) => ({ ...sale, items: [] }));
  const saleIndexes = new Map();
  historyRows.forEach((sale, index) => {
    if (!validRowSet.has(sale)) return;
    saleKeys(sale).forEach((key) => {
      if (!saleIndexes.has(key)) saleIndexes.set(key, index);
    });
  });

  const normalizedLines = profitRows.map(normalizeSalesProfitLine);
  const matchedLines = [];
  let unmatchedDetailLines = 0;
  normalizedLines.forEach((line) => {
    const index = line.saleKey ? saleIndexes.get(line.saleKey) : undefined;
    if (index === undefined) {
      unmatchedDetailLines += 1;
      return;
    }
    matchedLines.push(line);
    sales[index].items.push({
      name: line.productName,
      quantity: line.quantity,
      total: line.lineTotal,
      unitPrice: line.unitPrice,
      cost: line.unitCost,
      unit_cost: line.unitCost,
      cost_source: line.costSource,
      profit_status: line.profitStatus,
      costStatus: line.costStatus
    });
  });

  let expectedDetailLines = 0;
  let matchedDetailLines = 0;
  let expectedUnits = 0;
  let salesWithMissingDetail = 0;

  historyRows.forEach((sale, index) => {
    if (!validRowSet.has(sale)) return;
    const mergedSale = sales[index];
    const expected = expectedItems(mergedSale);
    expectedDetailLines += expected;
    expectedUnits += reportedUnits(mergedSale);
    matchedDetailLines += mergedSale.items.length;
    if (expected > mergedSale.items.length) salesWithMissingDetail += 1;
  });

  const validSalesCount = validRows.length;
  const itemCoverage = expectedDetailLines > 0
    ? Math.min(matchedDetailLines / expectedDetailLines, 1)
    : (validSalesCount === 0 ? 1 : 0);
  const detailComplete = validSalesCount === 0
    ? true
    : expectedDetailLines > 0
      && salesWithMissingDetail === 0
      && unmatchedDetailLines === 0
      && matchedDetailLines >= expectedDetailLines;

  return {
    sales,
    lines: matchedLines,
    detailComplete,
    itemCoverage,
    expectedDetailLines,
    matchedDetailLines,
    expectedUnits,
    salesWithMissingDetail,
    unmatchedDetailLines,
    products: buildProductEvidence(matchedLines)
  };
};

const overallCostStatus = (lines, complete) => {
  if (!complete || lines.some((line) => !line.costKnown)) return 'incomplete';
  return lines.some((line) => line.costStatus === 'estimated') ? 'estimated' : 'definitive';
};

export const buildSalesProfitabilityDataset = ({
  history,
  profit,
  queryRange
} = {}) => {
  const merged = mergeProfitLinesIntoHistory({
    historyRows: Array.isArray(history?.rows) ? history.rows : [],
    profitRows: Array.isArray(profit?.rows) ? profit.rows : []
  });
  const knownCost = merged.lines.reduce((sum, line) => sum + (line.lineCost ?? 0), 0);
  const knownSales = merged.lines.reduce((sum, line) => sum + (line.costKnown ? (line.lineTotal ?? 0) : 0), 0);
  const detailedSales = merged.lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const costLinesComplete = merged.lines.length > 0 && merged.lines.every((line) => line.costKnown);
  const paginationComplete = history?.paginationComplete === true && profit?.paginationComplete === true;
  const sourcesComplete = history?.sourceComplete === true && profit?.sourceComplete === true;
  const coverageComplete = merged.detailComplete && costLinesComplete && paginationComplete && sourcesComplete;
  const costCoverage = detailedSales > 0 ? Math.min(knownSales / detailedSales, 1) : 0;

  return {
    history: { rows: merged.sales, source: { mode: history?.sourceMode || 'mixed' } },
    metadata: {
      queryRange,
      historyRows: history?.rows?.length || 0,
      profitRows: profit?.rows?.length || 0,
      expectedDetailLines: merged.expectedDetailLines,
      matchedDetailLines: merged.matchedDetailLines,
      itemCoverage: merged.itemCoverage,
      detailComplete: merged.detailComplete,
      expectedUnits: merged.expectedUnits,
      salesWithMissingDetail: merged.salesWithMissingDetail,
      unmatchedDetailLines: merged.unmatchedDetailLines,
      knownCost,
      knownSales,
      detailedSales,
      costCoverage,
      costComplete: coverageComplete,
      costStatus: overallCostStatus(merged.lines, coverageComplete),
      paginationComplete,
      sourceComplete: sourcesComplete,
      historyTruncated: history?.truncated === true,
      detailTruncated: profit?.truncated === true,
      sourceMode: history?.sourceMode === profit?.sourceMode ? history?.sourceMode : 'mixed',
      warnings: Array.from(new Set([
        ...(history?.warnings || []),
        ...(profit?.warnings || [])
      ])),
      products: merged.products
    }
  };
};

export const loadSalesProfitabilityDataset = async ({
  repository,
  period,
  scope = 'mine',
  pageSize = DEFAULT_PAGE_SIZE,
  maxRows = DEFAULT_MAX_ROWS
} = {}) => {
  if (!repository?.getSalesFinalHistory || !repository?.getSalesProfitReport) {
    throw new Error('SALES_PROFITABILITY_REPORT_REPOSITORY_INVALID');
  }

  const queryRange = buildSalesProfitabilityQueryRange(period);
  const commonFilters = {
    dateFrom: queryRange.fromInclusiveUtc,
    dateTo: queryRange.toExclusiveUtc,
    scope
  };

  const [history, profit] = await Promise.all([
    loadAllPages({
      loader: (filters) => repository.getSalesFinalHistory(filters),
      filters: commonFilters,
      pageSize,
      maxRows
    }),
    loadAllPages({
      loader: (filters) => repository.getSalesProfitReport(filters),
      filters: commonFilters,
      pageSize,
      maxRows
    })
  ]);

  return buildSalesProfitabilityDataset({ history, profit, queryRange });
};

const productOptionsFromDataset = (dataset = {}) => (
  (Array.isArray(dataset?.metadata?.products) ? dataset.metadata.products : [])
    .map((product) => ({
      name: product.name,
      units: product.quantity,
      netSales: product.netSales,
      averagePrice: product.quantity > 0 ? product.netSales / product.quantity : null,
      unitCost: product.costKnown && product.quantity > 0 ? product.knownCost / product.quantity : null,
      costKnown: product.costKnown,
      costStatus: product.costStatus,
      costSource: product.costSource
    }))
);

const productSimulationEligibility = (product) => {
  if (typeof product?.name !== 'string' || !product.name.trim()) return { eligible: false, reason: 'sin nombre de producto válido' };
  if (!(Number(product.units) > 0) || !(Number(product.netSales) > 0) || !(Number(product.averagePrice) > 0)) {
    return { eligible: false, reason: 'sin ventas válidas o precio histórico suficiente' };
  }
  if (product.costKnown !== true || !Number.isFinite(Number(product.unitCost)) || Number(product.unitCost) < 0) {
    return { eligible: false, reason: 'sin costo unitario completo para simular utilidad y margen' };
  }
  return { eligible: true, reason: null };
};

export const buildSalesProfitabilityProductOptionsFromDataset = (dataset = {}) => (
  productOptionsFromDataset(dataset)
    .filter((product) => productSimulationEligibility(product).eligible)
    .sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name, 'es'))
);

export const buildSalesProfitabilityProductExclusionsFromDataset = (dataset = {}) => (
  productOptionsFromDataset(dataset)
    .map((product) => ({ ...product, ...productSimulationEligibility(product) }))
    .filter((product) => product.eligible === false)
    .map(({ name, reason }) => ({ name: name || 'Producto sin nombre', reason }))
);

export default {
  addCalendarDays,
  localDayStartToUtcIso,
  buildSalesProfitabilityQueryRange,
  normalizeSalesProfitLine,
  buildSalesProfitabilityDataset,
  loadSalesProfitabilityDataset,
  buildSalesProfitabilityProductOptionsFromDataset,
  buildSalesProfitabilityProductExclusionsFromDataset
};
