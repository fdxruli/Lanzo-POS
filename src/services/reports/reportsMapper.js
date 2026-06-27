import {
  CLOUD_FINAL_OFFICIAL_MODULES,
  CLOUD_OFFICIAL_MODULES,
  DEFAULT_CLOUD_FINAL_WARNINGS,
  DEFAULT_MIXED_WARNINGS,
  LOCAL_ONLY_MODULES,
  REPORT_SOURCE_MODES,
  buildReportSource
} from './reportSourceBadges';

const parsePayload = (payload) => {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  return payload || {};
};

const normalizeWarnings = (warnings = []) => (
  Array.isArray(warnings) ? warnings.filter(Boolean) : [warnings].filter(Boolean)
);

const uniqueWarnings = (...groups) => Array.from(new Set(groups.flat().filter(Boolean).map((warning) => String(warning))));

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pick = (row = {}, keys = [], fallback = null) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeSource = (payload = {}, modeOverride = null, { stale = false } = {}) => {
  const rawSource = payload.source || payload.data_sources || {};
  const mode = modeOverride || rawSource.mode || REPORT_SOURCE_MODES.LOCAL;
  const final = Boolean(
    rawSource.final === true ||
    payload.final === true ||
    mode === REPORT_SOURCE_MODES.CLOUD_FINAL ||
    (mode === REPORT_SOURCE_MODES.CACHE && rawSource.final === true)
  );

  const official = rawSource.official || (
    final
      ? CLOUD_FINAL_OFFICIAL_MODULES
      : (mode === REPORT_SOURCE_MODES.LOCAL ? [] : CLOUD_OFFICIAL_MODULES)
  );
  const local = rawSource.local || (
    mode === REPORT_SOURCE_MODES.LOCAL
      ? ['all']
      : LOCAL_ONLY_MODULES
  );
  const warnings = uniqueWarnings(
    final ? DEFAULT_CLOUD_FINAL_WARNINGS : [],
    normalizeWarnings(rawSource.warnings || payload.warnings || [])
  );

  return {
    ...buildReportSource({
      mode,
      official,
      local,
      warnings,
      stale,
      generatedAt: payload.generated_at || payload.generatedAt || null
    }),
    final
  };
};

const normalizeSalesFinalHistoryRow = (row = {}) => {
  const cloudSaleId = pick(row, ['cloudSaleId', 'cloud_sale_id', 'sale_id', 'id']);
  const localSaleId = pick(row, ['localSaleId', 'local_sale_id', 'local_id']);
  const sourceMode = pick(row, ['sourceMode', 'source_mode'], row.status === 'shadow' ? 'shadow' : 'cloud_committed');
  const status = String(pick(row, ['status', 'sale_status'], 'closed') || 'closed').toLowerCase();
  const soldAt = pick(row, ['soldAt', 'sold_at', 'timestamp', 'created_at']);
  const cancelledAt = pick(row, ['cancelledAt', 'cancelled_at']);
  const items = normalizeArray(row.items || row.sale_items).map((item = {}) => ({
    ...item,
    id: pick(item, ['id', 'sale_item_id', 'product_id', 'lineId'], undefined),
    name: pick(item, ['name', 'product_name', 'productName', 'description'], 'Producto'),
    quantity: toNumber(pick(item, ['quantity', 'qty'], 0), 0),
    cost: pick(item, ['cost', 'unit_cost', 'cost_snapshot'], null),
    total: toNumber(pick(item, ['total', 'line_total', 'subtotal'], 0), 0)
  }));

  const cashEffectStatus = pick(row, ['cashEffectStatus', 'cash_effect_status'], 'not_required');
  const inventoryEffectStatus = pick(row, ['inventoryEffectStatus', 'inventory_effect_status'], 'not_required');
  const creditEffectStatus = pick(row, ['creditEffectStatus', 'credit_effect_status'], 'not_required');
  const cashReversalStatus = pick(row, ['cashReversalStatus', 'cash_reversal_status'], null);
  const inventoryReversalStatus = pick(row, ['inventoryReversalStatus', 'inventory_reversal_status'], null);
  const creditReversalStatus = pick(row, ['creditReversalStatus', 'credit_reversal_status'], null);

  return {
    ...row,
    id: localSaleId || cloudSaleId || pick(row, ['id'], undefined),
    cloudSaleId,
    cloud_sale_id: cloudSaleId,
    localSaleId,
    folio: pick(row, ['folio', 'cloud_folio', 'cloudFolio'], cloudSaleId),
    cloudFolio: pick(row, ['cloudFolio', 'cloud_folio', 'folio'], null),
    timestamp: soldAt || cancelledAt || new Date().toISOString(),
    soldAt,
    sourceMode,
    source_mode: sourceMode,
    status,
    customerName: pick(row, ['customerName', 'customer_name', 'customer_snapshot_name'], 'Publico general'),
    paymentMethod: pick(row, ['paymentMethod', 'payment_method'], ''),
    paymentStatus: pick(row, ['paymentStatus', 'payment_status'], ''),
    total: toNumber(pick(row, ['total', 'net_total', 'net_sales_total'], 0), 0),
    amountPaid: toNumber(pick(row, ['amountPaid', 'amount_paid', 'paid_total'], 0), 0),
    balanceDue: toNumber(pick(row, ['balanceDue', 'balance_due', 'debt_total'], 0), 0),
    actorName: pick(row, ['actorName', 'actor_name', 'staff_name', 'device_name'], ''),
    staffUserId: pick(row, ['staffUserId', 'staff_user_id'], null),
    deviceId: pick(row, ['deviceId', 'device_id'], null),
    cashSessionId: pick(row, ['cashSessionId', 'cash_session_id'], null),
    cashEffectStatus,
    inventoryEffectStatus,
    creditEffectStatus,
    cashReversalStatus,
    inventoryReversalStatus,
    creditReversalStatus,
    cancellationId: pick(row, ['cancellationId', 'cancellation_id'], null),
    cancelledAt,
    cancelReason: pick(row, ['cancelReason', 'cancel_reason'], ''),
    itemsCount: toNumber(pick(row, ['itemsCount', 'items_count'], items.length), items.length),
    itemsQuantity: toNumber(pick(row, ['itemsQuantity', 'items_quantity'], items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0)), 0),
    payments: normalizeArray(row.payments || row.sale_payments),
    items,
    effects: {
      ...(row.effects || {}),
      cash: cashEffectStatus,
      inventory: inventoryEffectStatus,
      credit: creditEffectStatus,
      cashReversal: cashReversalStatus,
      inventoryReversal: inventoryReversalStatus,
      creditReversal: creditReversalStatus
    },
    badges: normalizeArray(row.badges)
  };
};

