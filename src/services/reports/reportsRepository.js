import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  getPlanFeaturesFromLicenseDetails,
  isCloudCashSyncEnabled,
  isCloudCustomerCreditSyncEnabled,
  isCloudProductsSyncEnabled,
  isFeatureEnabled
} from '../sync/syncConstants';
import { reportsCloudRepository } from './reportsCloudRepository';
import { reportsLocalRepository } from './reportsLocalRepository';
import { reportsMapper } from './reportsMapper';
import { reportsCacheService } from './reportsCacheService';
import { REPORT_SOURCE_MODES, buildReportSource } from './reportSourceBadges';

export const REPORT_SYNC_UPDATED_EVENT = 'lanzo:reports-sync-updated';

const REPORT_TYPES = Object.freeze({
  OVERVIEW: 'overview',
  CASH: 'cash',
  CUSTOMER_CREDIT: 'customer_credit',
  PRODUCT_CATALOG: 'product_catalog',
  TIMESERIES: 'timeseries'
});

const CLOUD_TIMESERIES_METRICS = new Set([
  'cash_entries',
  'cash_exits',
  'customer_payments',
  'customer_debt',
  'cash_difference'
]);

const DEFAULT_CACHE_WARNING = 'Sin conexion o servicio no disponible. Mostrando el ultimo reporte cloud guardado en este dispositivo.';
const DEFAULT_OFFLINE_LOCAL_WARNING = 'Sin conexion y sin snapshot cloud previo. Se muestran datos locales de este dispositivo.';
const DEFAULT_CLOUD_ERROR_CACHE_WARNING = 'No se pudo cargar el reporte cloud. Mostrando el ultimo snapshot guardado.';
const DEFAULT_CLOUD_ERROR_LOCAL_WARNING = 'No se pudo cargar el reporte cloud y no hay snapshot previo. Se muestran datos locales de este dispositivo.';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const isCloudReportsSyncEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync') && isFeatureEnabled(features, 'cloud_reports_sync');
};

const getMode = () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);

  return {
    licenseDetails,
    licenseKey,
    cloudReports: Boolean(licenseKey && isCloudReportsSyncEnabled(licenseDetails)),
    cloudCash: Boolean(licenseKey && isCloudCashSyncEnabled(licenseDetails)),
    cloudCredit: Boolean(licenseKey && isCloudCustomerCreditSyncEnabled(licenseDetails)),
    cloudProducts: Boolean(licenseKey && isCloudProductsSyncEnabled(licenseDetails)),
    online: isOnline()
  };
};

const uniqueWarnings = (...warningGroups) => Array.from(new Set(
  warningGroups.flat().filter(Boolean).map((warning) => String(warning))
));

const applySourceState = (report, {
  sourceMode = REPORT_SOURCE_MODES.LOCAL,
  stale = false,
  warnings = []
} = {}) => {
  const source = report?.source || buildReportSource({ mode: sourceMode });
  return {
    ...report,
    source: {
      ...source,
      mode: sourceMode,
      stale: Boolean(stale),
      warnings: uniqueWarnings(warnings, source.warnings || [], report?.warnings || [])
    }
  };
};

const normalizeCachedPayload = ({ cached, mapper, cacheWarning = DEFAULT_CACHE_WARNING }) => {
  const mapped = mapper(cached.payload, { mode: REPORT_SOURCE_MODES.CACHE, stale: true });
  return applySourceState(mapped, {
    sourceMode: REPORT_SOURCE_MODES.CACHE,
    stale: true,
    warnings: [cacheWarning, ...(mapped.source?.warnings || [])]
  });
};

const withCacheFallback = async ({
  reportType,
  filters = {},
  reportMode,
  loader,
  mapper,
  localFallback,
  offlineWarning = DEFAULT_OFFLINE_LOCAL_WARNING,
  cacheWarning = DEFAULT_CACHE_WARNING,
  cloudErrorCacheWarning = DEFAULT_CLOUD_ERROR_CACHE_WARNING,
  cloudErrorLocalWarning = DEFAULT_CLOUD_ERROR_LOCAL_WARNING
}) => {
  if (!reportMode?.online) {
    const cached = await reportsCacheService.getSnapshot(reportType, filters);
    if (cached?.payload) {
      return normalizeCachedPayload({ cached, mapper, cacheWarning });
    }

    const local = await localFallback();
    return applySourceState(local, {
      sourceMode: REPORT_SOURCE_MODES.CACHE,
      stale: true,
      warnings: [offlineWarning]
    });
  }

  try {
    const payload = await loader();
    const mapped = mapper(payload, { mode: REPORT_SOURCE_MODES.CLOUD, stale: false });
    await reportsCacheService.saveSnapshot(reportType, filters, mapped, mapped.source);
    return mapped;
  } catch (error) {
    const cached = await reportsCacheService.getSnapshot(reportType, filters);
    if (cached?.payload) {
      return normalizeCachedPayload({
        cached,
        mapper,
        cacheWarning: cloudErrorCacheWarning || cacheWarning
      });
    }

    const local = await localFallback();
    return applySourceState(local, {
      sourceMode: REPORT_SOURCE_MODES.MIXED,
      stale: false,
      warnings: [cloudErrorLocalWarning, error?.message || 'Error desconocido']
    });
  }
};

