import {
  CLOUD_OFFICIAL_MODULES,
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

const normalizeSource = (payload = {}, modeOverride = null, { stale = false } = {}) => {
  const rawSource = payload.source || payload.data_sources || {};
  const mode = modeOverride || rawSource.mode || REPORT_SOURCE_MODES.LOCAL;

  return buildReportSource({
    mode,
    official: rawSource.official || (mode === REPORT_SOURCE_MODES.LOCAL ? [] : CLOUD_OFFICIAL_MODULES),
    local: rawSource.local || (mode === REPORT_SOURCE_MODES.LOCAL ? ['all'] : LOCAL_ONLY_MODULES),
    warnings: normalizeWarnings(rawSource.warnings || payload.warnings || []),
    stale,
    generatedAt: payload.generated_at || payload.generatedAt || null
  });
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
