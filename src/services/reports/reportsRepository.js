import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudCashSyncEnabled,
  isCloudCustomerCreditSyncEnabled,
  isCloudProductsSyncEnabled,
  isCloudReportsSyncEnabled
} from '../sync/syncConstants';
import { reportsCloudRepository } from './reportsCloudRepository';
import { reportsLocalRepository } from './reportsLocalRepository';
import { reportsMapper } from './reportsMapper';
import { reportsCacheService } from './reportsCacheService';
import { REPORT_SOURCE_MODES } from './reportSourceBadges';

export const REPORT_SYNC_UPDATED_EVENT = 'lanzo:reports-sync-updated';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

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

const withCacheFallback = async ({ reportType, filters, loader, mapper }) => {
  try {
    const payload = await loader();
    const mapped = mapper(payload);
    await reportsCacheService.saveSnapshot(reportType, filters, mapped, mapped.source);
    return mapped;
  } catch (error) {
    const cached = await reportsCacheService.getSnapshot(reportType, filters);
    if (cached?.payload) {
      const mapped = mapper(cached.payload, { stale: true });
      mapped.source.mode = REPORT_SOURCE_MODES.CACHE;
      mapped.source.stale = true;
      mapped.source.warnings = Array.from(new Set([
        'Sin conexion o servicio no disponible. Mostrando el ultimo reporte cloud guardado en este dispositivo.',
        ...(mapped.source.warnings || [])
      ]));
      return mapped;
    }
    throw error;
  }
};

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

    const cloudFilters = {
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null,
      scope: filters.scope || 'mine'
    };

    if (!mode.online) {
      const cached = await reportsCacheService.getSnapshot('overview', cloudFilters);
      if (cached?.payload) return reportsMapper.normalizeCloudOverviewAsMixed(cached.payload, { stale: true });
      const local = await reportsLocalRepository.getOverviewReport(filters);
      local.source.mode = REPORT_SOURCE_MODES.CACHE;
      local.source.stale = true;
      local.source.warnings = ['Sin conexion y sin snapshot cloud previo. Se muestran datos locales de este dispositivo.'];
      return local;
    }

    try {
      return await withCacheFallback({
        reportType: 'overview',
        filters: cloudFilters,
        loader: () => reportsCloudRepository.getOverviewReport({ licenseKey: mode.licenseKey, ...cloudFilters }),
        mapper: (payload) => reportsMapper.normalizeCloudOverviewAsMixed(payload)
      });
    } catch (error) {
      const local = await reportsLocalRepository.getOverviewReport(filters);
      local.source.mode = REPORT_SOURCE_MODES.MIXED;
      local.source.warnings = [
        'No se pudo cargar el reporte cloud. Se mantienen ventas y datos locales de este dispositivo.',
        error?.message || 'Error desconocido'
      ];
      return local;
    }
  },

  async getCashReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudCash || !mode.online) return reportsLocalRepository.getCashReport(filters);
    return reportsMapper.normalizeReportPayload(await reportsCloudRepository.getCashReport({ licenseKey: mode.licenseKey, ...filters }));
  },

  async getCustomerCreditReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudCredit || !mode.online) return reportsLocalRepository.getCustomerCreditReport(filters);
    return reportsMapper.normalizeReportPayload(await reportsCloudRepository.getCustomerCreditReport({ licenseKey: mode.licenseKey, ...filters }));
  },

  async getProductCatalogReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.cloudProducts || !mode.online) return reportsLocalRepository.getProductCatalogReport(filters);
    return reportsMapper.normalizeReportPayload(await reportsCloudRepository.getProductCatalogReport({ licenseKey: mode.licenseKey, ...filters }));
  },

  async getTimeseriesReport(filters = {}) {
    const mode = getMode();
    if (!mode.cloudReports || !mode.online) return reportsLocalRepository.getTimeseriesReport(filters);
    return reportsMapper.normalizeReportPayload(await reportsCloudRepository.getTimeseriesReport({ licenseKey: mode.licenseKey, ...filters }));
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