const normalizeOverviewFilters = (filters = {}) => ({
  dateFrom: filters.dateFrom || null,
  dateTo: filters.dateTo || null,
  scope: filters.scope || 'mine'
});

const normalizeCashFilters = (filters = {}) => ({
  dateFrom: filters.dateFrom || null,
  dateTo: filters.dateTo || null,
  staffUserId: filters.staffUserId || filters.staff_user_id || null,
  status: filters.status || null,
  limit: filters.limit || 100,
  offset: filters.offset || 0,
  scope: filters.scope || 'mine'
});

const normalizeCustomerCreditFilters = (filters = {}) => ({
  dateFrom: filters.dateFrom || null,
  dateTo: filters.dateTo || null,
  customerId: filters.customerId || filters.customer_id || null,
  limit: filters.limit || 100,
  offset: filters.offset || 0,
  scope: filters.scope || 'mine'
});

const normalizeProductCatalogFilters = (filters = {}) => ({
  dateFrom: filters.dateFrom || null,
  dateTo: filters.dateTo || null,
  limit: filters.limit || 100,
  offset: filters.offset || 0,
  scope: filters.scope || 'mine'
});

const normalizeTimeseriesFilters = (filters = {}) => ({
  metric: filters.metric || 'cash_entries',
  granularity: filters.granularity || 'day',
  dateFrom: filters.dateFrom || null,
  dateTo: filters.dateTo || null,
  scope: filters.scope || 'mine'
});

const mapCloudReport = (payload, options = {}) => reportsMapper.normalizeReportPayload(payload, {
  mode: options.mode || REPORT_SOURCE_MODES.CLOUD,
  stale: Boolean(options.stale)
});

const rowsToCsv = (rows = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const columns = Array.from(list.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));

  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns, ...list.map((row) => columns.map((column) => row?.[column]))]
    .map((row) => row.map(escape).join(','))
    .join('\n');
};