export const reportsMapper = {
  normalizeOverview(payload, { mode = null, stale = false } = {}) {
    const data = parsePayload(payload);
    const sourceMode = mode || data.source?.mode || REPORT_SOURCE_MODES.LOCAL;
    return {
      success: data.success !== false,
      generatedAt: data.generated_at || data.generatedAt || null,
      dateRange: data.date_range || data.dateRange || null,
      overview: data.overview || {},
      cash: data.cash || null,
      customerCredit: data.customer_credit || data.customerCredit || null,
      products: data.products || null,
      warnings: normalizeWarnings(data.warnings || data.source?.warnings || []),
      source: normalizeSource(data, sourceMode, { stale }),
      raw: data
    };
  },

  normalizeCloudOverviewAsMixed(payload, { stale = false } = {}) {
    const mapped = this.normalizeOverview(payload, { mode: stale ? REPORT_SOURCE_MODES.CACHE : REPORT_SOURCE_MODES.MIXED, stale });
    mapped.source.official = CLOUD_OFFICIAL_MODULES;
    mapped.source.local = LOCAL_ONLY_MODULES;
    mapped.source.warnings = Array.from(new Set([
      ...DEFAULT_MIXED_WARNINGS,
      ...mapped.source.warnings
    ]));
    return mapped;
  },

  normalizeReportPayload(payload, { mode = REPORT_SOURCE_MODES.CLOUD, stale = false } = {}) {
    const data = parsePayload(payload);
    return {
      ...data,
      success: data.success !== false,
      generatedAt: data.generated_at || data.generatedAt || null,
      source: normalizeSource(data, mode, { stale })
    };
  },

  normalizeSalesFinalHistoryPayload(payload, { mode = REPORT_SOURCE_MODES.CLOUD_FINAL, stale = false } = {}) {
    const data = parsePayload(payload);
    const rows = normalizeArray(data.rows || data.sales || data.history || data.data)
      .map(normalizeSalesFinalHistoryRow);
    const offset = Math.max(Number(data.offset || data.page_offset || 0) || 0, 0);
    const limit = Math.max(Number(data.limit || data.page_limit || rows.length || 50) || 50, 1);
    const totalCount = Math.max(Number(data.total_count ?? data.totalCount ?? rows.length) || rows.length, rows.length);
    const hasMore = data.has_more !== undefined
      ? Boolean(data.has_more)
      : offset + rows.length < totalCount;

    return {
      ...data,
      success: data.success !== false,
      generatedAt: data.generated_at || data.generatedAt || new Date().toISOString(),
      dateRange: data.date_range || data.dateRange || null,
      rows,
      sales: rows,
      totalCount,
      total_count: totalCount,
      limit,
      offset,
      hasMore,
      has_more: hasMore,
      warnings: normalizeWarnings(data.warnings || data.source?.warnings || []),
      source: normalizeSource({
        ...data,
        source: {
          ...(data.source || {}),
          final: mode === REPORT_SOURCE_MODES.CLOUD_FINAL || data.source?.final === true
        }
      }, mode, { stale }),
      raw: data
    };
  },

  normalizeLocalOverview(payload = {}) {
    return {
      success: true,
      generatedAt: new Date().toISOString(),
      overview: payload.overview || {},
      sales: payload.sales || [],
      wasteLogs: payload.wasteLogs || [],
      menu: payload.menu || [],
      customers: payload.customers || [],
      warnings: [],
      source: buildReportSource({
        mode: REPORT_SOURCE_MODES.LOCAL,
        official: [],
        local: ['all'],
        warnings: ['Reporte local de este dispositivo.'],
        generatedAt: new Date().toISOString()
      }),
      raw: payload
    };
  }
};

export default reportsMapper;