export const reportsRepository = {
  getReportMode() {
    const mode = getMode();
    if (!mode.cloudReports) return { mode: REPORT_SOURCE_MODES.LOCAL, ...mode };
    if (!mode.online) return { mode: REPORT_SOURCE_MODES.CACHE, ...mode };
    return { mode: REPORT_SOURCE_MODES.MIXED, ...mode };
  },

  async getOverviewReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudCash || !mode.cloudCredit || !mode.cloudProducts) {
      return reportsLocalRepository.getOverviewReport(filters);
    }

    const cloudFilters = normalizeOverviewFilters(filters);

    return withCacheFallback({
      reportType: REPORT_TYPES.OVERVIEW,
      filters: cloudFilters,
      reportMode: mode,
      loader: () => reportsCloudRepository.getOverviewReport({ licenseKey: mode.licenseKey, ...cloudFilters }),
      mapper: (payload, options = {}) => reportsMapper.normalizeCloudOverviewAsMixed(payload, { stale: Boolean(options.stale) }),
      localFallback: () => reportsLocalRepository.getOverviewReport(filters),
      offlineWarning: DEFAULT_OFFLINE_LOCAL_WARNING,
      cacheWarning: DEFAULT_CACHE_WARNING,
      cloudErrorCacheWarning: DEFAULT_CLOUD_ERROR_CACHE_WARNING,
      cloudErrorLocalWarning: 'No se pudo cargar el reporte cloud y no hay snapshot previo. Se mantienen ventas y datos locales de este dispositivo.'
    });
  },

  async getCashReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudCash) return reportsLocalRepository.getCashReport(filters);

    const cloudFilters = normalizeCashFilters(filters);

    return withCacheFallback({
      reportType: REPORT_TYPES.CASH,
      filters: cloudFilters,
      reportMode: mode,
      loader: () => reportsCloudRepository.getCashReport({ licenseKey: mode.licenseKey, ...cloudFilters }),
      mapper: mapCloudReport,
      localFallback: () => reportsLocalRepository.getCashReport(filters),
      offlineWarning: 'Sin conexion y sin snapshot cloud de caja previo. Se muestra caja local de este dispositivo.',
      cacheWarning: 'Mostrando el ultimo snapshot cloud guardado de caja. Puede estar desactualizado.',
      cloudErrorCacheWarning: 'No se pudo cargar caja cloud. Mostrando el ultimo snapshot guardado.',
      cloudErrorLocalWarning: 'No se pudo cargar caja cloud y no hay snapshot previo. Se muestra caja local de este dispositivo.'
    });
  },

  async getCustomerCreditReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudCredit) return reportsLocalRepository.getCustomerCreditReport(filters);

    const cloudFilters = normalizeCustomerCreditFilters(filters);

    return withCacheFallback({
      reportType: REPORT_TYPES.CUSTOMER_CREDIT,
      filters: cloudFilters,
      reportMode: mode,
      loader: () => reportsCloudRepository.getCustomerCreditReport({ licenseKey: mode.licenseKey, ...cloudFilters }),
      mapper: mapCloudReport,
      localFallback: () => reportsLocalRepository.getCustomerCreditReport(filters),
      offlineWarning: 'Sin conexion y sin snapshot cloud de credito previo. Se muestra credito local de este dispositivo.',
      cacheWarning: 'Mostrando el ultimo snapshot cloud guardado de credito/abonos. Puede estar desactualizado.',
      cloudErrorCacheWarning: 'No se pudo cargar credito/abonos cloud. Mostrando el ultimo snapshot guardado.',
      cloudErrorLocalWarning: 'No se pudo cargar credito/abonos cloud y no hay snapshot previo. Se muestra credito local de este dispositivo.'
    });
  },

  async getProductCatalogReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudProducts) return reportsLocalRepository.getProductCatalogReport(filters);

    const cloudFilters = normalizeProductCatalogFilters(filters);

    return withCacheFallback({
      reportType: REPORT_TYPES.PRODUCT_CATALOG,
      filters: cloudFilters,
      reportMode: mode,
      loader: () => reportsCloudRepository.getProductCatalogReport({ licenseKey: mode.licenseKey, ...cloudFilters }),
      mapper: mapCloudReport,
      localFallback: () => reportsLocalRepository.getProductCatalogReport(filters),
      offlineWarning: 'Sin conexion y sin snapshot cloud de catalogo previo. Se muestra catalogo local de este dispositivo.',
      cacheWarning: 'Mostrando el ultimo snapshot cloud guardado de catalogo. Puede estar desactualizado.',
      cloudErrorCacheWarning: 'No se pudo cargar catalogo cloud. Mostrando el ultimo snapshot guardado.',
      cloudErrorLocalWarning: 'No se pudo cargar catalogo cloud y no hay snapshot previo. Se muestra catalogo local de este dispositivo.'
    });
  },

  async getTimeseriesReport(filters = {}) {
    const mode = getMode();
    const cloudFilters = normalizeTimeseriesFilters(filters);
    const metric = String(cloudFilters.metric || '').toLowerCase();

    if (!mode.cloudReports) return reportsLocalRepository.getTimeseriesReport(filters);

    if (!CLOUD_TIMESERIES_METRICS.has(metric)) {
      const local = await reportsLocalRepository.getTimeseriesReport(filters);
      return applySourceState(local, {
        sourceMode: REPORT_SOURCE_MODES.LOCAL,
        stale: false,
        warnings: [
          `La metrica "${cloudFilters.metric}" todavia no tiene fuente cloud. Se usa reporte local de este dispositivo.`,
          'No se implementaron ventas cloud en esta fase.'
        ]
      });
    }

    return withCacheFallback({
      reportType: REPORT_TYPES.TIMESERIES,
      filters: cloudFilters,
      reportMode: mode,
      loader: () => reportsCloudRepository.getTimeseriesReport({ licenseKey: mode.licenseKey, ...cloudFilters }),
      mapper: mapCloudReport,
      localFallback: () => reportsLocalRepository.getTimeseriesReport(filters),
      offlineWarning: 'Sin conexion y sin snapshot cloud de series previo. Se muestran series locales disponibles de este dispositivo.',
      cacheWarning: 'Mostrando el ultimo snapshot cloud guardado de series. Puede estar desactualizado.',
      cloudErrorCacheWarning: 'No se pudo cargar series cloud. Mostrando el ultimo snapshot guardado.',
      cloudErrorLocalWarning: 'No se pudo cargar series cloud y no hay snapshot previo. Se muestran series locales disponibles de este dispositivo.'
    });
  },

  async exportReportCsv(reportType, filters = {}) {
    const mode = getMode();
    let payload;

    if (mode.cloudReports && mode.online) {
      payload = await reportsCloudRepository.exportReportData({ licenseKey: mode.licenseKey, reportType, ...filters });
    } else if (reportType === 'product_inventory') {
      payload = await reportsLocalRepository.getProductCatalogReport(filters);
      payload.rows = payload.inventory || [];
    } else if (reportType === 'customer_debts') {
      payload = await reportsLocalRepository.getCustomerCreditReport(filters);
      payload.rows = payload.top_debtors || [];
    } else {
      payload = await reportsLocalRepository.getOverviewReport(filters);
      payload.rows = payload.sales || [];
    }

    return {
      success: true,
      filename: `${reportType}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: rowsToCsv(payload.rows || []),
      rows: payload.rows || []
    };
  }
};

export default reportsRepository;
